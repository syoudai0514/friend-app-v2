import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { PASS_COOKIE, verifyToken } from "@/lib/auth";

/**
 * 公開URLに置いたときの入口の見張り番。
 *
 * APP_PASSCODE が未設定なら素通し（ローカルでは今までどおり）。
 * 設定されているときだけ、合言葉を入れた人以外を /login に送る。
 */
export async function proxy(request: NextRequest) {
  const passcode = process.env.APP_PASSCODE;
  if (!passcode) return NextResponse.next();

  const token = request.cookies.get(PASS_COOKIE)?.value;
  if (await verifyToken(token, passcode)) return NextResponse.next();

  // APIは画面遷移させても仕方ないので、素直に401で返す
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  // ログイン画面とその通信、アイコンや静的ファイルだけは通す。
  // 立ち絵や背景の画像は保護対象（クッキーは自動で送られるので表示できる）
  matcher: [
    "/((?!login$|api/login$|_next/static|_next/image|favicon\\.ico$|manifest\\.webmanifest$|icon-\\d+\\.png$|apple-icon).*)",
  ],
};
