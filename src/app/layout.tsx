import type { Metadata, Viewport } from "next";
import { LockGate } from "@/components/LockGate";
import { LockProvider } from "@/lib/lock";
import { AppStateProvider } from "@/lib/store";
import "./globals.css";

export const metadata: Metadata = {
  title: "フレンド",
  description: "友達と話せるシンプルなチャットアプリ",
  // ホーム画面から開いたときにブラウザのバーを出さない
  appleWebApp: {
    capable: true,
    title: "フレンド",
    statusBarStyle: "black-translucent",
  },
  // 個人用なので検索には出さない
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#243247",
  // iPhone のノッチ周りまで背景を敷く
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full antialiased">
        <LockProvider>
          <AppStateProvider>
            {/* スマホ想定。PCでは中央に寄せて縦長の画面として見せる */}
            <div className="mx-auto flex h-full w-full max-w-[480px] flex-col overflow-hidden bg-black shadow-2xl">
              <LockGate>{children}</LockGate>
            </div>
          </AppStateProvider>
        </LockProvider>
      </body>
    </html>
  );
}
