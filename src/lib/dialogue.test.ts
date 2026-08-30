import { describe, expect, it } from "vitest";
import { legacyTextToModelTurn, parseDialogueEvent, validateModelTurn } from "./dialogue";

describe("ModelTurn protocol", () => {
  const valid = {
    protocolVersion: 1, narration: "しずくは少し笑った。", speech: "うれしいです。",
    memory: "コーヒーが好き", performance: { version: 1, expression: "happy", emotionIntensity: 0.7, motionCue: "small_nod", voiceStyle: "bright", pause: "short" },
  };
  it("accepts only the canonical contract and clamps intensity", () => {
    expect(validateModelTurn({ ...valid, performance: { ...valid.performance, emotionIntensity: 2 } })?.performance.emotionIntensity).toBe(1);
    expect(validateModelTurn({ ...valid, speech: "" })).toBeNull();
    expect(validateModelTurn({ ...valid, performance: { version: 1, expression: "bone:head" } })).toBeNull();
  });
  it("does not expose invalid/raw event payloads", () => {
    expect(parseDialogueEvent({ type: "turn_complete", turnId: "safe_turn", turn: valid })?.type).toBe("turn_complete");
    expect(parseDialogueEvent({ type: "speech_delta", turnId: "safe_turn", text: { json: true } })).toBeNull();
  });
  it("adapts legacy tags only into canonical speech", () => {
    expect(legacyTextToModelTurn("[shy] ありがとう。 [memory: 甘いものが好き]")).toMatchObject({ speech: "ありがとう。", memory: "甘いものが好き", performance: { expression: "shy" } });
  });
});
