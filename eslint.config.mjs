import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    ".test-dist/**",
    "next-env.d.ts",
  ]),
  {
    // react-three-fiberはuseFrame/useThreeで得たオブジェクトを直接書き換えて
    // 毎フレーム描画するのが前提。React Compiler向け規約の誤検知だけ局所的に外す。
    files: ["src/components/character/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
