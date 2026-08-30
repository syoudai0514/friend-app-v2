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

/** Geminiへ渡すJSON Schema。browserには一切転送しない。 */
export const MODEL_TURN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["protocolVersion", "speech", "performance"],
  properties: {
    protocolVersion: { type: "integer", enum: [1] },
    narration: { type: "string", maxLength: 80 },
    speech: { type: "string", minLength: 1, maxLength: 360 },
    memory: { type: ["string", "null"], maxLength: 120 },
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

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : undefined;
}

export function validateModelTurn(value: unknown): ModelTurn | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (raw.protocolVersion !== 1) return null;
  const speech = text(raw.speech, 360);
  const perf = raw.performance as Record<string, unknown> | undefined;
  if (!speech || !perf || perf.version !== 1 || !emotions.includes(perf.expression as EmotionId)) return null;
  const intensity = typeof perf.emotionIntensity === "number" && Number.isFinite(perf.emotionIntensity)
    ? Math.max(0, Math.min(1, perf.emotionIntensity)) : undefined;
  return {
    protocolVersion: 1,
    narration: text(raw.narration, 80),
    speech,
    memory: text(raw.memory, 120) ?? null,
    performance: {
      version: 1,
      expression: perf.expression as EmotionId,
      ...(intensity === undefined ? {} : { emotionIntensity: intensity }),
      ...(motions.includes(perf.motionCue as MotionCue) ? { motionCue: perf.motionCue as MotionCue } : {}),
      ...(styles.includes(perf.voiceStyle as VoiceStyleId) ? { voiceStyle: perf.voiceStyle as VoiceStyleId } : {}),
      ...(pauses.includes(perf.pause as PauseCue) ? { pause: perf.pause as PauseCue } : {}),
    },
  };
}

/** 旧タグ形式はstructured失敗時だけここでcanonical contractへ変換する。 */
export function legacyTextToModelTurn(raw: string): ModelTurn | null {
  const expression = splitExpression(raw);
  const memory = finalizeMemory(expression.body);
  const speech = text(memory.body, 360);
  if (!speech) return null;
  return {
    protocolVersion: 1,
    speech,
    memory: memory.learned,
    performance: { version: 1, expression: expression.expression, motionCue: "none", voiceStyle: "neutral", pause: "none" },
  };
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
  if (event.type === "narration_preview" && typeof event.narration === "string") return { type: "narration_preview", turnId: event.turnId, narration: event.narration };
  if (event.type === "speech_delta" && typeof event.text === "string") return { type: "speech_delta", turnId: event.turnId, text: event.text };
  if (event.type === "turn_complete") {
    const turn = validateModelTurn(event.turn);
    return turn ? { type: "turn_complete", turnId: event.turnId, turn } : null;
  }
  if (event.type === "turn_error" && typeof event.message === "string") return { type: "turn_error", turnId: event.turnId, message: event.message };
  return null;
}
