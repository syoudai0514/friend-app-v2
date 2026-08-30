import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const chatSource = "src/app/chat/chat-page-base.tsx";

test("ChatPage keeps model preview volatile and discards stale events", () => {
  const chat = source(chatSource);
  assert.doesNotMatch(chat, /replaceLastModel\s*\(/);
  assert.match(chat, /event\.turnId !== activeTurnId\.current/);
  assert.match(chat, /event\.type === "turn_started"/);
  assert.match(chat, /setTurnDraft\(\{ turnId, speech: "" \}\)/);
  assert.match(chat, /commitModelTurn\(turnId, expectedPersonaId, turn\)/);
});

test("Abort, persona switch, route lifecycle and stale TTS are wired", () => {
  const chat = source(chatSource);
  assert.match(chat, /generationAbort\.current\?\.abort\(\)/);
  assert.match(chat, /ttsAbort\.current\?\.abort\(\)/);
  assert.match(chat, /personaId\.current !== state\.persona\.id/);
  assert.match(chat, /visibilitychange/);
  assert.match(chat, /pagehide/);
  assert.match(chat, /pageshow/);
  assert.match(chat, /serial !== audioRequestSerial\.current/);
});

test("generation does not drive lip sync and narration precedes model speech UI", () => {
  const chat = source(chatSource);
  assert.match(chat, /const isPlaying = audioState === "playing"/);
  assert.match(chat, /talking=\{isPlaying\}/);

  const modelComponent = chat.slice(chat.indexOf("function ModelMessage"));
  const narrationAt = modelComponent.indexOf("message.narration");
  const nameAt = modelComponent.indexOf("name-tag");
  const speechAt = modelComponent.indexOf("message.text");
  assert.ok(narrationAt >= 0 && narrationAt < nameAt && nameAt < speechAt);
});

test("chat wrapper installs the Live audio fetch bridge without changing persistent state", () => {
  const wrapper = source("src/app/chat/page.tsx");
  const bridge = source("src/lib/live-audio-fetch-bridge.ts");
  assert.match(wrapper, /installLiveAudioFetchBridge/);
  assert.match(bridge, /path === "\/api\/tts"/);
  assert.match(bridge, /"X-TTS-Provider": "gemini-live-chat"/);
  assert.doesNotMatch(bridge, /localStorage|sessionStorage/);
});

test("formal ChatMessage contract does not persist transaction IDs", () => {
  const types = source("src/lib/types.ts");
  const start = types.indexOf("export interface ChatMessage");
  const end = types.indexOf("export interface TurnDraft", start);
  const contract = types.slice(start, end);
  assert.match(contract, /text: string/);
  assert.match(contract, /narration\?: string/);
  assert.match(contract, /performance\?: ModelPerformanceIntent/);
  assert.doesNotMatch(contract, /turnId/);
});
