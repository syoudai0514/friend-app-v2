import { isAppleMobileWebKit, type AudioSessionController } from "./audio-session";
import {
  isTsukuyomiPersona,
  synthesizeTsukuyomiSpeech,
} from "./tsukuyomi-local-tts";

const JAPANESE_BREAK = /[、。！？!?]/u;

export interface PreparedTsukuyomiChunk {
  text: string;
  blob: Promise<Blob>;
}

interface PlayFastOptions {
  session: AudioSessionController;
  speech: string;
  cacheKey: string;
  signal?: AbortSignal;
  preparedFirst?: PreparedTsukuyomiChunk;
  cachedBlobs?: Blob[];
  delayMs?: number;
  onFirstAudio?: () => void;
}

export interface FastPlaybackResult {
  played: boolean;
  blobs: Blob[];
}

function normalizeFastSpeech(text: string): string {
  return String(text)
    .normalize("NFKC")
    .replace(/[\r\n]+/g, "。")
    .replace(/[「『（(]/g, "、")
    .replace(/[」』）)]/g, "、")
    .replace(/\s*、\s*/g, "、")
    .replace(/[、,]{2,}/g, "、")
    .replace(/、(?=[。！？!?])/g, "")
    .replace(/、+\s*$/g, "")
    .replace(/[。．]{2,}/g, "。")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function maxChunkChars(): number {
  return isAppleMobileWebKit() ? 18 : 24;
}

function cachedChunkLimit(): number {
  // The ONNX model itself is large on iPhone. Keep only enough completed WAVs to make
  // immediate replay responsive; later chunks are allowed to be garbage-collected.
  return isAppleMobileWebKit() ? 2 : 4;
}

export function splitTsukuyomiForFastPlayback(text: string): string[] {
  let remaining = normalizeFastSpeech(text);
  if (!remaining) return [];

  const maxChars = maxChunkChars();
  const chunks: string[] = [];

  while (remaining) {
    const window = remaining.slice(0, maxChars);
    const match = JAPANESE_BREAK.exec(window);
    const consumed = match ? (match.index ?? 0) + match[0].length : Math.min(maxChars, remaining.length);
    let chunk = remaining.slice(0, consumed).trim();
    remaining = remaining.slice(consumed).trimStart();
    if (!chunk) continue;
    if (!JAPANESE_BREAK.test(chunk.at(-1) ?? "")) chunk = `${chunk}、`;
    chunks.push(chunk);
  }

  return chunks;
}

export function firstStableTsukuyomiChunk(partialText: string): string | null {
  const normalized = normalizeFastSpeech(partialText);
  if (!normalized) return null;
  const maxChars = maxChunkChars();
  const window = normalized.slice(0, maxChars);
  const match = JAPANESE_BREAK.exec(window);
  if (match) return window.slice(0, (match.index ?? 0) + match[0].length).trim();
  if (normalized.length < maxChars) return null;
  return `${window.trim()}、`;
}

export function prepareTsukuyomiFirstChunk(
  partialText: string,
  signal?: AbortSignal,
): PreparedTsukuyomiChunk | null {
  const text = firstStableTsukuyomiChunk(partialText);
  if (!text) return null;
  const blob = synthesizeTsukuyomiSpeech(text, { signal });
  void blob.catch(() => undefined);
  return { text, blob };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

async function playBlobToEnd(
  session: AudioSessionController,
  key: string,
  blob: Blob,
  options: { delayMs?: number; requestStartedAt?: number },
  onStarted?: () => void,
): Promise<boolean> {
  let sawPlaying = false;
  let settled = false;
  let unsubscribe = () => {};

  const ended = new Promise<boolean>((resolve) => {
    unsubscribe = session.subscribe((state) => {
      if (state === "playing") sawPlaying = true;
      if (!sawPlaying || settled) return;
      if (state === "idle") {
        settled = true;
        unsubscribe();
        resolve(true);
      } else if (state === "error" || state === "interrupted" || state === "locked") {
        settled = true;
        unsubscribe();
        resolve(false);
      }
    });
  });

  const played = await session.play(key, blob, options);
  if (!played) {
    settled = true;
    unsubscribe();
    return false;
  }
  onStarted?.();
  return ended;
}

function chunkBlobPromise(
  chunks: string[],
  cachedBlobs: Blob[],
  index: number,
  preparedFirst: PreparedTsukuyomiChunk | undefined,
  signal: AbortSignal,
): Promise<Blob> {
  const cached = cachedBlobs[index];
  if (cached) return Promise.resolve(cached);
  if (index === 0 && preparedFirst?.text === chunks[0]) return preparedFirst.blob;
  const promise = synthesizeTsukuyomiSpeech(chunks[index], { signal });
  void promise.catch(() => undefined);
  return promise;
}

export async function playTsukuyomiFast({
  session,
  speech,
  cacheKey,
  signal,
  preparedFirst,
  cachedBlobs = [],
  delayMs = 0,
  onFirstAudio,
}: PlayFastOptions): Promise<FastPlaybackResult> {
  throwIfAborted(signal);
  const chunks = splitTsukuyomiForFastPlayback(speech);
  if (!chunks.length) return { played: false, blobs: [] };

  const pipelineAbort = new AbortController();
  const forwardAbort = () => pipelineAbort.abort();
  if (signal?.aborted) pipelineAbort.abort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  const cacheLimit = cachedChunkLimit();
  const retainedBlobs = cachedBlobs.slice(0, cacheLimit);
  let playedAny = false;
  let prefetched: Promise<Blob> | null = null;

  try {
    for (let index = 0; index < chunks.length; index += 1) {
      throwIfAborted(pipelineAbort.signal);
      session.beginLoading();

      const currentPromise = prefetched ?? chunkBlobPromise(
        chunks,
        retainedBlobs,
        index,
        preparedFirst,
        pipelineAbort.signal,
      );
      prefetched = null;

      const blob = await currentPromise;
      if (index < cacheLimit) retainedBlobs[index] = blob;
      throwIfAborted(pipelineAbort.signal);

      // Keep at most one inference ahead. On iPhone this overlaps the expensive local
      // Piper synthesis with the chunk that is currently audible, without synthesizing
      // the whole answer at once or allowing unbounded concurrent ONNX work.
      const nextIndex = index + 1;
      if (nextIndex < chunks.length) {
        prefetched = chunkBlobPromise(
          chunks,
          retainedBlobs,
          nextIndex,
          preparedFirst,
          pipelineAbort.signal,
        );
      }

      const startedAt = performance.now();
      const played = await playBlobToEnd(
        session,
        `${cacheKey}:chunk:${index}`,
        blob,
        {
          delayMs: index === 0 ? delayMs : 0,
          requestStartedAt: index === 0 ? startedAt : undefined,
        },
        index === 0
          ? () => {
              playedAny = true;
              onFirstAudio?.();
            }
          : () => {
              playedAny = true;
            },
      );
      if (!played) {
        pipelineAbort.abort();
        return { played: playedAny, blobs: retainedBlobs };
      }
    }

    return { played: playedAny, blobs: retainedBlobs };
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
  }
}

export { isTsukuyomiPersona };
