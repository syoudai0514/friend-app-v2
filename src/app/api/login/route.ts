import { PASS_COOKIE, PASS_MAX_AGE, createToken, matchesPasscode } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const passcode = process.env.APP_PASSCODE;

  // 合言葉を設定していない＝誰でも入れる運用なので、そのまま通す
  if (!passcode) return Response.json({ ok: true });

  let input: unknown;
  try {
    input = ((await request.json()) as { passcode?: unknown }).passcode;
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (!matchesPasscode(input, passcode)) {
    return Response.json({ ok: false }, { status: 401 });
  }

  const https =
    request.headers.get("x-forwarded-proto") === "https" ||
    new URL(request.url).protocol === "https:";

  const cookie = [
    `${PASS_COOKIE}=${await createToken(passcode)}`,
    "Path=/",
    `Max-Age=${PASS_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    https ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
}
