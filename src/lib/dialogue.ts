import type {
  EmotionId,
  ModelPerformanceIntent,
  ModelTurn,
  MotionCue,
  PauseCue,
  VoiceStyleId,
} from "./types";
import { splitExpression } from "./expressions";
import { finalizeMemory } from "./memory";

const emotions: EmotionId[] = ["normal", "happy", "shy", "sad", "angry", "surprised", "sleepy"];
const motions: MotionCue[] = ["none", "look_away", "small_nod", "head_tilt", "lean_in"];
const styles: VoiceStyleId[] = ["neutral", "bright", "soft", "shy", "sad", "serious", "excited"];
const pauses: PauseCue[] = ["none", "short", "medium"];

/**
 * Geminiへ渡すresponseJsonSchema。
 * Gemini CURRENT structured-output subsetに未対応の文字列長keywordは置かず、
 * 長さ制約は必ずvalidateModelTurn()でアプリ側検証する。
 * このSchema自体をbrowserへ転送しない。
 */
export const MODEL_TURN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "speech", "performance"],
  properties: {
    protocolVersion: { type: "integer", enum: [1] },
    narration: { type: "string" },
    speech: { type: "string" },
    memory: { type: ["string", "null"] },
    performance: {
      type: "object",
      additionalProperties: false,
      required: ["version", "expression"],
      properties: {
        version: { type: "integer", enum: [1] },
        expression: { type: "string", enum: emotions },
        emotionIntensity: { type: "number", minimum: 0, maximum: 1 },
        motionCue: { type: "string", enum: motions },
        voiceStyle: { type: "string", enum: styles },
        pause: { type: "string", enum: pauses },
      },
    },
  },
} as const;

function canonicalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > max) return undefined;
  return cleaned;
}

function legacyText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

function narrationSentenceCount(value: string): number {
  return value.split(/[。！？!?]+/u).map((part) => part.trim()).filter(Boolean).length;
}

export function validateModelTurn(value: unknown): ModelTurn | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.protocolVersion !== 1) return null;
  const speech = canonicalText(raw.speech, 360);
  const narration = raw.narration === undefined ? undefined : canonicalText(raw.narration, 80);
  if (raw.narration !== undefined && !narration) return null;
  if (narration && narrationSentenceCount(narration) > 2) return null;
  const memory = raw.memory === null || raw.memory === undefined ? null : canonicalText(raw.memory, 120);
  if (raw.memory !== null && raw.memory !== undefined && !memory) return null;

  const perf = raw.performance as Record<string, unknown> | undefined;
  if (!speech || !perf || perf.version !== 1 || !emotions.includes(perf.expression as EmotionId)) return null;
  if (
    perf.emotionIntensity !== undefined &&
    (typeof perf.emotionIntensity !== "number" || !Number.isFinite(perf.emotionIntensity) || perf.emotionIntensity < 0 || perf.emotionIntensity > 1)
  ) return null;
  if (perf.motionCue !== undefined && !motions.includes(perf.motionCue as MotionCue)) return null;
  if (perf.voiceStyle !== undefined && !styles.includes(perf.voiceStyle as VoiceStyleId)) return null;
  if (perf.pause !== undefined && !pauses.includes(perf.pause as PauseCue)) return null;

  return {
    protocolVersion: 1,
    ...(narration ? { narration } : {}),
    speech,
    memory,
    performance: {
      version: 1,
      expression: perf.expression as EmotionId,
      ...(typeof perf.emotionIntensity === "number" ? { emotionIntensity: perf.emotionIntensity } : {}),
      ...(perf.motionCue ? { motionCue: perf.motionCue as MotionCue } : {}),
      ...(perf.voiceStyle ? { voiceStyle: perf.voiceStyle as VoiceStyleId } : {}),
      ...(perf.pause ? { pause: perf.pause as PauseCue } : {}),
    },
  };
}

