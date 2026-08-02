"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useState, type RefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Expression } from "@/lib/expressions";
import type { StageViewState } from "./stage-view";
import { VrmModel, type ModelBounds } from "./VrmModel";

function AppearanceLayers({
  url,
  outfitUrl,
  outfitDepthScale,
  hairUrl,
  irisTextureUrl,
  browsTextureUrl,
  mouthTextureUrl,
  bodySkinColor,
  bodySkinSourceColor,
  initialView,
  minCameraDistance,
  motionUrl,
  expression,
  talking,
  reducedMotion,
  orbitControlsRef,
  onReady,
  onError,
}: {
  url: string;
  outfitUrl: string | null;
  outfitDepthScale: number;
  hairUrl: string | null;
  irisTextureUrl: string | null;
  browsTextureUrl: string | null;
  mouthTextureUrl: string | null;
  bodySkinColor: string | null;
  bodySkinSourceColor: string | null;
  initialView: StageViewState | null;
  minCameraDistance: number;
  motionUrl: string;
  expression: Expression;
  talking: boolean;
  reducedMotion: boolean;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  onReady?: () => void;
  onError?: () => void;
}) {
  const [outfitReady, setOutfitReady] = useState(false);
  const [hairReady, setHairReady] = useState(false);
  const [baseBounds, setBaseBounds] = useState<ModelBounds | null>(null);
  const [outfitBounds, setOutfitBounds] = useState<ModelBounds | null>(null);
  const [hairBounds, setHairBounds] = useState<ModelBounds | null>(null);

  const onBaseBounds = useCallback((bounds: ModelBounds) => setBaseBounds(bounds), []);
  const onOutfitBounds = useCallback((bounds: ModelBounds) => setOutfitBounds(bounds), []);
  const onHairBounds = useCallback((bounds: ModelBounds) => setHairBounds(bounds), []);

  const outfitScale =
    baseBounds && outfitBounds && outfitBounds.height > 0
      ? baseBounds.height / outfitBounds.height
      : 1;
  const outfitOffsetY =
    baseBounds && outfitBounds ? baseBounds.minY - outfitBounds.minY * outfitScale : 0;
  const hasOutfit = Boolean(outfitUrl);
  const hasHair = Boolean(hairUrl);
  const hairScale =
    baseBounds && hairBounds && hairBounds.height > 0 ? baseBounds.height / hairBounds.height : 1;
  const canAlignHeads = Boolean(baseBounds?.head && hairBounds?.head);
  const hairOffsetX = canAlignHeads
    ? baseBounds!.head!.x - hairBounds!.head!.x * hairScale
    : 0;
  const hairOffsetY = canAlignHeads
    ? baseBounds!.head!.y - hairBounds!.head!.y * hairScale
    : 0;
  const hairOffsetZ = canAlignHeads
    ? baseBounds!.head!.z - hairBounds!.head!.z * hairScale
    : 0;

  return (
    <>
      <VrmModel
        url={url}
        motionUrl={motionUrl}
        expression={expression}
        talking={talking}
        reducedMotion={reducedMotion}
        orbitControlsRef={orbitControlsRef}
        hideClothes={hasOutfit && outfitReady}
        hideBody={hasOutfit && outfitReady}
        hideHair={hasHair && hairReady}
        irisTextureUrl={irisTextureUrl}
        browsTextureUrl={browsTextureUrl}
        mouthTextureUrl={mouthTextureUrl}
        initialView={initialView}
        minCameraDistance={minCameraDistance}
        syncMotion={hasOutfit || hasHair}
        onMeasured={onBaseBounds}
        onReady={onReady}
        onError={onError}
      />
      {outfitUrl && (
        <VrmModel
          url={outfitUrl}
          motionUrl={motionUrl}
          expression="normal"
          talking={false}
          reducedMotion={reducedMotion}
          orbitControlsRef={orbitControlsRef}
          materialMode="bodyAndClothes"
          bodySkinColor={bodySkinColor}
          bodySkinSourceColor={bodySkinSourceColor}
          fitCamera={false}
          syncMotion
          modelScale={[outfitScale, outfitScale, outfitScale * outfitDepthScale]}
          modelOffsetY={outfitOffsetY}
          onMeasured={onOutfitBounds}
          onReady={() => setOutfitReady(true)}
        />
      )}
      {hairUrl && (
        <VrmModel
          url={hairUrl}
          motionUrl={motionUrl}
          expression="normal"
          talking={false}
          reducedMotion={reducedMotion}
          orbitControlsRef={orbitControlsRef}
          materialMode="onlyHair"
          fitCamera={false}
          syncMotion
          modelScale={hairScale}
          modelOffsetX={hairOffsetX}
          modelOffsetY={hairOffsetY}
          modelOffsetZ={hairOffsetZ}
          onMeasured={onHairBounds}
          onReady={() => setHairReady(true)}
        />
      )}
    </>
  );
}

