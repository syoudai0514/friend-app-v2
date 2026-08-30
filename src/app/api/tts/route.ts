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

function metadataLog(
  requestId: string,
  profile: VoiceProfile | null,
  personaId: string,
  characterCount: number,
  started: number,
  status: string,
) {
  // speech本文は絶対にlogしない。
  console.info(JSON.stringify({
    requestId,
    provider: profile?.provider ?? "none",
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

  const configured = serverVoiceProfiles()[input.personaId];
  const profile = approvedVoiceFor(input.personaId);
  if (!profile) {
    metadataLog(requestId, configured ?? null, input.personaId, input.speech.length, started, configured?.voiceId ? "license_not_approved" : "voice_unconfigured");
    return Response.json(
      { code: configured?.voiceId ? "voice_not_approved" : "voice_unconfigured" },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const apiKey = process.env.AIVIS_API_KEY?.trim();
  if (!apiKey) {
    metadataLog(requestId, profile, input.personaId, input.speech.length, started, "api_key_missing");
    return Response.json({ code: "aivis_api_key_missing" }, { status: 503 });
  }

  const normalizedSpeech = ttsTextNormalizer(input.speech);
  if (!normalizedSpeech) return Response.json({ code: "empty_speech" }, { status: 400 });

  const candidates = [profile];
  const fallback = approvedFallbackFor(profile);
  if (fallback && fallback.voiceProfileId !== profile.voiceProfileId) candidates.push(fallback);

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await synthesizeAivis(candidate, input, normalizedSpeech, apiKey, req.signal);
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

  metadataLog(requestId, profile, input.personaId, normalizedSpeech.length, started, "provider_error");
  return Response.json({ code: "tts_unavailable" }, {
    status: 503,
    headers: { "Cache-Control": "private, no-store" },
  });
}
