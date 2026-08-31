"use client";

import { GoogleGenAI, Modality } from "@google/genai";
import { validateModelTurn } from "./dialogue";
import { pcm16MonoToWav } from "./gemini-tts";
import {
  LIVE_VOICE_API_VERSION,
  liveVoiceContextKey,
  type LiveVoiceContextInput,
} from "./live-voice-config";
import { LivePcmPlayer } from "./live-pcm-player";
import type { ChatMessage, Look, ModelTurn, Persona } from "./types";

const MAX_INLINE_AUDIO_BASE64 = 4_000_000;
const MAX_CACHE_ENTRIES = 24;
const MAX_DIRECT_PCM_BYTES = 3_000_000;

interface LiveAudioEnvelope {
  type?: unknown;
  turnId?: unknown;
  turn?: unknown;
  audio?: unknown;
}

interface DecodedLiveAudio {
  key: string;
  speechKey: string;
  blob: Blob;
}

interface ChatRequest {
  turnId: string;
  messages: ChatMessage[];
  persona: Persona;
  userName: string;
  affection: number;
  look: Look;
  memories?: string[];
}

interface TokenResponse {
  token: string;
  model: string;
  contextKey: string;
}

type LiveSession = Awaited<ReturnType<GoogleGenAI["live"]["connect"]>>;

interface ActiveTurn {
  turnId: string;
  body: ChatRequest;
  input: RequestInfo | URL;
  init: RequestInit;
  controller: ReadableStreamDefaultController<Uint8Array>;
  sessionSerial: number;
  transcript: string;
  pcmChunks: Uint8Array[];
  pcmBytes: number;
  mimeType: string;
  audioReceived: boolean;
  streamingStarted: boolean;
  finishing: boolean;
  fallbackStarted: boolean;
  startedAt: number;
  firstChunkAt: number | null;
}

interface BridgeState {
  refs: number;
  originalFetch: typeof fetch;
  bridgedFetch: typeof fetch;
  cache: Map<string, Blob>;
  skipNextTts: Set<string>;
  enabled: boolean;
  player: LivePcmPlayer;
  session: LiveSession | null;
  sessionContextKey: string | null;
  connectSerial: number;
  connectPromise: Promise<boolean> | null;
  active: ActiveTurn | null;
}

let bridgeState: BridgeState | null = null;
const encoder = new TextEncoder();

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
    "intent",
    personaId,
    speech,
    style ?? "neutral",
    typeof emotionIntensity === "number" ? emotionIntensity : null,
  ]);
}

