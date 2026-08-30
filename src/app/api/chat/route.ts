import { GoogleGenAI, HarmBlockThreshold, HarmCategory, type Content, type GenerateContentConfig } from "@google/genai";
import {
  MODEL_TURN_JSON_SCHEMA,
  legacyTextToModelTurn,
  parseStructuredModelTurn,
  partialJsonString,
  type DialogueEvent,
} from "@/lib/dialogue";
import { buildSystemInstruction } from "@/lib/prompt";
import type { ChatMessage, Look, ModelTurn, Persona } from "@/lib/types";

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
  };
}

function responseFromEvents(events: DialogueEvent[]): Response {
  return new Response(events.map((event) => `${JSON.stringify(event)}\n`).join(""), {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function errorResponse(turnId: string, message: string): Response {
  return responseFromEvents([{ type: "turn_started", turnId }, { type: "turn_error", turnId, message }]);
}

function speechChunks(text: string): string[] {
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

  const history = body.messages.slice(-MAX_HISTORY).filter((message) => typeof message.text === "string" && message.text.trim());
  const contents: Content[] = history.map((message) => ({
    role: message.role === "user" ? "user" : "model",
    // model historyはcanonical speechだけ。narration / memory / performanceは混ぜない。
    parts: [{ text: message.text }],
  }));
  if (!contents.length) return errorResponse(turnId, "（何か話しかけてみて）");

  const recentPerformance = history
    .filter((message) => message.role === "model")
    .slice(-2)
    .map((message) => ({
      narration: message.narration,
      expression: message.performance?.expression,
      motionCue: message.performance?.motionCue,
    }));

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const structuredInstruction = buildSystemInstruction({
    persona: body.persona,
    userName: body.userName,
    affection: body.affection,
    look: body.look,
    memories: body.memories,
    recentPerformance,
    protocol: "structured",
  });
  const legacyInstruction = buildSystemInstruction({
    persona: body.persona,
    userName: body.userName,
    affection: body.affection,
    look: body.look,
    memories: body.memories,
    recentPerformance,
    protocol: "legacy",
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: DialogueEvent) => {
        if (closed || req.signal.aborted) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* client already disconnected */ }
      };

      const streamStructuredAttempt = async (): Promise<ModelTurn | null> => {
        let rawJson = "";
        let sentSpeech = "";
        let sentNarration = "";
        const result = await ai.models.generateContentStream({
          model,
          contents,
          config: {
            ...configBase(structuredInstruction),
            responseMimeType: "application/json",
            responseJsonSchema: MODEL_TURN_JSON_SCHEMA,
          },
        });

        for await (const chunk of result) {
          if (req.signal.aborted) return null;
          rawJson += chunk.text ?? "";

          // raw partial JSONそのものは送らず、復号済みfield値だけをpreviewする。
          const narration = partialJsonString(rawJson, "narration")?.slice(0, 80);
          if (narration !== undefined && narration !== sentNarration) {
            sentNarration = narration;
            if (narration.trim()) emit({ type: "narration_preview", turnId, narration });
          }

          const speech = partialJsonString(rawJson, "speech")?.slice(0, 360);
          if (speech !== undefined && speech.startsWith(sentSpeech) && speech.length > sentSpeech.length) {
            const delta = speech.slice(sentSpeech.length);
            sentSpeech = speech;
            emit({ type: "speech_delta", turnId, text: delta });
          }
        }

        const turn = parseStructuredModelTurn(rawJson);
        if (!turn) return null;
        if (turn.narration && turn.narration !== sentNarration) {
          emit({ type: "narration_preview", turnId, narration: turn.narration });
        }
        if (turn.speech.startsWith(sentSpeech) && turn.speech.length > sentSpeech.length) {
          emit({ type: "speech_delta", turnId, text: turn.speech.slice(sentSpeech.length) });
        }
        emit({ type: "performance_preview", turnId, performance: turn.performance });
        return turn;
      };

      try {
        emit({ type: "turn_started", turnId });
        let turn: ModelTurn | null = null;

        // structured outputは初回 + retry 1回。retry前にdraftを明示resetする。
        for (let attempt = 0; attempt < 2 && !turn && !req.signal.aborted; attempt += 1) {
          if (attempt > 0) emit({ type: "turn_started", turnId });
          try {
            turn = await streamStructuredAttempt();
          } catch {
            turn = null;
          }
        }

        if (!turn && !req.signal.aborted) {
          // legacy fallbackはraw tagをpreviewせず、完了後にadapterを通してcanonical化する。
          emit({ type: "turn_started", turnId });
          try {
            let rawLegacy = "";
            const response = await ai.models.generateContentStream({
              model,
              contents,
              config: configBase(legacyInstruction),
            });
            for await (const chunk of response) {
              if (req.signal.aborted) break;
              rawLegacy += chunk.text ?? "";
            }
            turn = req.signal.aborted ? null : legacyTextToModelTurn(rawLegacy);
            if (turn) {
              emit({ type: "performance_preview", turnId, performance: turn.performance });
              for (const text of speechChunks(turn.speech)) emit({ type: "speech_delta", turnId, text });
            }
          } catch {
            turn = null;
          }
        }

        if (req.signal.aborted) {
          close();
          return;
        }
        if (!turn) {
          emit({ type: "turn_error", turnId, message: "（通信がうまくいかなかったみたい。少し待ってから、もう一度送ってね）" });
          close();
          return;
        }

        // persistent side effects / TTS eligibilityはclientのこのeventだけを境界にする。
        emit({ type: "turn_complete", turnId, turn });
        close();
      } catch {
        if (!req.signal.aborted) emit({ type: "turn_error", turnId, message: "（通信がうまくいかなかったみたい。少し待ってから、もう一度送ってね）" });
        close();
      }
    },
    cancel() {
      // provider stream自体にAbortSignalを渡せないSDK経路でも、以後のeventは必ず破棄する。
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