export function VrmCanvas({
  url,
  outfitUrl = null,
  outfitDepthScale = 1,
  hairUrl = null,
  irisTextureUrl = null,
  browsTextureUrl = null,
  mouthTextureUrl = null,
  bodySkinColor = null,
  bodySkinSourceColor = null,
  initialView = null,
  onViewChange,
  motionUrl,
  expression,
  talking,
  reducedMotion,
  orbitControlsRef,
  onReady,
  onError,
}: {
  url: string;
  outfitUrl?: string | null;
  outfitDepthScale?: number;
  hairUrl?: string | null;
  irisTextureUrl?: string | null;
  browsTextureUrl?: string | null;
  mouthTextureUrl?: string | null;
  bodySkinColor?: string | null;
  bodySkinSourceColor?: string | null;
  initialView?: StageViewState | null;
  onViewChange?: (view: StageViewState) => void;
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
  const minCameraDistance = motionUrl.endsWith("/situp.vrma") ? 2.4 : 0.18;
  const rememberView = useCallback(() => {
    const controls = orbitControlsRef.current;
    if (!controls || !onViewChange) return;
    const { position } = controls.object;
    const { target } = controls;
    const camera = controls.object as { zoom?: number };
    onViewChange({
      cameraPosition: [position.x, position.y, position.z],
      target: [target.x, target.y, target.z],
      zoom: typeof camera.zoom === "number" ? camera.zoom : 1,
    });
  }, [onViewChange, orbitControlsRef]);

  return (
    <Canvas
      key={canvasKey}
      className="absolute inset-0"
      // 顔へ寄ったときも、手前の髪・顔がnear planeで切れない距離にする。
      camera={{ fov: 28, near: 0.01, far: 20 }}
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
      <AppearanceLayers
        key={`${outfitUrl ?? "base-only"}|${hairUrl ?? "base-hair"}`}
        url={url}
        outfitUrl={outfitUrl}
        outfitDepthScale={outfitDepthScale}
        hairUrl={hairUrl}
        irisTextureUrl={irisTextureUrl}
        browsTextureUrl={browsTextureUrl}
        mouthTextureUrl={mouthTextureUrl}
        bodySkinColor={bodySkinColor}
        bodySkinSourceColor={bodySkinSourceColor}
        motionUrl={motionUrl}
        expression={expression}
        talking={talking}
        reducedMotion={reducedMotion}
        orbitControlsRef={orbitControlsRef}
        initialView={initialView}
        minCameraDistance={minCameraDistance}
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
        onChange={rememberView}
        enableDamping
        dampingFactor={0.15}
        // 腹筋は頭が大きく手前へ動くため、顔の内側へ入らない距離で止める。
        // それ以外は従来どおり近くまで寄れる。
        minDistance={minCameraDistance}
        maxDistance={8}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.68}
      />
    </Canvas>
  );
}
