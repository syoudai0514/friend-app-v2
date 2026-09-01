"use client";

// ManaEvo CURRENT と同じ Piper Plus + つくよみちゃん ONNX のブラウザ内TTS。
// モデルだけでなく、Piperのbuilt-in speaker選択・config・iOS実行経路まで揃える。
export const TSUKUYOMI_MODEL_URL =
  "https://huggingface.co/ayousanz/piper-plus-tsukuyomi-chan/resolve/36b59c825c36bd386b8960cf3f604382f52f2a87/tsukuyomi-chan-6lang-fp16.onnx";

const DEFAULT_SAMPLE_RATE = 22050;
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
    return null;
  }
}

// ManaEvo narratorCache.js と同じ役割。IndexedDB上のONNX bytesだけを一度ORTへ渡し、
// それ以外のsession options / inference feedsには一切介入しない。
function ortWithCachedModel(ort, cachedModel) {
  if (!cachedModel?.modelData || !cachedModel?.modelUrl) return ort;
  let modelData = cachedModel.modelData;
  return {
    ...ort,
    InferenceSession: {
      create: async (source, options) => {
        if (source === cachedModel.modelUrl && modelData) {
          const bytes = modelData;
          modelData = null;
          cachedModel.modelData = null;
          return ort.InferenceSession.create(bytes, options);
        }
        return ort.InferenceSession.create(source, options);
      },
    },
  };
}

async function initializeNarrator() {
  if (narrator) return narrator;
  if (narratorPromise) return narratorPromise;

  narratorPromise = (async () => {
    // ManaEvo同様、iPhoneのピークメモリを抑えるため重いモジュールを順番に読む。
    const { PiperPlus, ModelManager } = await import("piper-plus");
    const ort = await import("onnxruntime-web/wasm");

    if (isAppleTouchDevice() && ort.env?.wasm) {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
    }

    const cachedModel = await loadCachedModel(ModelManager);
    const model = cachedModel?.modelUrl || TSUKUYOMI_MODEL_URL;
    narrator = await PiperPlus.initialize({
      model,
      // ManaEvoで保存したONNXと同じconfigを必ず対で使う。
      modelConfig: cachedModel?.config,
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

function splitForNarrator(text) {
  // ManaEvo CURRENT: iPhone 18文字、その他24文字。
  const maxChars = isAppleTouchDevice() ? 18 : 24;
  const parts = text.match(/[^、。！？!?]+[、。！？!?]?/g) || [text];
  const result = [];
  const withListeningPause = (value) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return /[、。！？!?]$/.test(trimmed) ? trimmed : `${trimmed}、`;
  };
  let current = "";
  const pushChunks = (value) => {
    for (let start = 0; start < value.length; start += maxChars) {
      const chunk = withListeningPause(value.slice(start, start + maxChars));
      if (chunk) result.push(chunk);
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
  let peak = 0;
  for (const value of samples) peak = Math.max(peak, Math.abs(Number(value) || 0));
  const gain = peak > 0 ? Math.min(1.35, 0.82 / peak) : 1;
  const output = new Uint8Array(samples.length * 2);
  const view = new DataView(output.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, (Number(samples[index]) || 0) * gain));
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

  for (const sentence of splitForNarrator(normalizeSpeech(text))) {
    aborted(signal);
    // 重要: ManaEvoと同じく speakerEmbedding は渡さない。
    // postinstallで適用するManaEvo runtime patchが zero-vector + mask=0 を作り、
    // モデル内蔵のつくよみちゃん話者を選ぶ。
    const result = await tts.synthesize(sentence, {
      language: "ja",
      lengthScale: 1.5,
      noiseScale: 0.54,
      noiseW: 0.62,
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
  speakerSelection: "manaevo-built-in-mask-0",
};
