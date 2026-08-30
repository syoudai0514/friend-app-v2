import test from "node:test";
import assert from "node:assert/strict";
import {
  legacyTextToModelTurn,
  parseDialogueEvent,
  partialJsonString,
  validateModelTurn,
} from "../src/lib/dialogue";
import {
  applyConversationTransaction,
  ConversationTransactionLedger,
} from "../src/lib/conversation-transaction";
import type { AppState, ModelTurn } from "../src/lib/types";

const turn: ModelTurn = {
  protocolVersion: 1,
  narration: "しずくは少しだけ目をそらした。",
  speech: "……ありがとうございます。嬉しいです。",
  memory: "コーヒーが好き",
  performance: {
    version: 1,
    expression: "shy",
    emotionIntensity: 0.7,
    motionCue: "look_away",
    voiceStyle: "shy",
    pause: "short",
  },
};

const state: AppState = {
  schemaVersion: 2,
  onboarded: true,
  userName: "テスト",
  persona: { id: "shizuku", name: "しずく", firstPerson: "私", honorific: "さん", speech: "丁寧", personality: "穏やか", idleLines: [] },
  look: { variantId: "default", scene: "room", motionId: "idle" },
  affection: 4,
  messages: [{ role: "user", text: "ありがとう", at: 1 }],
  memories: [],
  personas: {},
  voice: { enabled: false, autoplay: false },
};

test("ModelTurn validation accepts only canonical bounded values", () => {
  assert.deepEqual(validateModelTurn(turn), turn);
  assert.equal(validateModelTurn({ ...turn, speech: "" }), null);
  assert.equal(validateModelTurn({ ...turn, performance: { ...turn.performance, emotionIntensity: 1.1 } }), null);
  assert.equal(validateModelTurn({ ...turn, narration: "一文目。二文目。三文目。" }), null);
  assert.equal(validateModelTurn({ ...turn, performance: { version: 1, expression: "bone:head" } }), null);
});

test("partial structured JSON exposes only decoded narration/speech strings", () => {
  const partial = '{"protocolVersion":1,"narration":"目を\\u305d\\u3089し","speech":"うれ';
  assert.equal(partialJsonString(partial, "narration"), "目をそらし");
  assert.equal(partialJsonString(partial, "speech"), "うれ");
  assert.equal(partialJsonString('{"performance":{"expression":"happy"}}', "speech"), undefined);
});

test("server event parser rejects raw or malformed payloads", () => {
  assert.equal(parseDialogueEvent({ type: "speech_delta", turnId: "turn_12345678", text: { raw: true } }), null);
  assert.equal(parseDialogueEvent({ type: "turn_complete", turnId: "turn_12345678", turn })?.type, "turn_complete");
});

test("legacy tags are isolated and converted to canonical speech", () => {
  const adapted = legacyTextToModelTurn("[shy] ありがとう。 [memory: 甘いものが好き]");
  assert.equal(adapted?.speech, "ありがとう。");
  assert.equal(adapted?.memory, "甘いものが好き");
  assert.equal(adapted?.performance.expression, "shy");
});

test("conversation transaction commits model/memory/affection at most once per turn ledger", () => {
  const ledger = new ConversationTransactionLedger();
  assert.equal(ledger.accept("turn_12345678"), true);
  let next = applyConversationTransaction(state, turn, 2);
  assert.equal(ledger.accept("turn_12345678"), false);
  assert.equal(next.messages.length, state.messages.length + 1);
  assert.equal(next.messages.at(-1)?.text, turn.speech);
  assert.equal(next.messages.at(-1)?.narration, turn.narration);
  assert.equal(next.memories.length, 1);
  assert.equal(next.affection, state.affection + 1);
  assert.equal("turnId" in (next.messages.at(-1) as object), false);
  assert.equal("draft" in next, false);
});
