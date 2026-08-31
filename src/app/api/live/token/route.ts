import { GoogleGenAI, Modality, ThinkingLevel } from "@google/genai";
import { PRESETS } from "@/lib/personas";
import {
  LIVE_VOICE_API_VERSION,
  LIVE_VOICE_BY_PERSONA,
  LIVE_VOICE_MODEL,
  buildLiveVoiceSystemInstruction,
  liveVoiceContextKey,
} from "@/lib/live-voice-config";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TokenRequest {
  personaId?: unknown;
  userName?: unknown;
  affection?: unknown;
  messages?: unknown;
  memories?: unknown;
}

function safeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
    .filter((entry) => (entry.role === "user" || entry.role === "model") && typeof entry.text === "string")
    .slice(-10)
    .map((entry) => ({
      role: entry.role as "user" | "model",
      text: (entry.text as string).replace(/\s+/g, " ").trim().slice(0, 360),
      at: typeof entry.at === "number" && Number.isFinite(entry.at) ? entry.at : Date.now(),
    }))
    .filter((entry) => entry.text);
}

function safeMemories(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
    .slice(-3)
    .map((entry) => entry.replace(/\s+/g, " ").trim().slice(0, 120));
}

export async function POST(request: Request) {
  if (process.env.GEMINI_LIVE_V2_ENABLED === "0") {
    return Response.json({ error: "disabled" }, { status: 404 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "unconfigured" }, { status: 503 });

  let raw: TokenRequest;
  try {
    raw = await request.json() as TokenRequest;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const personaId = typeof raw.personaId === "string" ? raw.personaId : "";
  const preset = PRESETS.find((candidate) => candidate.persona.id === personaId);
  if (!preset) return Response.json({ error: "invalid_persona" }, { status: 400 });

  const context = {
    persona: preset.persona,
    userName: typeof raw.userName === "string" ? raw.userName.slice(0, 40) : "あなた",
    affection: typeof raw.affection === "number" && Number.isFinite(raw.affection) ? raw.affection : 0,
    messages: safeMessages(raw.messages),
    memories: safeMemories(raw.memories),
  };

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: { apiVersion: LIVE_VOICE_API_VERSION },
  });
  const now = Date.now();
  const expireTime = new Date(now + 15 * 60 * 1000).toISOString();
  const newSessionExpireTime = new Date(now + 90 * 1000).toISOString();

  try {
    const token = await ai.authTokens.create({
      config: {
        httpOptions: { apiVersion: LIVE_VOICE_API_VERSION },
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: LIVE_VOICE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            outputAudioTranscription: {},
            temperature: 0.55,
            topP: 0.9,
            maxOutputTokens: 512,
            thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
            speechConfig: {
              languageCode: "ja",
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: LIVE_VOICE_BY_PERSONA[personaId] ?? "Zephyr",
                },
              },
            },
            systemInstruction: buildLiveVoiceSystemInstruction(context),
          },
        },
      },
    });

    if (!token.name) throw new Error("missing ephemeral token");

    return Response.json({
      token: token.name,
      model: LIVE_VOICE_MODEL,
      contextKey: liveVoiceContextKey(context),
      expireTime: token.expireTime ?? expireTime,
      newSessionExpireTime: token.newSessionExpireTime ?? newSessionExpireTime,
    }, {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.info(JSON.stringify({
      metric: "live_v2_token",
      personaId,
      status: "error",
      errorName: error instanceof Error ? error.name : "unknown",
    }));
    return Response.json({ error: "token_failed" }, { status: 502 });
  }
}
