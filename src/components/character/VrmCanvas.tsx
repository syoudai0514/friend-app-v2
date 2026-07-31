"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useState, type RefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Expression } from "@/lib/expressions";
import { VrmModel } from "./VrmModel";

export function VrmCanvas({
  url,
  motionUrl,
  expression,
  talking,
  reducedMotion,
  orbitControlsRef,
  onReady,
  onError,
}: {
  url: string;
  motionUrl: string;
  expression: Expression;
  talking: boolean;
  reducedMotion: boolean;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
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
        motionUrl={motionUrl}
        expression={expression}
        talking={talking}
        reducedMotion={reducedMotion}
        orbitControlsRef={orbitControlsRef}
        onReady={onReady}
        onError={onError}
      />
      {/*
        1本指ドラッグ=回り込み、2本指ピンチ=ズーム、2本指ドラッグ=位置ずらし（既定の割り当て）。
        真下から見上げるとスカートの中など見せたくないものが見えてしまうため、
        見上げは「顔を少し見上げる」程度までに制限し、真下には回り込めないようにする
      */}
      <OrbitControls
        ref={orbitControlsRef}
        enableDamping
        dampingFactor={0.15}
        minDistance={0.15}
        maxDistance={8}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.68}
      />
    </Canvas>
  );
}
