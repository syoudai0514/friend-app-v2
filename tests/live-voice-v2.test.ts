import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS } from "../src/lib/personas";
import {
  LIVE_VOICE_BY_PERSONA,
  buildLiveVoiceSystemInstruction,
  liveVoiceContextKey,
} from "../src/lib/live-voice-config";

const shizuku = PRESETS.find((entry) => entry.persona.id === "shizuku")?.persona;
assert.ok(shizuku);

test("Live Voice V2 uses the first audition casting", () => {
  assert.equal(LIVE_VOICE_BY_PERSONA.aimi, "Zephyr");
  assert.equal(LIVE_VOICE_BY_PERSONA.shizuku, "Aoede");
  assert.equal(LIVE_VOICE_BY_PERSONA.nagi, "Kore");
  assert.equal(LIVE_VOICE_BY_PERSONA.hinata, "Leda");
  assert.equal(LIVE_VOICE_BY_PERSONA.rena, "Gacrux");
});

test("Shizuku Live instruction is cute soft gyaru and excludes hidden metadata", () => {
  const instruction = buildLiveVoiceSystemInstruction({
    persona: shizuku,
    userName: "せんぱい",
    affection: 42,
    messages: [
      { role: "user", text: "今日は疲れた", at: 1 },
      {
        role: "model",
        text: "おつかれさま",
        at: 2,
        narration: "SECRET_NARRATION",
        performance: { version: 1, expression: "happy", motionCue: "lean_in" },
      },
    ],
    memories: ["OLD_MEMORY_NOT_SENT", "好きな飲み物はコーヒー", "最近よく眠れていない", "直近の約束"],
  });

  assert.match(instruction, /ゆるふわ/);
  assert.match(instruction, /ギャル/);
  assert.doesNotMatch(instruction, /SECRET_NARRATION/);
  assert.doesNotMatch(instruction, /lean_in/);
  assert.doesNotMatch(instruction, /OLD_MEMORY_NOT_SENT/);
  assert.match(instruction, /好きな飲み物はコーヒー/);
  assert.match(instruction, /直近の約束/);
});

test("context key ignores narration/performance and uses canonical speech only", () => {
  const base = {
    persona: shizuku,
    userName: "せんぱい",
    affection: 42,
    memories: ["メモ"],
  };
  const first = liveVoiceContextKey({
    ...base,
    messages: [{ role: "model", text: "同じ台詞", at: 1, narration: "A" }],
  });
  const second = liveVoiceContextKey({
    ...base,
    messages: [{
      role: "model",
      text: "同じ台詞",
      at: 99,
      narration: "B",
      performance: { version: 1, expression: "shy" },
    }],
  });
  assert.equal(first, second);
});
