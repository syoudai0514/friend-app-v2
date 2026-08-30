import { GoogleGenAI, Modality } from "@google/genai";

const DEFAULT_LIVE_MODEL = "gemini-3.1-flash-live-preview";
const LIVE_TIMEOUT_MS = 30_000;

export interface GeminiLiveResult {
  transcript: string;
  audio: Uint8Array;
  mimeType: string;
}

interface GeminiLiveInput {
  apiKey: string;
  prompt: string;
  systemInstruction?: string;
  voiceName?: string;
  signal?: AbortSignal;
  model?: string;
}

function appendTranscript(current: string, next: string): string {
  const cleaned = next.replace(/\s+/g, " ");
  if (!cleaned) return current;
  if (cleaned.startsWith(current)) return cleaned;
  if (current.endsWith(cleaned)) return current;
  return `${current}${cleaned}`;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Gemini Liveを1ターンだけserver-to-serverで利用する。
 * API keyをbrowserへ出さず、返答音声とそのoutput transcriptionだけを取得する。
 */
export async function generateGeminiLive(input: GeminiLiveInput): Promise<GeminiLiveResult> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey });
  const audioChunks: Uint8Array[] = [];
  let transcript = "";
  let mimeType = "audio/pcm;rate=24000";
  let settled = false;
  let resolveTurn!: () => void;
  let rejectTurn!: (error: Error) => void;
  const turnDone = new Promise<void>((resolve, reject) => {
    resolveTurn = resolve;
    rejectTurn = reject;
  });

  const session = await ai.live.connect({
    model: input.model?.trim() || process.env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL,
    config: {
      responseModalities: [Modality.AUDIO],
      outputAudioTranscription: {},
      ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}),
      ...(input.voiceName
        ? {
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voiceName } },
            },
          }
        : {}),
      thinkingConfig: { thinkingLevel: "minimal" },
    },
    callbacks: {
      onopen() {
        // connection establishment is intentionally not logged with prompt contents.
      },
      onmessage(message) {
        const content = message.serverContent;
        const nextTranscript = content?.outputTranscription?.text;
        if (nextTranscript) transcript = appendTranscript(transcript, nextTranscript);

        for (const part of content?.modelTurn?.parts ?? []) {
          const encoded = part.inlineData?.data;
          if (!encoded) continue;
          const decoded = Buffer.from(encoded, "base64");
          if (!decoded.byteLength) continue;
          audioChunks.push(Uint8Array.from(decoded));
          if (part.inlineData?.mimeType) mimeType = part.inlineData.mimeType;
        }

        if (content?.turnComplete && !settled) {
          settled = true;
          resolveTurn();
        }
      },
      onerror(event) {
        if (settled) return;
        settled = true;
        rejectTurn(new Error(event.message || "Gemini Live error"));
      },
      onclose(event) {
        if (settled) return;
        settled = true;
        rejectTurn(new Error(event.reason || "Gemini Live closed before turn completion"));
      },
    },
  });

  const abort = () => {
    if (settled) return;
    settled = true;
    rejectTurn(new DOMException("Aborted", "AbortError"));
    try { session.close(); } catch { /* already closed */ }
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectTurn(new Error("Gemini Live turn timed out"));
    try { session.close(); } catch { /* already closed */ }
  }, LIVE_TIMEOUT_MS);

  try {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    session.sendRealtimeInput({ text: input.prompt });
    await turnDone;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abort);
    try { session.close(); } catch { /* already closed */ }
  }

  return {
    transcript: transcript.replace(/\s+/g, " ").trim(),
    audio: concatBytes(audioChunks),
    mimeType,
  };
}
