"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useState, type RefObject } from "react";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Expression } from "@/lib/expressions";
import { maskBodyUnderClothing } from "./fit-clothes";
import type { StageViewState } from "./stage-view";
import { applyArmDownPose, VrmModel, type ModelBounds } from "./VrmModel";

/** 服だけ／体だけを集める。マテリアル名の規則は VrmModel 側と揃えている */
function collectMeshesByMaterial(
  vrm: VRM,
  match: (material: THREE.Material) => boolean,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  vrm.scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    // アウトライン専用マテリアルは実体と同じジオメトリを共有するので数に入れない
    if (materials.some((m) => match(m) && !(m as { isOutline?: boolean }).isOutline)) {
      meshes.push(obj);
    }
  });
  return meshes;
}

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
  completeSkinUrl,
  skinGlossLevel,
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
  completeSkinUrl: string | null;
  skinGlossLevel: "normal" | "strong" | null;
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
  const [baseVrm, setBaseVrm] = useState<VRM | null>(null);
  const [outfitVrm, setOutfitVrm] = useState<VRM | null>(null);

  const onBaseBounds = useCallback((bounds: ModelBounds) => setBaseBounds(bounds), []);
  const onBaseReady = useCallback(
    (vrm: VRM) => {
      setBaseVrm(vrm);
      onReady?.();
    },
    [onReady],
  );
  const onOutfitVrmReady = useCallback((vrm: VRM) => {
    setOutfitVrm(vrm);
    setOutfitReady(true);
  }, []);
  const onOutfitBounds = useCallback((bounds: ModelBounds) => setOutfitBounds(bounds), []);
  const onHairBounds = useCallback((bounds: ModelBounds) => setHairBounds(bounds), []);

  const outfitScale =
    baseBounds && outfitBounds && outfitBounds.height > 0
      ? baseBounds.height / outfitBounds.height
      : 1;
  // headボーンのワールド座標はアイドルモーションの揺れ・向きで刻々と動くため、
  // 一度だけの計測値を全身の固定オフセットに使うと、計測の一瞬とズレたときに
  // 首が不自然に伸びる事故になった（実際にshizuku×なぎの服の組み合わせで発生）。
  // 位置合わせは足元（minY）基準に固定する。
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

  // 借りた服が本人の体を突き抜けないよう、服のメッシュを体の外側へ押し出す。
  // 拡縮・足元合わせが確定してから、両方を静止姿勢に固定して1回だけ焼き込む。
  // 衣装や本人が変われば元のジオメトリへ戻してから測り直す。
  useEffect(() => {
    if (!baseVrm || !outfitVrm || !baseBounds || !outfitBounds) return;

    const clothes = collectMeshesByMaterial(outfitVrm, (m) => /_CLOTH(?:_| \(|$)/.test(m.name));
    if (clothes.length === 0) return;

    // 計測と同じく、姿勢に依存しない静止姿勢で焼き込む。スキニングはこのあとに
    // 適用されるので、ここで動かした頂点はそのまま全モーションへ追従する
    const restPose = (vrm: VRM) => {
      vrm.humanoid.resetNormalizedPose();
      vrm.humanoid.update();
      vrm.scene.updateMatrixWorld(true);
    };
    restPose(baseVrm);
    restPose(outfitVrm);

    // 服が覆っている範囲の体を隠して貫通を断つ。VRoid自身が「服の下の体」を
    // テクスチャのアルファで消しているのと同じことを、借り物の服の形に合わせてやる
    const body = collectMeshesByMaterial(baseVrm, (m) => /Body_00_SKIN/.test(m.name));
    const masked = maskBodyUnderClothing(body, clothes);

    // restポーズで腕を下ろす姿勢が消えるので掛け直す（モーションが無いときの見た目用。
    // モーションがあれば次のフレームで上書きされる）
    applyArmDownPose(baseVrm);
    applyArmDownPose(outfitVrm);

    return () => masked.restore();
  }, [baseVrm, outfitVrm, baseBounds, outfitBounds, outfitScale, outfitOffsetY]);

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
        hideHair={hasHair && hairReady}
        irisTextureUrl={irisTextureUrl}
        browsTextureUrl={browsTextureUrl}
        mouthTextureUrl={mouthTextureUrl}
        bodySkinColor={bodySkinColor}
        bodySkinSourceColor={bodySkinSourceColor}
        completeSkinUrl={completeSkinUrl}
        skinGlossLevel={skinGlossLevel}
        initialView={initialView}
        minCameraDistance={minCameraDistance}
        syncMotion={hasOutfit || hasHair}
        onMeasured={onBaseBounds}
        onReady={onBaseReady}
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
          // 服だけを借りる。本人のBody_00_SKINは下着まで含んだ完全な素体なので、
          // 衣装元の体は一切要らない（重ねると首の継ぎ目・肌の色差が必ず出る）
          materialMode="onlyClothes"
          fitCamera={false}
          syncMotion
          modelScale={[outfitScale, outfitScale, outfitScale * outfitDepthScale]}
          modelOffsetY={outfitOffsetY}
          onMeasured={onOutfitBounds}
          onReady={onOutfitVrmReady}
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
  completeSkinUrl = null,
  skinGlossLevel = null,
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
  completeSkinUrl?: string | null;
  skinGlossLevel?: "normal" | "strong" | null;
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
  // 注視点を2本指で移動しても、実際の頭との衝突判定はVrmModel側で行う。
  // OrbitControls側は操作感を損なわない最低限のズーム制限だけにする。
  const minCameraDistance = 0.18;
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
        completeSkinUrl={completeSkinUrl}
        skinGlossLevel={skinGlossLevel}
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
        // 実際の頭との距離は、モーションと位置ずらしを反映したあとに別途保護する。
        minDistance={minCameraDistance}
        maxDistance={8}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.68}
      />
    </Canvas>
  );
}
