import { ttsTextNormalizer, validTtsRequest, voiceProfileFor } from "@/lib/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TTS専用のprivacy boundary。clientから受ける値はcanonical speechだけで、
 * user message / narration / memory / prompt はこのrouteの型に存在しない。
 */
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ code: "invalid_request" }, { status: 400 }); }
  const input = validTtsRequest(body);
  if (!input) return Response.json({ code: "invalid_request" }, { status: 400 });
  const profile = voiceProfileFor(input.personaId);
  if (!profile) return Response.json({ code: "voice_unconfigured" }, { status: 409 });

  // 現時点では公式OpenAPIを環境から機械検証できず、推測したendpoint/parameterは使わない。
  // profileをapprovedにしたうえでadapterを追加するまで、安全にtext-onlyへ留める。
  const normalizedSpeech = ttsTextNormalizer(input.speech);
  if (!normalizedSpeech) return Response.json({ code: "empty_speech" }, { status: 400 });
  console.info(JSON.stringify({ requestId, provider: profile.provider, personaId: input.personaId, characterCount: normalizedSpeech.length, latencyMs: Date.now() - started, status: "blocked_unconfigured_adapter" }));
  return Response.json({ code: "provider_not_configured" }, { status: 503 });
}
