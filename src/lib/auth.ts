/**
 * 公開URLで動かすときの簡易パスコード認証。
 *
 * APP_PASSCODE が設定されていないときは何もしない（＝ローカルではそのまま使える）。
 * 設定されているときだけ、署名付きクッキーを持っていない相手を /login に送る。
 *
 * Proxy（Edge）と API ルートの両方から使うので、Node 固有のAPIは使わず
 * Web Crypto だけで書いている。
 */

export const PASS_COOKIE = "friend-app-pass";

/** ログインを保持する期間 */
export const PASS_MAX_AGE = 60 * 60 * 24 * 30; // 30日

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(payload: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return toBase64Url(sig);
}

/** 長さと中身が一致するかを、比較時間が内容に依らない形で確かめる */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 有効期限つきの署名トークンを作る */
export async function createToken(secret: string): Promise<string> {
  const expiresAt = String(Date.now() + PASS_MAX_AGE * 1000);
  return `${expiresAt}.${await sign(expiresAt, secret)}`;
}

/** トークンが本物で、まだ期限内かを確かめる */
export async function verifyToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;

  const expiresAt = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expiresAt) || Number(expiresAt) < Date.now()) return false;

  return safeEqual(await sign(expiresAt, secret), signature);
}

/** パスコード自体の照合 */
export function matchesPasscode(input: unknown, secret: string): boolean {
  return typeof input === "string" && safeEqual(input, secret);
}
