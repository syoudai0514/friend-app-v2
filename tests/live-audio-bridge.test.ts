import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { decodeLiveAudioEnvelope, liveAudioCacheKey } from "../src/lib/live-audio-fetch-bridge";

function minimalWavBase64(): string {
  const bytes = new Uint8Array(44);
  bytes.set(Buffer.from("RIFF", "ascii"), 0);
  bytes.set(Buffer.from("WAVE", "ascii"), 8);
  return Buffer.from(bytes).toString("base64");
}

test("Live chat audio envelope maps to the exact TTS cache key", () => {
  const decoded = decodeLiveAudioEnvelope({
    type: "turn_complete",
    turnId: "turn_12345678",
    turn: {
      speech: "せんぱい、こんにちは！",
      performance: { voiceStyle: "bright", emotionIntensity: 0.7 },
    },
    audio: { mimeType: "audio/wav", data: minimalWavBase64(), provider: "gemini-live" },
  }, "hinata");

  assert.ok(decoded);
  assert.equal(
    decoded.key,
    liveAudioCacheKey("hinata", "せんぱい、こんにちは！", "bright", 0.7),
  );
  assert.equal(decoded.blob.type, "audio/wav");
  assert.equal(decoded.blob.size, 44);
});

test("Live audio bridge rejects malformed or non-WAV inline data", () => {
  assert.equal(decodeLiveAudioEnvelope({
    type: "turn_complete",
    turnId: "turn_12345678",
    turn: { speech: "こんにちは", performance: {} },
    audio: { mimeType: "audio/wav", data: Buffer.from("not wav").toString("base64") },
  }, "aimi"), null);
  assert.equal(decodeLiveAudioEnvelope({
    type: "turn_complete",
    turnId: "turn_12345678",
    turn: { speech: "こんにちは", performance: {} },
    audio: { mimeType: "audio/mpeg", data: minimalWavBase64() },
  }, "aimi"), null);
});
