import { describe, expect, it } from "vitest";
import { ttsTextNormalizer, validTtsRequest, voiceProfileFor } from "./voice";

describe("TTS privacy boundary", () => {
  it("normalizes only the supplied speech", () => {
    expect(ttsTextNormalizer("見て！ https://example.com 😀！！！")).toBe("見て！ リンク！");
  });
  it("rejects noncanonical or unapproved voice configuration", () => {
    expect(validTtsRequest({ personaId: "shizuku", narration: "秘密", speech: "こんにちは" })).toMatchObject({ speech: "こんにちは" });
    expect(validTtsRequest({ personaId: "shizuku", text: "こんにちは" })).toBeNull();
    expect(voiceProfileFor("shizuku")).toBeNull();
  });
});