export function liveAudioSpeechKey(personaId: string, speech: string): string {
  return JSON.stringify(["speech", personaId, speech]);
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
      speechKey: liveAudioSpeechKey(personaId, turn.speech),
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

function parseChatRequest(init?: RequestInit): ChatRequest | null {
  const body = jsonBody(init?.body);
  const persona = record(body?.persona);
  const look = record(body?.look);
  if (
    !body ||
    typeof body.turnId !== "string" ||
    !Array.isArray(body.messages) ||
    !persona ||
    typeof persona.id !== "string" ||
    !look ||
    typeof look.variantId !== "string" ||
    typeof look.scene !== "string" ||
    typeof look.motionId !== "string"
  ) return null;
  return body as unknown as ChatRequest;
}

function ttsKeysFromRequest(init?: RequestInit): { key: string; speechKey: string } | null {
  const body = jsonBody(init?.body);
  if (!body || typeof body.personaId !== "string" || typeof body.speech !== "string") return null;
  const style = typeof body.style === "string" ? body.style : "neutral";
  const emotionIntensity = typeof body.emotionIntensity === "number" ? body.emotionIntensity : null;
  return {
    key: liveAudioCacheKey(body.personaId, body.speech, style, emotionIntensity),
    speechKey: liveAudioSpeechKey(body.personaId, body.speech),
  };
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

function decodePcmBytes(encoded: string): Uint8Array | null {
  try {
    const binary = atob(encoded);
    if (!binary.length || binary.length % 2 !== 0) return null;
    const output = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index) & 0xff;
    return output;
  } catch {
    return null;
  }
}

function pcmRate(mimeType: string): number {
  const match = mimeType.match(/rate=(\d+)/i);
  const rate = match ? Number.parseInt(match[1], 10) : 24_000;
  return Number.isFinite(rate) && rate >= 8_000 && rate <= 96_000 ? rate : 24_000;
}

function concatBytes(chunks: Uint8Array[], length: number): Uint8Array {
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function appendTranscript(current: string, next: string): { merged: string; delta: string } {
  const cleaned = next.replace(/\s+/g, " ");
  if (!cleaned) return { merged: current, delta: "" };
  if (cleaned.startsWith(current)) return { merged: cleaned, delta: cleaned.slice(current.length) };
  if (current.endsWith(cleaned)) return { merged: current, delta: "" };
  return { merged: `${current}${cleaned}`, delta: cleaned };
}

function normalizedSpeech(value: string): string | null {
  const speech = value.replace(/\s+/g, " ").trim();
  return speech && speech.length <= 360 ? speech : null;
}

function neutralTurn(speech: string): ModelTurn {
  return {
    protocolVersion: 1,
    speech,
    memory: null,
    performance: {
      version: 1,
      expression: "normal",
      motionCue: "none",
      voiceStyle: "neutral",
      pause: "none",
    },
  };
}

function enqueue(controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) {
  controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
}

function contextFromChat(body: ChatRequest): LiveVoiceContextInput | null {
  const messages = body.messages;
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== "user" || !latest.text.trim()) return null;
  return {
    persona: body.persona,
    userName: body.userName,
    affection: body.affection,
    messages: messages.slice(0, -1),
    memories: body.memories,
  };
}

function tokenPayload(context: LiveVoiceContextInput) {
  return {
    personaId: context.persona.id,
    userName: context.userName,
    affection: context.affection,
    messages: context.messages.map((message) => ({ role: message.role, text: message.text, at: message.at })),
    memories: context.memories,
  };
}

function closeSession(state: BridgeState) {
  state.connectSerial += 1;
  const session = state.session;
  state.session = null;
  state.sessionContextKey = null;
  state.connectPromise = null;
  if (session) {
    try { session.close(); } catch { /* already closed */ }
  }
}

async function connectContext(context: LiveVoiceContextInput): Promise<boolean> {
  const state = bridgeState;
  if (!state?.enabled || state.active) return false;
  const desiredKey = liveVoiceContextKey(context);
  if (state.session && state.sessionContextKey === desiredKey) return true;
  if (state.connectPromise && state.sessionContextKey === desiredKey) return state.connectPromise;

  closeSession(state);
  const serial = state.connectSerial;
  state.sessionContextKey = desiredKey;

  const promise = (async () => {
    try {
      const tokenResponse = await state.originalFetch("/api/live/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tokenPayload(context)),
      });
      if (!tokenResponse.ok) return false;
      const token = await tokenResponse.json() as Partial<TokenResponse>;
      if (!token.token || !token.model) return false;
      if (!bridgeState || bridgeState !== state || state.connectSerial !== serial || !state.enabled || state.active) return false;

      const ai = new GoogleGenAI({
        apiKey: token.token,
        httpOptions: { apiVersion: LIVE_VOICE_API_VERSION },
      });
      const session = await ai.live.connect({
        model: token.model,
        config: { responseModalities: [Modality.AUDIO] },
        callbacks: {
          onmessage(message) {
            void handleLiveMessage(serial, message);
          },
          onerror() {
            void handleLiveFailure(serial, "provider_error");
          },
          onclose() {
            void handleLiveFailure(serial, "provider_closed");
          },
        },
      });

      if (!bridgeState || bridgeState !== state || state.connectSerial !== serial || !state.enabled || state.active) {
        try { session.close(); } catch { /* stale */ }
        return false;
      }
      state.session = session;
      state.sessionContextKey = token.contextKey || desiredKey;
      return true;
    } catch {
      return false;
    } finally {
      if (bridgeState === state && state.connectSerial === serial) state.connectPromise = null;
    }
  })();

  state.connectPromise = promise;
  return promise;
}

export async function primeLiveVoiceSession(context: LiveVoiceContextInput): Promise<boolean> {
  const state = bridgeState;
  if (!state?.enabled || state.active) return false;
  void state.player.prepare();
  return connectContext(context);
}

export function setLiveVoiceMode(enabled: boolean) {
  const state = bridgeState;
  if (!state) return;
  state.enabled = enabled;
  if (!enabled) {
    state.player.interrupt();
    closeSession(state);
  }
}

async function pipeFallback(active: ActiveTurn) {
  const state = bridgeState;
  if (!state || state.active !== active || active.fallbackStarted) return;
  active.fallbackStarted = true;
  try {
    const response = await state.originalFetch(active.input, active.init);
    const wrapped = wrapLegacyChatResponse(response, active.body.persona.id, state.cache);
    if (!wrapped.body) throw new Error("missing fallback body");
    const reader = wrapped.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      active.controller.enqueue(value);
    }
    active.controller.close();
  } catch {
    try {
      enqueue(active.controller, {
        type: "turn_error",
        turnId: active.turnId,
        message: "（通信がうまくいかなかったみたい。もう一度送ってね）",
      });
      active.controller.close();
    } catch { /* stream already closed */ }
  } finally {
    if (bridgeState === state && state.active === active) state.active = null;
    closeSession(state);
  }
}

