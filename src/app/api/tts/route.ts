import { geminiTtsPrompt, geminiTtsVoice, pcm16MonoToWav } from "@/lib/gemini-tts";
import { ttsTextNormalizer, validTtsRequest, type TtsRequestBody, type VoiceProfile } from "@/lib/voice";
import {
  approvedFallbackFor,
  approvedVoiceFor,
  publicVoiceStatus,
  serverVoiceProfiles,
} from "@/lib/voice-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AIVIS_SYNTHESIZE_URL = "https://api.aivis-project.com/v1/tts/synthesize";
const DEFAULT_GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";
const GEMINI_TTS_MAX_ATTEMPTS = 2;
const GEMINI_TTS_RETRY_DELAY_MS = 300;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function providerPayload(profile: VoiceProfile, input: TtsRequestBody, normalizedSpeech: string) {
  const styleName = input.style ? profile.styleMap[input.style] : undefined;
  const payload: Record<string, unknown> = {
    model_uuid: profile.voiceId,
    text: normalizedSpeech,
    use_ssml: false,
    use_volume_normalizer: true,
    output_format: "mp3",
    speaking_rate: clamp(profile.baseSpeed, 0.5, 2),
    tempo_dynamics: 1,
    leading_silence_seconds: 0,
  };
  if (styleName) payload.style_name = styleName;
  if (typeof input.emotionIntensity === "number") {
    // semantic 0..1 を極端になりにくいAivis 0..2の範囲へ保守的に写像する。
    payload.emotional_intensity = 0.8 + input.emotionIntensity * 0.4;
  }
  // Aivis公式はpitch変更で品質/速度低下の可能性を案内しているため、通常は0のまま送らない。
  if (profile.basePitch !== 0) payload.pitch = clamp(profile.basePitch, -1, 1);
  return payload;
}

async function synthesizeAivis(
  profile: VoiceProfile,
  input: TtsRequestBody,
  normalizedSpeech: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(AIVIS_SYNTHESIZE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "audio/mpeg, audio/*",
    },
    body: JSON.stringify(providerPayload(profile, input, normalizedSpeech)),
    signal,
    cache: "no-store",
  });
}

interface GeminiInlineData {
  data?: string;
  mimeType?: string;
}

interface GeminiTtsResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: GeminiInlineData;
      }>;
    };
  }>;
}

function retryableGeminiStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function retryDelay(attempt: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, GEMINI_TTS_RETRY_DELAY_MS * attempt);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function synthesizeGemini(
  input: TtsRequestBody,
  normalizedSpeech: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<Response | null> {
  const model = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_GEMINI_TTS_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  for (let attempt = 1; attempt <= GEMINI_TTS_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: geminiTtsPrompt(input, normalizedSpeech) }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: geminiTtsVoice(input.personaId),
                },
              },
            },
          },
        }),
        signal,
        cache: "no-store",
      });
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
      if (attempt < GEMINI_TTS_MAX_ATTEMPTS) {
        await retryDelay(attempt, signal);
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      if (retryableGeminiStatus(response.status) && attempt < GEMINI_TTS_MAX_ATTEMPTS) {
        await retryDelay(attempt, signal);
        continue;
      }
      return null;
    }

    let payload: GeminiTtsResponse;
    try {
      payload = await response.json() as GeminiTtsResponse;
    } catch {
      if (attempt < GEMINI_TTS_MAX_ATTEMPTS) {
        await retryDelay(attempt, signal);
        continue;
      }
      return null;
    }
    const part = payload.candidates?.[0]?.content?.parts?.find((candidate) => candidate.inlineData?.data);
    const encoded = part?.inlineData?.data;
    if (!encoded) {
      if (attempt < GEMINI_TTS_MAX_ATTEMPTS) {
        await retryDelay(attempt, signal);
        continue;
      }
      return null;
    }

    const decoded = Buffer.from(encoded, "base64");
    if (!decoded.byteLength) {
      if (attempt < GEMINI_TTS_MAX_ATTEMPTS) {
        await retryDelay(attempt, signal);
        continue;
      }
      return null;
    }
    const raw = new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
    const mimeType = part?.inlineData?.mimeType?.toLowerCase() ?? "";
    const audio = mimeType.includes("wav") ? raw : pcm16MonoToWav(raw);
    const bytes = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-TTS-Provider": "gemini",
      },
    });
  }

  return null;
}

