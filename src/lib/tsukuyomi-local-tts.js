"use client";

// ManaEvo で実機運用している Piper Plus + つくよみちゃん ONNX 構成を
// friend-app-v2 向けに最小化したブラウザ内 TTS。会話文は外部 TTS へ送らない。
export const TSUKUYOMI_MODEL_URL =
  "https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan/resolve/36b59c825c36bd386b8960cf3f604382f52f2a87/tsukuyomi-chan-6lang-fp16.onnx";

const DEFAULT_SAMPLE_RATE = 22050;
const SPEAKER_EMBEDDING_SIZE = 256;
const CACHE_DB_NAME = "piper-plus-models";

let narrator = null;
let narratorPromise = null;
let inferenceQueue = Promise.resolve();

export function isTsukuyomiPersona(personaId) {
  return personaId === "shizuku";
}

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function aborted(signal) {
  if (!signal?.aborted) return;
  throw new DOMException("Aborted", "AbortError");
}

async function createJapanesePhonemizerModule() {
  const wasm = await import("piper-plus/wasm/multilingual");
  await wasm.default();

  class JapaneseDictionaryPhonemizer {
    constructor(configJson) {
      this.delegate = new wasm.WasmPhonemizer(configJson);
    }
    getSupportedLanguages() { return ["ja"]; }
    detectLanguage() { return "ja"; }
    phonemize(text) { return this.delegate.phonemize(text, "ja"); }
    free() { this.delegate?.free?.(); }
  }

  return { WasmPhonemizer: JapaneseDictionaryPhonemizer };
}

async function loadCachedModel(ModelManager) {
  if (typeof indexedDB === "undefined") return null;
  try {
    globalThis.navigator?.storage?.persist?.().catch(() => {});
    const manager = new ModelManager();
    const urls = await manager.resolveUrls(TSUKUYOMI_MODEL_URL);
    const cached = await manager.getFromCache(urls.cacheKey);
    if (cached?.modelData) return { ...urls, ...cached };
    const loaded = await manager.loadModel(TSUKUYOMI_MODEL_URL);
    return { ...urls, ...loaded };
  } catch {
    // IndexedDB を使えない環境では Piper 自身の通常 fetch にフォールバックする。
    return null;
  }
}

function metadataShape(session, inputName) {
  const index = session.inputNames?.indexOf?.(inputName) ?? -1;
  const metadata = session.inputMetadata;
  const item = Array.isArray(metadata)
    ? metadata[index]
    : metadata?.[inputName];
  const shape = item?.shape || item?.dimensions || item?.dims;
  return Array.isArray(shape) && shape.length > 0 && shape.every((value) => Number.isInteger(value) && value > 0)
    ? shape
    : [1, 1];
}

