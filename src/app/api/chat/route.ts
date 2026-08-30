import { GoogleGenAI, HarmBlockThreshold, HarmCategory, ThinkingLevel, type Content, type GenerateContentConfig } from "@google/genai";
import { MODEL_TURN_JSON_SCHEMA, legacyTextToModelTurn, type DialogueEvent, validateModelTurn } from "@/lib/dialogue";
import { buildSystemInstruction } from "@/lib/prompt";
import type { ChatMessage, Look, Persona } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_HISTORY = 24;
const MAX_OUTPUT_TOKENS = 2048;

interface ChatRequest {
  turnId: string;
  messages: ChatMessage[];
  persona: Persona;
  userName: string;
  affection: number;
  look: Look;
  memories?: string[];
}

function ndjson(events: DialogueEvent[]): Response {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n", {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function errorResponse(turnId: string, message: string): Response {
  return ndjson([{ type: "turn_started", turnId }, { type: "turn_error", turnId, message }]);
}

function safeTurnId(value: unknown): string | null {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value) ? value : null;
}

function configBase(systemInstruction: string): GenerateContentConfig {
  return {
    systemInstruction,
    temperature: 1.05,
    topP: 0.95,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    safetySettings: [
      HarmCategory.HARM_CATEGORY_HARASSMENT,
      HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    ].map((category) => ({ category, threshold: HarmBlockThreshold.OFF })),
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
  };
}

function chunks(text: string): string[] {
  // Geminiのpartial JSONではなく、検証済みspeechだけをserver eventにする。
  return text.match(/[^。！？\n]+[。！？]?|\n/g)?.filter(Boolean) ?? [text];
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return errorResponse("invalid_turn", "（メッセージをうまく読み取れませんでした）");
  }
  const turnId = safeTurnId(body.turnId);
  if (!turnId || !Array.isArray(body.messages) || !body.persona || !body.look) {
    return errorResponse(turnId ?? "invalid_turn", "（メッセージをうまく読み取れませんでした）");
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse(turnId, "（APIキーがまだ設定されていないみたい。設定を確認してね）");

  const history = body.messages.slice(-MAX_HISTORY).filter((m) => m.text?.trim());
  const contents: Content[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    // Model messageのtextはcanonical speech。narrationやmemoryをhistoryへ戻さない。
    parts: [{ text: m.text }],
  }));
  if (!contents.length) return errorResponse(turnId, "（何か話しかけてみて）");

  const recentPerformance = history
    .filter((m) => m.role === "model")
    .slice(-2)
    .map((m) => ({ narration: m.narration, expression: m.performance?.expression, motionCue: m.performance?.motionCue }));
  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const structuredInstruction = buildSystemInstruction({
    persona: body.persona, userName: body.userName, affection: body.affection, look: body.look,
    memories: body.memories, recentPerformance, protocol: "structured",
  });

  let turn = null;
  // structured outputは一度だけretryし、検証済みcanonical ModelTurnだけを採用する。
  for (let attempt = 0; attempt < 2 && !turn; attempt += 1) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: { ...configBase(structuredInstruction), responseMimeType: "application/json", responseJsonSchema: MODEL_TURN_JSON_SCHEMA },
      });
      const raw = response.text?.trim();
      turn = raw ? validateModelTurn(JSON.parse(raw)) : null;
    } catch {
      // provider detail/JSONをUIやlogへ出さずlegacy fallbackへ進む。
    }
  }

  if (!turn) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: configBase(buildSystemInstruction({
          persona: body.persona, userName: body.userName, affection: body.affection, look: body.look,
          memories: body.memories, recentPerformance, protocol: "legacy",
        })),
      });
      turn = legacyTextToModelTurn(response.text ?? "");
    } catch {
      return errorResponse(turnId, "（通信がうまくいかなかったみたい。少し待ってから、もう一度送ってね）");
    }
  }
  if (!turn) return errorResponse(turnId, "……ごめん、今ちょっと言葉が出てこなかった。もう一回言ってくれる？");

  const events: DialogueEvent[] = [
    { type: "turn_started", turnId },
    { type: "performance_preview", turnId, performance: turn.performance },
    ...(turn.narration ? [{ type: "narration_preview" as const, turnId, narration: turn.narration }] : []),
    ...chunks(turn.speech).map((text) => ({ type: "speech_delta" as const, turnId, text })),
    { type: "turn_complete", turnId, turn },
  ];
  return ndjson(events);
}
