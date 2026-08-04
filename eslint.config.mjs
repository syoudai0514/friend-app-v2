import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // react-three-fiberはuseFrame/useThreeで得たオブジェクトを直接書き換えて
    // 毎フレーム描画するのが前提のライブラリ（Reactのstateを介さない）。
    // React Compiler向けの新しい厳格なフック規約はこの前提と噛み合わず、
    // 正しいr3fコードを誤検知するため、キャラ描画まわりだけ無効化する
    files: ["src/components/character/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