/** 旧タグ形式はstructured失敗時だけここでcanonical contractへ変換する。 */
export function legacyTextToModelTurn(raw: string): ModelTurn | null {
  const expression = splitExpression(raw);
  const memory = finalizeMemory(expression.body);
  const speech = legacyText(memory.body, 360);
  if (!speech) return null;
  return {
    protocolVersion: 1,
    speech,
    memory: legacyText(memory.learned, 120) ?? null,
    performance: {
      version: 1,
      expression: expression.expression,
      motionCue: "none",
      voiceStyle: "neutral",
      pause: "none",
    },
  };
}

/** code fenceを許容するが、raw JSONはserver内だけで処理する。 */
export function parseStructuredModelTurn(raw: string): ModelTurn | null {
  const trimmed = raw.trim();
  const json = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")
    : trimmed;
  try {
    return validateModelTurn(JSON.parse(json));
  } catch {
    return null;
  }
}

/**
 * Geminiのpartial JSONから指定string fieldの「復号済み文字列」だけを抽出する。
 * JSONの括弧・キー・escapeなどraw fragmentはbrowserへ返さない。
 */
export function partialJsonString(rawJson: string, key: "narration" | "speech"): string | undefined {
  const marker = `"${key}"`;
  const keyAt = rawJson.indexOf(marker);
  if (keyAt < 0) return undefined;
  let index = keyAt + marker.length;
  while (index < rawJson.length && /\s/.test(rawJson[index])) index += 1;
  if (rawJson[index] !== ":") return undefined;
  index += 1;
  while (index < rawJson.length && /\s/.test(rawJson[index])) index += 1;
  if (rawJson[index] !== '"') return undefined;
  index += 1;

  let result = "";
  while (index < rawJson.length) {
    const char = rawJson[index++];
    if (char === '"') return result;
    if (char !== "\\") {
      result += char;
      continue;
    }
    if (index >= rawJson.length) break;
    const escaped = rawJson[index++];
    if (escaped === "n") result += "\n";
    else if (escaped === "r") result += "\r";
    else if (escaped === "t") result += "\t";
    else if (escaped === "b") result += "\b";
    else if (escaped === "f") result += "\f";
    else if (escaped === '"' || escaped === "\\" || escaped === "/") result += escaped;
    else if (escaped === "u") {
      const hex = rawJson.slice(index, index + 4);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      result += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    }
  }
  return result;
}

export type DialogueEvent =
  | { type: "turn_started"; turnId: string }
  | { type: "performance_preview"; turnId: string; performance: ModelPerformanceIntent }
  | { type: "narration_preview"; turnId: string; narration: string }
  | { type: "speech_delta"; turnId: string; text: string }
  | { type: "turn_complete"; turnId: string; turn: ModelTurn }
  | { type: "turn_error"; turnId: string; message: string };

export function parseDialogueEvent(value: unknown): DialogueEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.turnId !== "string" || !event.turnId) return null;
  if (event.type === "turn_started") return { type: "turn_started", turnId: event.turnId };
  if (event.type === "performance_preview") {
    const performance = validateModelTurn({ protocolVersion: 1, speech: "x", performance: event.performance })?.performance;
    return performance ? { type: "performance_preview", turnId: event.turnId, performance } : null;
  }
  if (event.type === "narration_preview" && typeof event.narration === "string") {
    const narration = canonicalText(event.narration, 80);
    return narration ? { type: "narration_preview", turnId: event.turnId, narration } : null;
  }
  if (event.type === "speech_delta" && typeof event.text === "string" && event.text.length <= 360) {
    return { type: "speech_delta", turnId: event.turnId, text: event.text };
  }
  if (event.type === "turn_complete") {
    const turn = validateModelTurn(event.turn);
    return turn ? { type: "turn_complete", turnId: event.turnId, turn } : null;
  }
  if (event.type === "turn_error" && typeof event.message === "string") {
    return { type: "turn_error", turnId: event.turnId, message: event.message.slice(0, 160) };
  }
  return null;
}
