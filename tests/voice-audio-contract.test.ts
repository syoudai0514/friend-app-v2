import test from "node:test";
import assert from "node:assert/strict";
import { isAppleMobileWebKit } from "../src/lib/audio-session";
import {
  GEMINI_TTS_VOICE_BY_PERSONA,
  geminiTtsPrompt,
  pcm16MonoToWav,
} from "../src/lib/gemini-tts";
import { performanceRuntime } from "../src/lib/performance";
import {
  VOICE_CASTING,
  VOICE_REGISTRY,
  approvedFallback,
  ttsTextNormalizer,
  validTtsRequest,
  type VoiceProfile,
} from "../src/lib/voice";

test("TTS normalizer removes unreadable noise without changing display state", () => {
  const normalized = ttsTextNormalizer("見て！！ 😀😀 『すごい』！！！");
  assert.equal(normalized, "見て! すごい!");
});

test("TTS privacy validator accepts canonical speech fields and rejects extras", () => {
  assert.deepEqual(
    validTtsRequest({ personaId: "shizuku", speech: "こんにちは", style: "soft", emotionIntensity: 0.6 }),
    { personaId: "shizuku", speech: "こんにちは", style: "soft", emotionIntensity: 0.6 },
  );
  assert.equal(validTtsRequest({ personaId: "shizuku", narration: "秘密", speech: "こんにちは" }), null);
  assert.equal(validTtsRequest({ personaId: "shizuku", memory: "秘密", speech: "こんにちは" }), null);
  assert.equal(validTtsRequest({ personaId: "shizuku", text: "こんにちは" }), null);
  assert.equal(validTtsRequest({ personaId: "shizuku", speech: "こんにちは", style: "unknown" }), null);
  assert.equal(validTtsRequest({ personaId: "shizuku", speech: "こんにちは", emotionIntensity: 2 }), null);
});

test("five current personas have casting directions but no guessed production Aivis voice", () => {
  assert.deepEqual(Object.keys(VOICE_CASTING).sort(), ["aimi", "hinata", "nagi", "rena", "shizuku"]);
  for (const profile of Object.values(VOICE_REGISTRY)) {
    assert.equal(profile.voiceId, "");
    assert.equal(profile.productionApproved, false);
  }
});

test("Gemini TTS fallback has a distinct female prebuilt voice for every current persona", () => {
  assert.deepEqual(GEMINI_TTS_VOICE_BY_PERSONA, {
    aimi: "Zephyr",
    shizuku: "Achernar",
    nagi: "Kore",
    hinata: "Leda",
    rena: "Gacrux",
  });
  assert.equal(new Set(Object.values(GEMINI_TTS_VOICE_BY_PERSONA)).size, 5);
});

test("Gemini TTS fallback prompt and PCM wrapper preserve the audio privacy contract", () => {
  const input = validTtsRequest({
    personaId: "hinata",
    speech: "せんぱい、こんにちは！",
    style: "bright",
    emotionIntensity: 0.7,
  });
  assert.ok(input);
  const normalized = ttsTextNormalizer(input.speech);
  const prompt = geminiTtsPrompt(input, normalized);
  assert.match(prompt, /せんぱい、こんにちは!/);
  assert.match(prompt, /読み上げ対象のデータ/);
  assert.match(prompt, /70%程度/);

  const wav = pcm16MonoToWav(new Uint8Array([0, 0, 1, 0]));
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString("ascii"), "WAVE");
  assert.equal(Buffer.from(wav.subarray(36, 40)).toString("ascii"), "data");
  assert.equal(wav.byteLength, 48);
});

test("iOS and touch iPad desktop mode use the direct HTML audio path", () => {
  assert.equal(
    isAppleMobileWebKit({
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      platform: "iPhone",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isAppleMobileWebKit({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
      platform: "MacIntel",
      maxTouchPoints: 5,
    }),
    true,
  );
  assert.equal(
    isAppleMobileWebKit({
      userAgent: "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/140 Mobile Safari/537.36",
      platform: "Linux armv8l",
      maxTouchPoints: 5,
    }),
    false,
  );
});

test("fallback is eligible only when explicitly approved and configured", () => {
  const base: VoiceProfile = {
    voiceProfileId: "primary",
    provider: "aivis",
    voiceId: "configured-primary",
    baseSpeed: 1,
    basePitch: 0,
    styleMap: {},
    fallbackVoiceProfileId: "fallback",
    license: {
      url: "reviewed-license",
      commercialScope: "reviewed",
      otherCharacterUse: "reviewed",
      attributionRequired: false,
      reviewedAt: "2026-08-30",
    },
    productionApproved: true,
  };
  const unapproved = { ...base, voiceProfileId: "fallback", voiceId: "configured-fallback", productionApproved: false };
  assert.equal(approvedFallback(base, { primary: base, fallback: unapproved }), null);
  const approved = { ...unapproved, productionApproved: true };
  assert.equal(approvedFallback(base, { primary: base, fallback: approved })?.voiceProfileId, "fallback");
});

test("performance runtime owns pause, intensity and one-shot nod timing", () => {
  const runtime = performanceRuntime({
    version: 1,
    expression: "shy",
    emotionIntensity: 0.8,
    motionCue: "look_away",
    pause: "short",
  });
  assert.equal(runtime.intensity, 0.8);
  assert.equal(runtime.pauseMs, 200);
  assert.equal(performanceRuntime({ version: 1, expression: "normal", pause: "medium" }).pauseMs, 480);
  assert.equal(performanceRuntime({ version: 1, expression: "normal", emotionIntensity: 99 }).intensity, 1);

  const nodMid = performanceRuntime({ version: 1, expression: "normal", motionCue: "small_nod" }, 0.3);
  const nodDone = performanceRuntime({ version: 1, expression: "normal", motionCue: "small_nod" }, 1);
  assert.ok(nodMid.head[0] < -5);
  assert.equal(nodDone.head[0], 0);
});