async function handleLiveFailure(serial: number, _reason: string) {
  const state = bridgeState;
  const active = state?.active;
  if (!state || !active || active.sessionSerial !== serial || active.finishing) return;
  state.player.interrupt();

  if (!active.audioReceived) {
    await pipeFallback(active);
    return;
  }

  try {
    enqueue(active.controller, {
      type: "turn_error",
      turnId: active.turnId,
      message: "（声が途中で途切れたみたい。もう一度送ってね）",
    });
    active.controller.close();
  } catch { /* stream already closed */ }
  if (state.active === active) state.active = null;
  closeSession(state);
}

async function finalizeActive(active: ActiveTurn) {
  const state = bridgeState;
  if (!state || state.active !== active || active.finishing) return;
  active.finishing = true;
  state.player.endTurn();

  const speech = normalizedSpeech(active.transcript);
  if (!speech) {
    active.finishing = false;
    await handleLiveFailure(active.sessionSerial, "missing_transcript");
    return;
  }

  let turn = neutralTurn(speech);
  try {
    const response = await state.originalFetch("/api/live/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        turnId: active.turnId,
        personaId: active.body.persona.id,
        speech,
        userName: active.body.userName,
        affection: active.body.affection,
        look: active.body.look,
        memories: active.body.memories,
        messages: active.body.messages,
      }),
    });
    if (response.ok) {
      const payload = await response.json() as { turn?: unknown };
      turn = validateModelTurn(payload.turn) ?? turn;
      if (turn.speech !== speech) turn = neutralTurn(speech);
    }
  } catch {
    // Final speech is already provider-complete; metadata safely degrades to neutral.
  }

  if (active.pcmBytes > 0 && active.pcmBytes <= MAX_DIRECT_PCM_BYTES) {
    const pcm = concatBytes(active.pcmChunks, active.pcmBytes);
    const wav = pcm16MonoToWav(pcm, pcmRate(active.mimeType));
    const blob = new Blob([wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer], {
      type: "audio/wav",
    });
    const speechKey = liveAudioSpeechKey(active.body.persona.id, speech);
    remember(state.cache, speechKey, blob);
    if (active.streamingStarted) state.skipNextTts.add(speechKey);
  }

  try {
    if (turn.narration) enqueue(active.controller, { type: "narration_preview", turnId: active.turnId, narration: turn.narration });
    enqueue(active.controller, { type: "performance_preview", turnId: active.turnId, performance: turn.performance });
    enqueue(active.controller, { type: "turn_complete", turnId: active.turnId, turn });
    active.controller.close();
  } catch { /* aborted consumer */ }

  if (state.active === active) state.active = null;
  closeSession(state);
}

async function handleLiveMessage(serial: number, message: Parameters<NonNullable<Parameters<GoogleGenAI["live"]["connect"]>[0]["callbacks"]>["onmessage"]>[0]) {
  const state = bridgeState;
  const active = state?.active;
  if (!state || !active || active.sessionSerial !== serial || active.finishing) return;
  const content = message.serverContent;

  const nextTranscript = content?.outputTranscription?.text;
  if (nextTranscript) {
    const merged = appendTranscript(active.transcript, nextTranscript);
    active.transcript = merged.merged;
    if (merged.delta) {
      try { enqueue(active.controller, { type: "speech_delta", turnId: active.turnId, text: merged.delta }); } catch { /* aborted */ }
    }
  }

  for (const part of content?.modelTurn?.parts ?? []) {
    const encoded = part.inlineData?.data;
    if (!encoded) continue;
    active.audioReceived = true;
    active.firstChunkAt ??= performance.now();
    if (part.inlineData?.mimeType) active.mimeType = part.inlineData.mimeType;
    const pcm = decodePcmBytes(encoded);
    if (pcm && active.pcmBytes + pcm.byteLength <= MAX_DIRECT_PCM_BYTES) {
      active.pcmChunks.push(pcm);
      active.pcmBytes += pcm.byteLength;
    }
    state.player.pushBase64Pcm(encoded, part.inlineData?.mimeType);
  }

  if (content?.interrupted) {
    await handleLiveFailure(serial, "interrupted");
    return;
  }
  if (content?.generationComplete || content?.turnComplete) {
    await finalizeActive(active);
  }
}

