import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /api/assets は public/ の中身を実行時に読む。
  // Vercel などにデプロイすると public/ は静的配信側に分けられて
  // 関数からは見えなくなるので、明示的に同梱する
  outputFileTracingIncludes: {
    "/api/assets": ["./public/vrm/**/*", "./public/vrma/**/*"],
  },
};

export default nextConfig;