function metadataLog(
  requestId: string,
  profile: VoiceProfile | null,
  personaId: string,
  characterCount: number,
  started: number,
  status: string,
  providerOverride?: string,
) {
  // speech本文は絶対にlogしない。
  console.info(JSON.stringify({
    requestId,
    provider: providerOverride ?? profile?.provider ?? "none",
    personaId,
    characterCount,
    latencyMs: Date.now() - started,
    status,
  }));
}

/** voice IDやsecretを出さず、credits/設定状況だけ確認できる。 */
export async function GET() {
  return Response.json({ voices: publicVoiceStatus() }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/**
 * TTS privacy boundary。受理する会話本文はcanonical model speech 1本だけ。
 * user message / narration / memory / prompt / recentPerformanceを含むrequestはvalidatorで拒否する。
 * Aivisの承認済みprofileがあれば優先し、未設定/未承認/障害時は既存GEMINI_API_KEYで
 * Google prebuilt voiceへfallbackする。Aivisのライセンスgate自体は迂回しない。
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ code: "invalid_request" }, { status: 400 });
  }
  const input = validTtsRequest(body);
  if (!input) return Response.json({ code: "invalid_request" }, { status: 400 });

  const normalizedSpeech = ttsTextNormalizer(input.speech);
  if (!normalizedSpeech) return Response.json({ code: "empty_speech" }, { status: 400 });

  const configured = serverVoiceProfiles()[input.personaId];
  const profile = approvedVoiceFor(input.personaId);
  const aivisApiKey = process.env.AIVIS_API_KEY?.trim();

  if (profile && aivisApiKey) {
    const candidates = [profile];
    const fallback = approvedFallbackFor(profile);
    if (fallback && fallback.voiceProfileId !== profile.voiceProfileId) candidates.push(fallback);

    for (const candidate of candidates) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await synthesizeAivis(candidate, input, normalizedSpeech, aivisApiKey, req.signal);
          if (response.ok) {
            const bytes = await response.arrayBuffer();
            if (!bytes.byteLength) break;
            metadataLog(requestId, candidate, input.personaId, normalizedSpeech.length, started, "ok");
            return new Response(bytes, {
              status: 200,
              headers: {
                "Content-Type": response.headers.get("content-type") || "audio/mpeg",
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
                "X-TTS-Provider": "aivis",
              },
            });
          }
          const retryable = response.status === 429 || response.status >= 500;
          if (!retryable) break;
        } catch (error) {
          if (req.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
            metadataLog(requestId, candidate, input.personaId, normalizedSpeech.length, started, "aborted");
            return new Response(null, { status: 499 });
          }
        }
      }
    }
    metadataLog(requestId, profile, input.personaId, normalizedSpeech.length, started, "aivis_unavailable_fallback");
  } else if (profile && !aivisApiKey) {
    metadataLog(requestId, profile, input.personaId, normalizedSpeech.length, started, "aivis_api_key_missing_fallback");
  } else {
    metadataLog(
      requestId,
      configured ?? null,
      input.personaId,
      normalizedSpeech.length,
      started,
      configured?.voiceId ? "aivis_license_not_approved_fallback" : "aivis_unconfigured_fallback",
    );
  }

  const geminiApiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiApiKey) {
    try {
      const response = await synthesizeGemini(input, normalizedSpeech, geminiApiKey, req.signal);
      if (response) {
        metadataLog(requestId, null, input.personaId, normalizedSpeech.length, started, "ok", "gemini");
        return response;
      }
    } catch (error) {
      if (req.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        metadataLog(requestId, null, input.personaId, normalizedSpeech.length, started, "aborted", "gemini");
        return new Response(null, { status: 499 });
      }
    }
    metadataLog(requestId, null, input.personaId, normalizedSpeech.length, started, "provider_error", "gemini");
    return Response.json({ code: "tts_unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  metadataLog(requestId, null, input.personaId, normalizedSpeech.length, started, "gemini_api_key_missing", "gemini");
  return Response.json(
    { code: profile ? "tts_unavailable" : configured?.voiceId ? "voice_not_approved" : "voice_unconfigured" },
    {
      status: profile ? 503 : 409,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