async function directChatResponse(
  input: RequestInfo | URL,
  init: RequestInit,
  body: ChatRequest,
): Promise<Response | null> {
  const state = bridgeState;
  if (!state?.enabled) return null;
  const context = contextFromChat(body);
  if (!context) return null;

  // fetch()自体はsend tapのcall stack内から呼ばれるため、ここでresumeを開始する。
  void state.player.unlock();
  const desiredKey = liveVoiceContextKey(context);
  if (!state.session || state.sessionContextKey !== desiredKey) {
    const connected = await connectContext(context);
    if (!connected || !state.session) return null;
  }

  if (state.active) return null;
  const session = state.session;
  const serial = state.connectSerial;
  const latestUser = body.messages[body.messages.length - 1];
  if (!latestUser || latestUser.role !== "user" || !latestUser.text.trim()) return null;

  let active!: ActiveTurn;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      active = {
        turnId: body.turnId,
        body,
        input,
        init,
        controller,
        sessionSerial: serial,
        transcript: "",
        pcmChunks: [],
        pcmBytes: 0,
        mimeType: "audio/pcm;rate=24000",
        audioReceived: false,
        streamingStarted: false,
        finishing: false,
        fallbackStarted: false,
        startedAt: performance.now(),
        firstChunkAt: null,
      };
      state.active = active;
      state.player.beginTurn();
      enqueue(controller, { type: "turn_started", turnId: body.turnId });

      const signal = init.signal;
      if (signal) {
        const abort = () => {
          if (bridgeState !== state || state.active !== active) return;
          state.player.interrupt();
          state.active = null;
          closeSession(state);
          try { controller.close(); } catch { /* already closed */ }
        };
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }

      queueMicrotask(() => {
        if (bridgeState !== state || state.active !== active) return;
        try {
          session.sendRealtimeInput({ text: latestUser.text.trim() });
        } catch {
          void handleLiveFailure(serial, "send_failed");
        }
      });
    },
    cancel() {
      if (bridgeState !== state || state.active !== active) return;
      state.player.interrupt();
      state.active = null;
      closeSession(state);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Chat-Provider": "gemini-live-v2",
    },
  });
}

function wrapLegacyChatResponse(response: Response, personaId: string, cache: Map<string, Blob>): Response {
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
        if (decoded) {
          remember(cache, decoded.key, decoded.blob);
          remember(cache, decoded.speechKey, decoded.blob);
        }
      } catch { /* ordinary dialogue event */ }
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
            if (decoded) {
              remember(cache, decoded.key, decoded.blob);
              remember(cache, decoded.speechKey, decoded.blob);
            }
          } catch { /* incomplete trailing data */ }
        }
        controller.close();
        return;
      }
      inspect(decoder.decode(value, { stream: true }));
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
    return () => releaseBridge();
  }

  const originalFetch = globalThis.fetch.bind(globalThis);
  const cache = new Map<string, Blob>();
  const skipNextTts = new Set<string>();
  const player = new LivePcmPlayer((state) => {
    if (state === "playing" && bridgeState?.active) bridgeState.active.streamingStarted = true;
  });

  const bridgedFetch: typeof fetch = async (input, init) => {
    const state = bridgeState;
    if (!state) return originalFetch(input, init);
    const path = requestPath(input);

    if (path === "/api/tts") {
      const keys = ttsKeysFromRequest(init);
      if (keys && state.skipNextTts.has(keys.speechKey)) {
        state.skipNextTts.delete(keys.speechKey);
        return new Response(null, {
          status: 204,
          headers: {
            "Cache-Control": "private, no-store",
            "X-TTS-Provider": "gemini-live-v2-already-played",
          },
        });
      }
      const blob = keys ? state.cache.get(keys.key) ?? state.cache.get(keys.speechKey) : undefined;
      if (blob) {
        return new Response(blob, {
          status: 200,
          headers: {
            "Content-Type": blob.type || "audio/wav",
            "Cache-Control": "private, no-store",
            "X-TTS-Provider": "gemini-live-v2-cache",
          },
        });
      }
    }

    if (path === "/api/chat" && state.enabled && typeof init?.body === "string") {
      const body = parseChatRequest(init);
      if (body) {
        const direct = await directChatResponse(input, init, body);
        if (direct) return direct;
      }
    }

    const response = await originalFetch(input, init);
    if (path !== "/api/chat") return response;
    const body = parseChatRequest(init);
    return body ? wrapLegacyChatResponse(response, body.persona.id, state.cache) : response;
  };

  bridgeState = {
    refs: 1,
    originalFetch,
    bridgedFetch,
    cache,
    skipNextTts,
    enabled: false,
    player,
    session: null,
    sessionContextKey: null,
    connectSerial: 1,
    connectPromise: null,
    active: null,
  };
  globalThis.fetch = bridgedFetch;
  void player.prepare();

  return () => releaseBridge();
}

function releaseBridge() {
  const state = bridgeState;
  if (!state) return;
  state.refs -= 1;
  if (state.refs > 0) return;
  if (globalThis.fetch === state.bridgedFetch) globalThis.fetch = state.originalFetch;
  state.player.interrupt();
  void state.player.dispose();
  closeSession(state);
  bridgeState = null;
}
