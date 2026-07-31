"use client";

import { Canvas } from "@react-three/fiber";
import { useState } from "react";
import type { Expression } from "@/lib/expressions";
import { VrmModel } from "./VrmModel";
import type { CharacterView } from "./view";

export function VrmCanvas({
  url,
  expression,
  talking,
  reducedMotion,
  view,
  onReady,
  onError,
}: {
  url: string;
  expression: Expression;
  talking: boolean;
  reducedMotion: boolean;
  view: CharacterView;
  onReady?: () => void;
  onError?: () => void;
}) {
  // WebGL context lost（バックグラウンド復帰時など）が起きたら、
  // Canvasごと作り直してレンダラーを立て直す
  const [canvasKey, setCanvasKey] = useState(0);

  return (
    <Canvas
      key={canvasKey}
      className="absolute inset-0"
      camera={{ fov: 28, near: 0.1, far: 20 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.domElement.addEventListener(
          "webglcontextlost",
          (e: Event) => {
            e.preventDefault();
            setCanvasKey((k) => k + 1);
          },
          { once: true },
        );
      }}
    >
      <ambientLight intensity={0.95} />
      <directionalLight position={[0.5, 1, 0.8]} intensity={0.55} />
      <VrmModel
        url={url}
        expression={expression}
        talking={talking}
        reducedMotion={reducedMotion}
        view={view}
        onReady={onReady}
        onError={onError}
      />
    </Canvas>
  );
}
