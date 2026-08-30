import test from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "../src/lib/store";

test("existing v1/v2 saves keep ChatMessage.text and gain additive voice defaults", () => {
  const legacy = {
    onboarded: true,
    userName: "ユーザー",
    persona: {
      id: "shizuku",
      name: "しずく",
      firstPerson: "私",
      honorific: "さん",
      speech: "丁寧",
      personality: "穏やか",
      idleLines: ["おかえり"],
    },
    look: { scene: "room", outfit: "legacy-outfit" },
    affection: 7,
    messages: [
      { role: "user", text: "ただいま", at: 1 },
      { role: "model", text: "おかえりなさい。", at: 2, unknownRuntimeField: "drop-me" },
    ],
    memories: ["コーヒーが好き"],
  };
  const next = reconcile(legacy);
  assert.equal(next.messages[1].text, "おかえりなさい。");
  assert.equal(next.voice.enabled, false);
  assert.equal(next.voice.autoplay, false);
  assert.equal("unknownRuntimeField" in (next.messages[1] as object), false);
});

test("new optional narration/performance survive reconcile without changing speech text", () => {
  const saved = {
    schemaVersion: 2,
    onboarded: true,
    userName: "ユーザー",
    persona: { id: "nagi", name: "なぎ", firstPerson: "私", honorific: "", speech: "短い", personality: "クール", idleLines: [] },
    look: { variantId: "default", scene: "room", motionId: "idle" },
    affection: 1,
    messages: [{
      role: "model",
      text: "別に、待ってない。",
      at: 3,
      narration: "なぎは少しだけ視線を外した。",
      performance: { version: 1, expression: "shy", motionCue: "look_away" },
    }],
    memories: [],
    personas: {},
    voice: { enabled: true, autoplay: false },
  };
  const next = reconcile(saved);
  assert.equal(next.messages[0].text, "別に、待ってない。");
  assert.equal(next.messages[0].narration, "なぎは少しだけ視線を外した。");
  assert.equal(next.messages[0].performance?.expression, "shy");
  assert.equal(next.voice.enabled, true);
});
