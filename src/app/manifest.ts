import type { MetadataRoute } from "next";

/** ホーム画面に追加したときに、アプリらしく全画面で開くための設定 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "フレンド",
    short_name: "フレンド",
    description: "友達と話せるシンプルなチャットアプリ",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#243247",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
