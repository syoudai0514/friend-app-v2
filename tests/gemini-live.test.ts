import assert from "node:assert/strict";
import test from "node:test";
import { buildSystemInstruction } from "../src/lib/prompt";

const persona = {
  id: "hinata",
  name: "ひなた",
  firstPerson: "ひなた",
  honorific: "せんぱい",
  speech: "明るく素直",
  personality: "元気で親しみやすい",
  idleLines: ["{user}、おかえりなさい！"],
};

const look = {
  variantId: "default",
  scene: "classroom",
  motionId: "idle",
};

test("live protocol asks for spoken dialogue only", () => {
  const instruction = buildSystemInstruction({
    persona,
    userName: "まーくん",
    affection: 50,
    look,
    protocol: "live",
  });
  assert.match(instruction, /実際に声に出す日本語の台詞だけ/);
  assert.match(instruction, /JSON、タグ、narration/);
});