function wrapSession(ort, session) {
  const originalRun = session.run.bind(session);
  return new Proxy(session, {
    get(target, property) {
      if (property === "run") {
        return async (feeds, ...args) => {
          const nextFeeds = { ...feeds };
          if (nextFeeds.speaker_embedding_mask && target.inputNames?.includes?.("speaker_embedding_mask")) {
            // zero embedding + mask=0 でモデル組み込みのつくよみちゃん話者を選ぶ。
            nextFeeds.speaker_embedding_mask = new ort.Tensor(
              "int64",
              new BigInt64Array([0n]),
              metadataShape(target, "speaker_embedding_mask"),
            );
          }
          return originalRun(nextFeeds, ...args);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function ortWithCachedModel(ort, cachedModel) {
  let modelData = cachedModel?.modelData || null;
  const modelUrl = cachedModel?.modelUrl || null;
  const originalCreate = ort.InferenceSession.create.bind(ort.InferenceSession);

  return {
    ...ort,
    InferenceSession: {
      ...ort.InferenceSession,
      create: async (source, options = {}) => {
        const apple = isAppleTouchDevice();
        const sessionOptions = apple
          ? {
              ...options,
              executionProviders: ["wasm"],
              graphOptimizationLevel: "extended",
              enableMemPattern: false,
              enableCpuMemArena: false,
              executionMode: "sequential",
            }
          : options;
        const actualSource = source === modelUrl && modelData ? modelData : source;
        if (actualSource === modelData) {
          modelData = null;
          if (cachedModel) cachedModel.modelData = null;
        }
        const session = await originalCreate(actualSource, sessionOptions);
        return wrapSession(ort, session);
      },
    },
  };
}

async function initializeNarrator() {
  if (narrator) return narrator;
  if (narratorPromise) return narratorPromise;

  narratorPromise = (async () => {
    const [{ PiperPlus, ModelManager }, importedOrt] = await Promise.all([
      import("piper-plus"),
      import("onnxruntime-web/wasm"),
    ]);
    const ort = importedOrt.default || importedOrt;
    if (isAppleTouchDevice() && ort.env?.wasm) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    }
    const cachedModel = await loadCachedModel(ModelManager);
    const model = cachedModel?.modelUrl || TSUKUYOMI_MODEL_URL;
    narrator = await PiperPlus.initialize({
      model,
      ort: ortWithCachedModel(ort, cachedModel),
      wasmLoader: async () => createJapanesePhonemizerModule(),
    });
    return narrator;
  })().catch((error) => {
    narratorPromise = null;
    narrator = null;
    throw error;
  });

  return narratorPromise;
}

export async function prepareTsukuyomiVoice() {
  await initializeNarrator();
}

function normalizeSpeech(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[\r\n]+/g, "。")
    .replace(/[「」『』（）()]/g, "、")
    .replace(/[、,]{2,}/g, "、")
    .replace(/、(?=[。！？!?])/g, "")
    .trim();
}

function splitForNarrator(text) {
  const maxChars = isAppleTouchDevice() ? 18 : 28;
  const parts = text.match(/[^、。！？!?]+[、。！？!?]?/g) || [text];
  const result = [];
  let current = "";

  const pushChunks = (value) => {
    for (let start = 0; start < value.length; start += maxChars) {
      const raw = value.slice(start, start + maxChars).trim();
      if (!raw) continue;
      result.push(/[、。！？!?]$/.test(raw) ? raw : `${raw}、`);
    }
  };

  for (const part of parts) {
    if (current && current.length + part.length > maxChars) {
      pushChunks(current);
      current = "";
    }
    current += part;
    if (current.length >= maxChars) {
      pushChunks(current);
      current = "";
    }
  }
  if (current) pushChunks(current);
  return result;
}

function floatSamplesToPcm16(samples) {
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(samples[index]) || 0));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

function buildWavBlob(chunks, sampleRate) {
  const dataSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

async function synthesizeInternal(text, signal) {
  aborted(signal);
  const tts = await initializeNarrator();
  aborted(signal);
  const chunks = [];
  let sampleRate = DEFAULT_SAMPLE_RATE;
  const speakerEmbedding = new Float32Array(SPEAKER_EMBEDDING_SIZE);

  for (const sentence of splitForNarrator(normalizeSpeech(text))) {
    aborted(signal);
    const result = await tts.synthesize(sentence, {
      language: "ja",
      lengthScale: 1.5,
      noiseScale: 0.54,
      noiseW: 0.62,
      speakerEmbedding,
    });
    aborted(signal);
    const samples = result?.samples instanceof Float32Array
      ? result.samples
      : result?.audio instanceof Float32Array
        ? result.audio
        : null;
    if (!samples || samples.length < 100) throw new Error("Tsukuyomi produced no audio");
    if (Number.isFinite(result?.sampleRate)) sampleRate = result.sampleRate;
    chunks.push(floatSamplesToPcm16(samples));
  }

  if (!chunks.length) throw new Error("Tsukuyomi speech is empty");
  return buildWavBlob(chunks, sampleRate);
}

export function synthesizeTsukuyomiSpeech(text, { signal } = {}) {
  const run = inferenceQueue.then(() => synthesizeInternal(text, signal));
  inferenceQueue = run.then(() => undefined, () => undefined);
  return run;
}

export const TSUKUYOMI_CACHE_INFO = {
  database: CACHE_DB_NAME,
  storage: "IndexedDB",
  synthesis: "browser-local",
};
