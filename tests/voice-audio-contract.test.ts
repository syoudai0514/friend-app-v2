import test from "node:test";
import assert from "node:assert/strict";
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

test("five current personas have casting directions but no guessed production voice", () => {
  assert.deepEqual(Object.keys(VOICE_CASTING).sort(), ["aimi", "hinata", "nagi", "rena", "shizuku"]);
  for (const profile of Object.values(VOICE_REGISTRY)) {
    assert.equal(profile.voiceId, "");
    assert.equal(profile.productionApproved, false);
  }
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
