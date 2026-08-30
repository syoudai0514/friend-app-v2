"use client";

const MAX_INLINE_AUDIO_BASE64 = 4_000_000;
const MAX_CACHE_ENTRIES = 12;

interface LiveAudioEnvelope {
  type?: unknown;
  turnId?: unknown;
  turn?: unknown;
  audio?: unknown;
}

interface DecodedLiveAudio {
  key: string;
  blob: Blob;
}

interface BridgeState {
  refs: number;
  originalFetch: typeof fetch;
  bridgedFetch: typeof fetch;
  cache: Map<string, Blob>;
}

let bridgeState: BridgeState | null = null;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function liveAudioCacheKey(
  personaId: string,
  speech: string,
  style: string | undefined,
  emotionIntensity: number | null | undefined,
): string {
  return JSON.stringify([
    personaId,
    speech,
    style ?? "neutral",
    typeof emotionIntensity === "number" ? emotionIntensity : null,
  ]);
}

function wavHeaderLooksValid(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 44) return false;
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  return ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE";
}

export function decodeLiveAudioEnvelope(value: unknown, personaId: string): DecodedLiveAudio | null {
  const envelope = record(value) as LiveAudioEnvelope | null;
  if (!envelope || envelope.type !== "turn_complete" || typeof envelope.turnId !== "string") return null;
  const turn = record(envelope.turn);
  const audio = record(envelope.audio);
  if (!turn || !audio || typeof turn.speech !== "string" || !turn.speech.trim()) return null;
  if (audio.mimeType !== "audio/wav" || typeof audio.data !== "string") return null;
  if (!audio.data || audio.data.length > MAX_INLINE_AUDIO_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(audio.data)) return null;

  const performance = record(turn.performance);
  const style = typeof performance?.voiceStyle === "string" ? performance.voiceStyle : "neutral";
  const emotionIntensity = typeof performance?.emotionIntensity === "number"
    ? performance.emotionIntensity
    : null;

  try {
    const binary = atob(audio.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    if (!wavHeaderLooksValid(bytes)) return null;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return {
      key: liveAudioCacheKey(personaId, turn.speech, style, emotionIntensity),
      blob: new Blob([buffer], { type: "audio/wav" }),
    };
  } catch {
    return null;
  }
}

function requestPath(input: RequestInfo | URL): string | null {
  try {
    if (typeof input === "string") return new URL(input, window.location.href).pathname;
    if (input instanceof URL) return input.pathname;
    return new URL(input.url, window.location.href).pathname;
  } catch {
    return null;
  }
}

function jsonBody(body: BodyInit | null | undefined): Record<string, unknown> | null {
  if (typeof body !== "string") return null;
  try {
    return record(JSON.parse(body));
  } catch {
    return null;
  }
}

function personaIdFromChatRequest(init?: RequestInit): string | null {
  const body = jsonBody(init?.body);
  const persona = record(body?.persona);
  return typeof persona?.id === "string" && persona.id ? persona.id : null;
}

function ttsKeyFromRequest(init?: RequestInit): string | null {
  const body = jsonBody(init?.body);
  if (!body || typeof body.personaId !== "string" || typeof body.speech !== "string") return null;
  const style = typeof body.style === "string" ? body.style : "neutral";
  const emotionIntensity = typeof body.emotionIntensity === "number" ? body.emotionIntensity : null;
  return liveAudioCacheKey(body.personaId, body.speech, style, emotionIntensity);
}

function remember(cache: Map<string, Blob>, key: string, blob: Blob) {
  cache.delete(key);
  cache.set(key, blob);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function wrapChatResponse(response: Response, personaId: string, cache: Map<string, Blob>): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const inspect = (text: string) => {
    buffer += text;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      try {
        const decoded = decodeLiveAudioEnvelope(JSON.parse(line), personaId);
        if (decoded) remember(cache, decoded.key, decoded.blob);
      } catch {
        // Non-audio dialogue events continue through the normal parser unchanged.
      }
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) inspect(tail);
        if (buffer.trim()) {
          try {
            const decoded = decodeLiveAudioEnvelope(JSON.parse(buffer), personaId);
            if (decoded) remember(cache, decoded.key, decoded.blob);
          } catch {
            // Ignore incomplete trailing diagnostic data.
          }
        }
        controller.close();
        return;
      }
      inspect(decoder.decode(value, { stream: true }));
      // Audio is cached synchronously before this chunk reaches ChatPage. Therefore when
      // turn_complete triggers autoplay, the following /api/tts request is satisfied locally.
      controller.enqueue(value);
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

export function installLiveAudioFetchBridge(): () => void {
  if (bridgeState) {
    bridgeState.refs += 1;
    return () => {
      if (!bridgeState) return;
      bridgeState.refs -= 1;
      if (bridgeState.refs <= 0 && globalThis.fetch === bridgeState.bridgedFetch) {
        globalThis.fetch = bridgeState.originalFetch;
        bridgeState = null;
      }
    };
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  const cache = new Map<string, Blob>();
  const bridgedFetch: typeof fetch = async (input, init) => {
    const path = requestPath(input);

    if (path === "/api/tts") {
      const key = ttsKeyFromRequest(init);
      const blob = key ? cache.get(key) : undefined;
      if (blob) {
        return new Response(blob, {
          status: 200,
          headers: {
            "Content-Type": blob.type || "audio/wav",
            "Cache-Control": "private, no-store",
            "X-TTS-Provider": "gemini-live-chat",
          },
        });
      }
    }

    const response = await originalFetch(input, init);
    if (path !== "/api/chat") return response;
    const personaId = personaIdFromChatRequest(init);
    return personaId ? wrapChatResponse(response, personaId, cache) : response;
  };

  bridgeState = { refs: 1, originalFetch, bridgedFetch, cache };
  globalThis.fetch = bridgedFetch;

  return () => {
    if (!bridgeState) return;
    bridgeState.refs -= 1;
    if (bridgeState.refs <= 0 && globalThis.fetch === bridgeState.bridgedFetch) {
      globalThis.fetch = bridgeState.originalFetch;
      bridgeState = null;
    }
  };
}
