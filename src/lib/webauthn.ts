"use client";

/**
 * 端末ロック用の生体認証（Face ID・指紋・Windows Helloなど）とパスコード。
 *
 * サーバーには何も送らない。生体認証はブラウザのWebAuthnで完結させ、
 * 実際の指紋・顔の判定はOS側に任せる（このアプリは成功したかどうかだけを見る）。
 * パスコードは平文を保存せず、SHA-256のハッシュだけを持つ。
 */

function toBase64Url(buf: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buf)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): BufferSource {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const pad = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** この端末・ブラウザでFace ID等の生体認証を使えそうか */
export function biometricSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

/** 生体認証を新しく登録し、あとで照合に使うID（base64url）を返す */
export async function registerBiometric(): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "こいびとアプリ" },
      user: { id: userId, name: "あなた", displayName: "あなた" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256
        { type: "public-key", alg: -257 }, // RS256
      ],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
      timeout: 60000,
    },
  })) as PublicKeyCredential | null;

  if (!credential) throw new Error("credential creation failed");
  return toBase64Url(credential.rawId);
}

/** 登録済みの生体認証で確認する。成功したときだけ true */
export async function verifyBiometric(credentialId: string): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: fromBase64Url(credentialId), type: "public-key" }],
        userVerification: "required",
        timeout: 60000,
      },
    });
    return !!assertion;
  } catch {
    // ユーザーが取り消した・認証に失敗した、どちらも false でまとめる
    return false;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** パスコードをハッシュにする。保存するのはこの値だけ */
export async function hashPasscode(passcode: string): Promise<string> {
  return sha256Hex(`friend-app-lock:${passcode}`);
}

/** 入力されたパスコードが、保存済みのハッシュと一致するか */
export async function verifyPasscode(passcode: string, hash: string): Promise<boolean> {
  return (await hashPasscode(passcode)) === hash;
}
