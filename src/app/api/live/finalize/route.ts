import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type GenerateContentConfig,
} from "@google/genai";
import { MODEL_TURN_JSON_SCHEMA, parseStructuredModelTurn } from "@/lib/dialogue";
import { PRESETS } from "@/lib/personas";
import { buildSystemInstruction } from "@/lib/prompt";
import type { ChatMessage, Look, ModelTurn } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface FinalizeRequest {
  turnId?: unknown;
  personaId?: unknown;
  speech?: unknown;
  userName?: unknown;
  affection?: unknown;
  look?: unknown;
  memories?: unknown;
  messages?: unknown;
}

function safeTurnId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;
}

function normalizedSpeech(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const speech = value.replace(/\s+/g, " ").trim();
  return speech && speech.length <= 360 ? speech : null;
}

function safeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .filter((entry) => (entry.role === "user" || entry.role === "model") && typeof entry.text === "string")
    .slice(-24)
    .map((entry) => ({
      role: entry.role as "user" | "model",
      text: (entry.text as string).replace(/\s+/g, " ").trim().slice(0, 360),
      at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : Date.now(),
      ...(typeof entry.narration === "string" ? { narration: entry.narration.slice(0, 80) } : {}),
      ...(entry.performance && typeof entry.performance === "object"
        ? { performance: entry.performance as ChatMessage["performance"] }
        : {}),
    }))
    .filter((entry) => entry.text);
}

function safeMemories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .slice(-40)
    .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, 120));
}

function safeLook(value: unknown): Look | null {
  if (!value || typeof value !== "object") return null;
  const look = value as Partial<Look>;
  if (typeof look.variantId !== "string" || typeof look.scene !== "string" || typeof look.motionId !== "string") return null;
  return look as Look;
}

function configBase(systemInstruction: string): GenerateContentConfig {
  return {
    systemInstruction,
    temperature: 0.25,
    topP: 0.9,
    maxOutputTokens: 1200,
    safetySettings: [
      HarmCategory.HARM_CATEGORY_HARASSMENT,
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ].map((category) => ({ category, threshold: HarmBlockThreshold.OFF })),
  };
}

function neutralTurn(speech: string): ModelTurn {
  return {
    protocolVersion: 1,
    speech,
    memory: null,
    performance: {
      version: 1,
      expression: "normal",
      motionCue: "none",
      voiceStyle: "neutral",
      pause: "none",
    },
  };
}

export async function POST(request: Request) {
  const started = Date.now();
  let raw: FinalizeRequest;
  try {
    raw = await request.json() as FinalizeRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const turnId = safeTurnId(raw.turnId);
  const speech = normalizedSpeech(raw.speech);
  const personaId = typeof raw.personaId === "string" ? raw.personaId : "";
  const preset = PRESETS.find((candidate) => candidate.persona.id === personaId);
  const look = safeLook(raw.look);
  if (!turnId || !speech || !preset || !look) {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return Response.json({ turn: neutralTurn(speech) });

  const messages = safeMessages(raw.messages);
  const recentPerformance = messages
    .filter((message) => message.role === "model")
    .slice(-2)
    .map((message) => ({
      narration: message.narration,
      expression: message.performance?.expression,
      motionCue: message.performance?.motionCue,
    }));
  const userName = typeof raw.userName === "string" && raw.userName.trim() ? raw.userName.slice(0, 40) : "あなた";
  const affection = typeof raw.affection === "number" && Number.isFinite(raw.affection) ? raw.affection : 0;
  const memories = safeMemories(raw.memories);
  const latestUser = [...messages].reverse().find((message) => message.role === "user")?.text ?? "";

  const instruction = [
    buildSystemInstruction({
      persona: preset.persona,
      userName,
      affection,
      look,
      memories,
      recentPerformance,
      protocol: "structured",
    }),
    "重要: 今回は会話本文を新規生成しません。<fixed_speech>はGemini Live native audioですでに生成・発話されたFINAL SPEECHです。",
    "speechには<fixed_speech>を一字一句そのまま入れてください。言い換え・追記・削除は禁止です。",
    "決めるのはnarration、memory、performanceだけです。",
  ].join("\n\n");

  let turn = neutralTurn(speech);
  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
    const response = await ai.models.generateContent({
      model,
      contents: [{
        role: "user",
        parts: [{ text: `<latest_user>${latestUser}</latest_user>\n<fixed_speech>${speech}</fixed_speech>` }],
      }],
      config: {
        ...configBase(instruction),
        responseMimeType: "application/json",
        responseJsonSchema: MODEL_TURN_JSON_SCHEMA,
      },
    });
    const enriched = parseStructuredModelTurn(response.text ?? "");
    if (enriched && normalizedSpeech(enriched.speech) === speech) turn = { ...enriched, speech };
  } catch {
    // FINAL SPEECH remains valid even if hidden enrichment fails.
  }

  console.info(JSON.stringify({
    metric: "live_v2_finalize",
    personaId,
    characterCount: speech.length,
    latencyMs: Date.now() - started,
    enriched: Boolean(turn.narration || turn.memory || turn.performance.expression !== "normal"),
    status: "ok",
  }));

  return Response.json({ turn }, {
    headers: {
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
