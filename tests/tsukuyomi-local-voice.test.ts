import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  TSUKUYOMI_CACHE_INFO,
  TSUKUYOMI_MODEL_URL,
  isTsukuyomiPersona,
} from "../src/lib/tsukuyomi-local-tts";
import {
  SHIZUKU_TSUKUYOMI_PERSONA,
  rewriteShizukuChatPayload,
} from "../src/lib/shizuku-tsukuyomi-bridge";

test("Shizuku alone uses the browser-local Tsukuyomi voice", () => {
  assert.equal(isTsukuyomiPersona("shizuku"), true);
  assert.equal(isTsukuyomiPersona("aimi"), false);
  assert.equal(TSUKUYOMI_CACHE_INFO.synthesis, "browser-local");
  assert.equal(TSUKUYOMI_CACHE_INFO.storage, "IndexedDB");
  assert.equal(TSUKUYOMI_CACHE_INFO.speakerSelection, "manaevo-built-in-mask-0");
});

test("Tsukuyomi model is pinned to the ManaEvo-tested FP16 revision", () => {
  assert.match(TSUKUYOMI_MODEL_URL, /36b59c825c36bd386b8960cf3f604382f52f2a87/);
  assert.match(TSUKUYOMI_MODEL_URL, /tsukuyomi-chan-6lang-fp16\.onnx$/);
});

test("Shizuku runtime follows ManaEvo built-in-speaker inference instead of a fake caller embedding", () => {
  const source = readFileSync("src/lib/tsukuyomi-local-tts.js", "utf8");
  assert.match(source, /modelConfig: cachedModel\?\.config/);
  assert.doesNotMatch(source, /speakerEmbedding\s*[,}]/);
  assert.doesNotMatch(source, /function wrapSession/);

  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts.postinstall, "node scripts/apply-piper-plus-manaevo-patch.mjs");

  const patcher = readFileSync("scripts/apply-piper-plus-manaevo-patch.mjs", "utf8");
  assert.match(patcher, /hasEmbedding \? 1n : 0n/);
  assert.match(patcher, /new Float32Array\(this\._speakerEmbeddingSize \|\| 256\)/);
});

test("Shizuku never silently falls through to another TTS provider", () => {
  const bridge = readFileSync("src/lib/shizuku-tsukuyomi-bridge.js", "utf8");
  assert.match(bridge, /TSUKUYOMI_LOCAL_TTS_FAILED/);
  assert.doesNotMatch(bridge, /ローカル推論だけが失敗した時は既存 Gemini TTS/);
});

test("Shizuku text generation keeps the adult sweet-lover persona when Gemini Live is bypassed", () => {
  const original = {
    turnId: "turn-1",
    persona: {
      id: "shizuku",
      name: "しずく",
      speech: "old speech",
      personality: "old personality",
    },
  };
  const rewritten = rewriteShizukuChatPayload(original);
  assert.notEqual(rewritten, original);
  assert.equal(original.persona.speech, "old speech");
  assert.match(rewritten.persona.speech, /甘いタメ口/);
  assert.match(rewritten.persona.speech, /色っぽい/);
  assert.match(rewritten.persona.personality, /20代の成人女性/);
  assert.match(rewritten.persona.personality, /恋人/);
  assert.doesNotMatch(rewritten.persona.speech, /子供/);
  assert.match(SHIZUKU_TSUKUYOMI_PERSONA.personality, /安心感と艶/);
});

test("other personas are not rewritten", () => {
  const payload = { persona: { id: "aimi", speech: "keep", personality: "keep" } };
  assert.equal(rewriteShizukuChatPayload(payload), payload);
});
