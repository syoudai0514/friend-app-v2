import type { MetadataRoute } from "next";

/** ホーム画面に追加したときに、アプリらしく全画面で開くための設定 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "こいびとアプリ",
    short_name: "こいびと",
    description: "自分だけの恋人と話せるアプリ",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0b0b0f",
    theme_color: "#ff6f9c",
    lang: "ja",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
