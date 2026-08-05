"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { EXPRESSIONS, type Expression } from "@/lib/expressions";
import { useVrm } from "./useVrm";
import { useVrma } from "./useVrma";
import type { StageViewState } from "./stage-view";

/** 気分の表情プリセット。まばたき(blink*)や口の形(aa)とは別に、毎フレーム一度リセットしてから適用する */
const MOOD_PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral"] as const;
type MoodPreset = (typeof MOOD_PRESETS)[number];

function initialMoodWeights(): Record<MoodPreset, number> {
  return {
    happy: 0,
    angry: 0,
    sad: 0,
    relaxed: 0,
    surprised: 0,
    neutral: 0,
  };
}

interface BoneOffset {
  node: THREE.Object3D;
  applied: THREE.Quaternion;
  inverse: THREE.Quaternion;
  euler: THREE.Euler;
}

interface ShyPose {
  weight: number;
  head: BoneOffset | null;
  leftEye: BoneOffset | null;
  rightEye: BoneOffset | null;
}

function boneOffset(node: THREE.Object3D | null): BoneOffset | null {
  if (!node) return null;
  return {
    node,
    applied: new THREE.Quaternion(),
    inverse: new THREE.Quaternion(),
    euler: new THREE.Euler(),
  };
}

function shyPoseFor(vrm: VRM): ShyPose {
  return {
    weight: 0,
    head: boneOffset(vrm.humanoid.getNormalizedBoneNode("head")),
    leftEye: boneOffset(vrm.humanoid.getNormalizedBoneNode("leftEye")),
    rightEye: boneOffset(vrm.humanoid.getNormalizedBoneNode("rightEye")),
  };
}

/** 前フレームで足した差分だけを外し、モーションの基準姿勢へ戻す */
function clearBoneOffset(bone: BoneOffset | null): void {
  if (
    !bone ||
    (bone.applied.x === 0 && bone.applied.y === 0 && bone.applied.z === 0 && bone.applied.w === 1)
  ) {
    return;
  }
  bone.inverse.copy(bone.applied).invert();
  bone.node.quaternion.multiply(bone.inverse).normalize();
  bone.applied.identity();
}

function clearShyPose(pose: ShyPose): void {
  clearBoneOffset(pose.head);
  clearBoneOffset(pose.leftEye);
  clearBoneOffset(pose.rightEye);
}

function applyBoneOffset(
  bone: BoneOffset | null,
  x: number,
  y: number,
  z: number,
): void {
  if (!bone) return;
  bone.euler.set(x, y, z);
  bone.applied.setFromEuler(bone.euler);
  bone.node.quaternion.multiply(bone.applied).normalize();
}

/**
 * 腕を下ろした静止姿勢。normalizedボーンは「回転0 = T-pose」が基準なので絶対角度で指定する。
 * 計測時に一度restポーズへ戻すと消えるため、関数として切り出して測り終えたら掛け直す。
 */
function applyArmDownPose(vrm: VRM): void {
  const armDown = Math.PI * 0.42;
  const leftUpperArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
  const rightUpperArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
  if (leftUpperArm) leftUpperArm.rotation.z = armDown;
  if (rightUpperArm) rightUpperArm.rotation.z = -armDown;
}

/** v1のまばたき間隔・閉眼時間に合わせる */
const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;

/** カメラが顔や後頭部の内側へ入り込まない、頭の中心からの最小距離（m） */
const MIN_HEAD_CAMERA_DISTANCE = 0.45;

export interface ModelBounds {
  height: number;
  minY: number;
  head: { x: number; y: number; z: number } | null;
}

export type VrmMaterialMode = "full" | "onlyClothes" | "onlyHair";

function isClothingMaterial(material: THREE.Material): boolean {
  return /_CLOTH(?:_| \(|$)/.test(material.name);
}

function isHairMaterial(material: THREE.Material): boolean {
  return /_HAIR(?:_| \(|$)/.test(material.name);
}

function isBodyMaterial(material: THREE.Material): boolean {
  return /Body_00_SKIN/.test(material.name);
}

function isFaceSkinMaterial(material: THREE.Material): boolean {
  return /Face_00_SKIN/.test(material.name);
}

/** MToonマテリアルのうち、脚などBodyの艶（matcap＋リムライト）を上書きする対象を表した型 */
type SkinGlossMaterial = THREE.Material & {
  isMToonMaterial: true;
  matcapFactor: THREE.Color;
  matcapTexture: THREE.Texture | null;
  rimLightingMixFactor: number;
  parametricRimColorFactor: THREE.Color;
  parametricRimFresnelPowerFactor: number;
  parametricRimLiftFactor: number;
};

function isSkinGlossMaterial(material: THREE.Material): material is SkinGlossMaterial {
  return (
    (material as { isMToonMaterial?: boolean }).isMToonMaterial === true &&
    !(material as { isOutline?: boolean }).isOutline &&
    isBodyMaterial(material)
  );
}

/** しずくの黒レザードレスVRMから抽出した艶matcap。キャラを問わず共通で使う */
const SKIN_GLOSS_MATCAP_URL = "/textures/skin-gloss-matcap.png";

/** 「普通」はしずくのVRMに実際に入っている値、「強」はそれより強めた版 */
const SKIN_GLOSS_PRESETS: Record<
  "normal" | "strong",
  { matcap: number; rimColor: number; fresnel: number; lift: number }
> = {
  normal: { matcap: 0.09, rimColor: 0.00155, fresnel: 100, lift: 0.1 },
  strong: { matcap: 0.18, rimColor: 0.00155, fresnel: 100, lift: 0.1 },
};

type TexturedMaterial = THREE.Material & { map: THREE.Texture | null };

type Rgb = readonly [number, number, number];

function hasTextureMap(material: THREE.Material): material is TexturedMaterial {
  return "map" in material;
}

function parseHexColor(color: string): Rgb | null {
  const hex = color.replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function isSkinPixel(r: number, g: number, b: number, source: Rgb): boolean {
  // 白い靴下や黒い下着は残し、元の肌色と同じ色相を持つ部分だけを対象にする。
  // 明暗はテクスチャ側の陰影として許容し、RGBの比率で肌かどうかを判定する。
  if (r < 65 || g < 45 || b < 35 || r - g < 4 || g - b < 2) return false;
  const pixelTotal = r + g + b;
  const sourceTotal = source[0] + source[1] + source[2];
  const chromaDistance =
    Math.abs(r / pixelTotal - source[0] / sourceTotal) +
    Math.abs(g / pixelTotal - source[1] / sourceTotal) +
    Math.abs(b / pixelTotal - source[2] / sourceTotal);
  return chromaDistance < 0.075;
}

function recolorBodyTexture(
  original: THREE.Texture,
  source: Rgb,
  target: Rgb,
): THREE.Texture | null {
  const image = original.image as CanvasImageSource | undefined;
  const dimensions = image as { width?: number; height?: number } | undefined;
  const width = dimensions?.width ?? 0;
  const height = dimensions?.height ?? 0;
  if (!image || width <= 0 || height <= 0) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  try {
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    const ratios: Rgb = [target[0] / source[0], target[1] / source[1], target[2] / source[2]];
    for (let index = 0; index < pixels.length; index += 4) {
      if (
        pixels[index + 3] > 0 &&
        isSkinPixel(pixels[index], pixels[index + 1], pixels[index + 2], source)
      ) {
        pixels[index] = Math.min(255, Math.round(pixels[index] * ratios[0]));
        pixels[index + 1] = Math.min(255, Math.round(pixels[index + 1] * ratios[1]));
        pixels[index + 2] = Math.min(255, Math.round(pixels[index + 2] * ratios[2]));
      }
    }
    context.putImageData(imageData, 0, 0);
  } catch {
    return null;
  }

  const recolored = new THREE.CanvasTexture(canvas);
  recolored.name = `${original.name || "body"}-skin-recolored`;
  recolored.colorSpace = original.colorSpace;
  recolored.flipY = original.flipY;
  recolored.wrapS = original.wrapS;
  recolored.wrapT = original.wrapT;
  recolored.magFilter = original.magFilter;
  recolored.minFilter = original.minFilter;
  recolored.generateMipmaps = original.generateMipmaps;
  recolored.needsUpdate = true;
  return recolored;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 全身が収まるカメラ距離を、実際の身長(height)とカメラの垂直画角から逆算する */
function fitDistance(visibleHeight: number, verticalFovRad: number): number {
  return visibleHeight / 2 / Math.tan(verticalFovRad / 2);
}

export function VrmModel({
  url,
  motionUrl,
  expression,
  talking,
  reducedMotion,
  orbitControlsRef,
  materialMode = "full",
  hideClothes = false,
  hideHair = false,
  irisTextureUrl = null,
  browsTextureUrl = null,
  mouthTextureUrl = null,
  bodySkinColor = null,
  bodySkinSourceColor = null,
  skinGlossLevel = null,
  initialView = null,
  minCameraDistance = 0,
  fitCamera = true,
  syncMotion = false,
  modelScale = 1,
  modelOffsetX = 0,
  modelOffsetY = 0,
  modelOffsetZ = 0,
  onMeasured,
  onReady,
  onError,
}: {
  url: string;
  motionUrl: string;
  expression: Expression;
  talking: boolean;
  reducedMotion: boolean;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  materialMode?: VrmMaterialMode;
  hideClothes?: boolean;
  hideHair?: boolean;
  irisTextureUrl?: string | null;
  browsTextureUrl?: string | null;
  mouthTextureUrl?: string | null;
  bodySkinColor?: string | null;
  bodySkinSourceColor?: string | null;
  skinGlossLevel?: "normal" | "strong" | null;
  initialView?: StageViewState | null;
  minCameraDistance?: number;
  fitCamera?: boolean;
  syncMotion?: boolean;
  modelScale?: number | [number, number, number];
  modelOffsetX?: number;
  modelOffsetY?: number;
  modelOffsetZ?: number;
  onMeasured?: (bounds: ModelBounds) => void;
  onReady?: () => void;
  onError?: () => void;
}) {
  const { vrm, error } = useVrm(url);
  const { vrmAnimation } = useVrma(motionUrl);
  const { camera } = useThree();
  const blink = useRef({ nextAt: 0, closingUntil: 0 });
  const talkClock = useRef(0);
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const clipDuration = useRef(0);
  const moodWeights = useRef(initialMoodWeights());
  const shyPose = useRef<ShyPose | null>(null);
  const headWorldPosition = useRef(new THREE.Vector3());
  const headCameraOffset = useRef(new THREE.Vector3());

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

  // VRoidのマテリアル名にある _CLOTH / _HAIR を境界として、ベース側の
  // パーツを隠したり、提供元側の対象パーツだけを残したりする。
  // アウトライン材も元の名前を含むので同じ判定で揃う。
  useEffect(() => {
    if (!vrm) return;
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        const clothing = isClothingMaterial(material);
        const hair = isHairMaterial(material);
        if (materialMode === "onlyClothes") {
          material.visible = clothing;
        } else if (materialMode === "onlyHair") {
          material.visible = hair;
        } else {
          material.visible = !(hideClothes && clothing) && !(hideHair && hair);
        }
      }
    });
  }, [hideClothes, hideHair, materialMode, vrm]);

  // 表示対象のパーツを固定してから親へ準備完了を伝える。これによりベース側を
  // 隠すタイミングでも、一瞬だけ衣装元の全身が混ざる状態を作らない。
  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

  // 衣装側のBody形状を一緒に使うことで、VRoidの書き出し時に省かれた身体の面を補う。
  // Body画像に焼き込まれた下着・靴下・陰影は残し、肌に当たる色だけ着る側へ合わせる。
  // Face_00_SKINも同時に合わせないと、本人の肌色を変えたときに顔だけ元の色のまま
  // 残り、首の境目で二色に分かれて見える事故になる（衣装元の顔は元々非表示なので
  // ここに含めても実害はない）。
  useEffect(() => {
    if (!vrm || !bodySkinColor || !bodySkinSourceColor) return;
    const source = parseHexColor(bodySkinSourceColor);
    const target = parseHexColor(bodySkinColor);
    if (!source || !target || source.every((channel, index) => channel === target[index])) return;

    const originalMaps = new Map<TexturedMaterial, THREE.Texture | null>();
    const recoloredMaps = new Map<THREE.Texture, THREE.Texture>();
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        const isSkin = isBodyMaterial(material) || isFaceSkinMaterial(material);
        if (!isSkin || !hasTextureMap(material) || !material.map) continue;
        const original = material.map;
        let recolored = recoloredMaps.get(original);
        if (!recolored) {
          recolored = recolorBodyTexture(original, source, target) ?? undefined;
          if (!recolored) continue;
          recoloredMaps.set(original, recolored);
        }
        originalMaps.set(material, original);
        material.map = recolored;
        material.needsUpdate = true;
      }
    });

    return () => {
      for (const [material, map] of originalMaps) {
        material.map = map;
        material.needsUpdate = true;
      }
      for (const texture of recoloredMaps.values()) texture.dispose();
    };
  }, [bodySkinColor, bodySkinSourceColor, vrm]);

  // Bodyの艶（matcap＋リムライト）を選んだ強さで上書きする。しずくのVRMから
  // 抽出した共通matcap画像を使うため、キャラを問わず同じ見た目の光沢になる。
  // 未指定時は何もしない＝読み込み時の既定（addSkinSheenまたは各VRM内蔵の値）のまま
  useEffect(() => {
    if (!vrm || !skinGlossLevel) return;
    const preset = SKIN_GLOSS_PRESETS[skinGlossLevel];

    const targets: SkinGlossMaterial[] = [];
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (isSkinGlossMaterial(material)) targets.push(material);
      }
    });
    if (targets.length === 0) return;

    let cancelled = false;
    const originals = new Map<
      SkinGlossMaterial,
      {
        matcapFactor: THREE.Color;
        matcapTexture: THREE.Texture | null;
        rimLightingMixFactor: number;
        parametricRimColorFactor: THREE.Color;
        parametricRimFresnelPowerFactor: number;
        parametricRimLiftFactor: number;
      }
    >();
    for (const material of targets) {
      originals.set(material, {
        matcapFactor: material.matcapFactor.clone(),
        matcapTexture: material.matcapTexture,
        rimLightingMixFactor: material.rimLightingMixFactor,
        parametricRimColorFactor: material.parametricRimColorFactor.clone(),
        parametricRimFresnelPowerFactor: material.parametricRimFresnelPowerFactor,
        parametricRimLiftFactor: material.parametricRimLiftFactor,
      });
    }

    const loadedTextures: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader();
    loader.load(SKIN_GLOSS_MATCAP_URL, (texture) => {
      if (cancelled) {
        texture.dispose();
        return;
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.needsUpdate = true;
      loadedTextures.push(texture);
      for (const material of targets) {
        material.matcapFactor.setScalar(preset.matcap);
        material.matcapTexture = texture;
        material.rimLightingMixFactor = 1;
        material.parametricRimColorFactor.setScalar(preset.rimColor);
        material.parametricRimFresnelPowerFactor = preset.fresnel;
        material.parametricRimLiftFactor = preset.lift;
        material.needsUpdate = true;
      }
    });

    return () => {
      cancelled = true;
      for (const [material, original] of originals) {
        material.matcapFactor.copy(original.matcapFactor);
        material.matcapTexture = original.matcapTexture;
        material.rimLightingMixFactor = original.rimLightingMixFactor;
        material.parametricRimColorFactor.copy(original.parametricRimColorFactor);
        material.parametricRimFresnelPowerFactor = original.parametricRimFresnelPowerFactor;
        material.parametricRimLiftFactor = original.parametricRimLiftFactor;
        material.needsUpdate = true;
      }
      for (const texture of loadedTextures) texture.dispose();
    };
  }, [skinGlossLevel, vrm]);

  // VRoid共通UVを使い、顔の形状や表情モーフはベースキャラのまま、
  // 瞳・眉・口の画像だけを差し替える。読み直し時は必ず元の画像へ戻す。
  useEffect(() => {
    if (!vrm) return;
    const requests = [
      { url: irisTextureUrl, pattern: /EyeIris_00_EYE/ },
      { url: browsTextureUrl, pattern: /FaceBrow_00_FACE/ },
      { url: mouthTextureUrl, pattern: /FaceMouth_00_FACE/ },
    ].filter((request): request is { url: string; pattern: RegExp } => Boolean(request.url));
    if (requests.length === 0) return;

    let cancelled = false;
    const originalMaps = new Map<TexturedMaterial, THREE.Texture | null>();
    const loadedTextures: THREE.Texture[] = [];
    const loader = new THREE.TextureLoader();

    for (const request of requests) {
      const targets: TexturedMaterial[] = [];
      vrm.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const material of materials) {
          if (request.pattern.test(material.name) && hasTextureMap(material)) {
            targets.push(material);
          }
        }
      });
      loader.load(request.url, (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        loadedTextures.push(texture);
        for (const material of targets) {
          if (!originalMaps.has(material)) originalMaps.set(material, material.map);
          material.map = texture;
          material.needsUpdate = true;
        }
      });
    }

    return () => {
      cancelled = true;
      for (const [material, map] of originalMaps) {
        material.map = map;
        material.needsUpdate = true;
      }
      for (const texture of loadedTextures) texture.dispose();
    };
  }, [browsTextureUrl, irisTextureUrl, mouthTextureUrl, vrm]);

  // 表情用の頭・目の差分回転はVRMごとに作る。切替時は必ず元へ戻し、
  // 次のモデルやモーションへ差分を持ち越さない。
  useEffect(() => {
    moodWeights.current = initialMoodWeights();
    blink.current = { nextAt: 0, closingUntil: 0 };
    if (!vrm) {
      shyPose.current = null;
      return;
    }
    const pose = shyPoseFor(vrm);
    shyPose.current = pose;
    return () => {
      clearShyPose(pose);
      if (shyPose.current === pose) shyPose.current = null;
    };
  }, [vrm]);

  // VRMは何もしないとT-pose（腕を真横に伸ばした基本姿勢）のままなので、
  // 自然に立った姿に見えるよう腕を下ろす。normalizedボーンは
  // 「回転0 = T-pose」という決まった基準で作られているため、
  // 前回のような差分ではなく絶対角度で指定する
  useEffect(() => {
    if (!vrm) return;
    applyArmDownPose(vrm);
  }, [vrm]);

  // モーション(VRMA)が読めたら再生する。読めなかった・まだ無いモーションIDのときは
  // 上のarmDownによる静止ポーズのままになる
  useEffect(() => {
    if (!vrm || !vrmAnimation) {
      mixer.current = null;
      activeAction.current = null;
      clipDuration.current = 0;
      return;
    }
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    const m = new THREE.AnimationMixer(vrm.scene);
    const action = m.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();

    // ループの継ぎ目でポーズが不連続に飛ぶと、髪などのスプリングボーン物理が
    // その勢いを拾って一瞬暴れることがある。ループのたびに物理状態を
    // 今の姿勢でリセットして、暴れを引きずらないようにする
    const onLoop = () => vrm.springBoneManager?.reset();
    m.addEventListener("loop", onLoop);

    mixer.current = m;
    activeAction.current = action;
    clipDuration.current = clip.duration;
    return () => {
      m.removeEventListener("loop", onLoop);
      m.stopAllAction();
      mixer.current = null;
      activeAction.current = null;
      clipDuration.current = 0;
    };
  }, [vrm, vrmAnimation]);

  // 身長・足元・頭の位置を測って親へ渡す。ベースと借り物（服・髪）の位置合わせは
  // この値の差で決まるため、**必ず同じ姿勢で測らなければならない**。
  // モーション再生中の姿勢で測ると、借り物側（読み込み直後の静止姿勢で1回だけ測る）との
  // 間で基準がずれ、髪が頭から外れる・服が上下にドリフトする事故になる。
  // そのため (1) restポーズへ戻してから測り、(2) VRMごとに1回だけ走らせる。
  const measuredRef = useRef<VRM | null>(null);
  useEffect(() => {
    if (!vrm || measuredRef.current === vrm) return;
    measuredRef.current = vrm;

    // 計測中だけ素の姿勢に固定する。モーションは次のフレームで再評価されるので
    // 見た目には影響しないが、armDownはここで消えるため測ったあとに掛け直す。
    vrm.humanoid.resetNormalizedPose();
    vrm.humanoid.update();
    vrm.scene.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    const headNode = vrm.humanoid.getRawBoneNode("head");
    const headPosition = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;

    applyArmDownPose(vrm);
    vrm.humanoid.update();
    vrm.scene.updateMatrixWorld(true);

    if (!Number.isFinite(height) || height <= 0) return;
    onMeasured?.({
      height,
      minY: box.min.y,
      head: headPosition
        ? { x: headPosition.x, y: headPosition.y, z: headPosition.z }
        : null,
    });
  }, [vrm, onMeasured]);

  // v1の立ち絵に近いサイズ感（全身〜ふくらはぎ）になる位置を初期カメラとして計算し、
  // OrbitControlsの注視点として渡す。そのあとの拡大・回転・移動はユーザー操作に任せる。
  // モデルごとの身長差を吸収するため、固定距離ではなく実際の全身の高さから逆算する。
  // 「初回ロード時に一度だけ」が意図なので、こちらもVRMごとに1回に固定する
  const fittedCameraRef = useRef<VRM | null>(null);
  useEffect(() => {
    if (!vrm || !fitCamera || fittedCameraRef.current === vrm) return;
    fittedCameraRef.current = vrm;
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    const perspective = camera as THREE.PerspectiveCamera;
    const vFov = THREE.MathUtils.degToRad(perspective.fov);

    const visibleTop = box.max.y + height * 0.06;
    const visibleBottom = box.min.y + height * 0.06;
    const visibleHeight = visibleTop - visibleBottom;
    const lookY = (visibleTop + visibleBottom) / 2;
    const distance = fitDistance(visibleHeight, vFov);

    camera.position.set(centerX, lookY, centerZ + distance);
    camera.lookAt(centerX, lookY, centerZ);

    const controls = orbitControlsRef.current;
    if (controls) {
      controls.target.set(centerX, lookY, centerZ);
      controls.update();
      // これで「↺」ボタン(reset)がこの初期位置に戻るようになる
      controls.saveState();

      // ホームなど前の画面で動かしていた場合は、初期位置をreset用に保存したあとで
      // そのカメラ位置・注視点・ズームへ戻す。
      if (initialView) {
        const restoredTarget = new THREE.Vector3().fromArray(initialView.target);
        const restoredPosition = new THREE.Vector3().fromArray(initialView.cameraPosition);
        const cameraOffset = restoredPosition.clone().sub(restoredTarget);
        if (cameraOffset.length() < minCameraDistance) {
          if (cameraOffset.lengthSq() === 0) cameraOffset.set(0, 0, 1);
          cameraOffset.setLength(minCameraDistance);
          restoredPosition.copy(restoredTarget).add(cameraOffset);
        }
        camera.position.copy(restoredPosition);
        perspective.zoom = initialView.zoom;
        perspective.updateProjectionMatrix();
        controls.target.copy(restoredTarget);
        controls.update();
      }
    }
  }, [vrm, camera, fitCamera, initialView, minCameraDistance, orbitControlsRef]);

  useFrame((state, delta) => {
    if (!vrm) return;

    const pose = shyPose.current;
    // モーションの上に足した前フレーム分を一度外してから、今フレームの
    // AnimationMixerを評価する。これをしないと、静止時に回転が毎フレーム累積する。
    if (pose) clearShyPose(pose);

    if (mixer.current) {
      // 視差効果を減らす設定のときはモーションも止める（姿勢はそのまま維持）
      mixer.current.timeScale = reducedMotion ? 0 : 1;
      if (syncMotion && activeAction.current && clipDuration.current > 0) {
        activeAction.current.time = reducedMotion
          ? 0
          : state.clock.elapsedTime % clipDuration.current;
        mixer.current.update(0);
      } else {
        mixer.current.update(delta);
      }
    }

    if (pose) {
      const target = expression === "shy" ? 1 : 0;
      pose.weight = reducedMotion
        ? target
        : THREE.MathUtils.damp(pose.weight, target, 10, delta);
      const w = pose.weight;
      // 軽くうつむいて顔をそらし、目だけを下・反対側へ向ける照れ姿勢。
      applyBoneOffset(
        pose.head,
        THREE.MathUtils.degToRad(-9) * w,
        THREE.MathUtils.degToRad(3.5) * w,
        THREE.MathUtils.degToRad(-1.5) * w,
      );
      applyBoneOffset(
        pose.leftEye,
        THREE.MathUtils.degToRad(-7) * w,
        THREE.MathUtils.degToRad(-3) * w,
        0,
      );
      applyBoneOffset(
        pose.rightEye,
        THREE.MathUtils.degToRad(-7) * w,
        THREE.MathUtils.degToRad(-3) * w,
        0,
      );
    }

    const expr = vrm.expressionManager;
    if (expr) {
      // 切替時に表情がパッと飛ばないよう、各プリセットの値を短く補間する。
      for (const name of MOOD_PRESETS) {
        const target = EXPRESSIONS[expression].find(({ preset }) => preset === name)?.weight ?? 0;
        const value = reducedMotion
          ? target
          : THREE.MathUtils.damp(moodWeights.current[name], target, 14, delta);
        moodWeights.current[name] = value;
        expr.setValue(name, value);
      }

      // まばたきは気分の表情と独立して動かす
      const now = state.clock.elapsedTime * 1000;
      const b = blink.current;
      if (b.nextAt === 0) b.nextAt = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
      if (b.closingUntil === 0 && now >= b.nextAt) {
        b.closingUntil = now + BLINK_CLOSE_MS;
      }
      if (b.closingUntil > 0) {
        expr.setValue("blink", 1);
        if (now >= b.closingUntil) {
          b.closingUntil = 0;
          b.nextAt = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
        }
      } else {
        expr.setValue("blink", 0);
      }

      // 返事を書いているあいだ、口をぱくぱくさせる
      talkClock.current += delta;
      const aa = talking ? Math.max(0, Math.sin(talkClock.current * 14)) * 0.6 : 0;
      expr.setValue("aa", aa);
    }

    // normalizedボーンと表情を反映してから、スプリングボーン等を更新する。
    vrm.update(delta);

    // 呼吸とゆらぎ。視差効果を減らす設定のときは止める
    if (!reducedMotion) {
      const t = state.clock.elapsedTime;
      vrm.scene.position.x = modelOffsetX;
      vrm.scene.position.y = modelOffsetY + Math.sin(t * 1.5) * 0.006;
      vrm.scene.position.z = modelOffsetZ;
      vrm.scene.rotation.z = Math.sin(t * 0.85) * 0.006;
    } else {
      vrm.scene.position.x = modelOffsetX;
      vrm.scene.position.y = modelOffsetY;
      vrm.scene.position.z = modelOffsetZ;
      vrm.scene.rotation.z = 0;
    }

    // OrbitControlsのminDistanceは「注視点まで」の距離なので、2本指で位置を
    // ずらすと注視点ごと移動し、モーション中の頭へカメラが入り込めてしまう。
    // アニメーション後の実際の頭を基準に、どのズーム・回転・位置からでも
    // 頭の外側にカメラを押し戻す。表示を担当するベースVRMだけで行う。
    if (fitCamera) {
      const head = vrm.humanoid.getRawBoneNode("head");
      if (head) {
        vrm.scene.updateMatrixWorld(true);
        head.getWorldPosition(headWorldPosition.current);
        headCameraOffset.current.copy(camera.position).sub(headWorldPosition.current);
        if (headCameraOffset.current.lengthSq() < MIN_HEAD_CAMERA_DISTANCE ** 2) {
          if (headCameraOffset.current.lengthSq() === 0) {
            headCameraOffset.current.set(0, 0, 1);
          }
          headCameraOffset.current.setLength(MIN_HEAD_CAMERA_DISTANCE);
          camera.position.copy(headWorldPosition.current).add(headCameraOffset.current);
          orbitControlsRef.current?.update();
        }
      }
    }
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} scale={modelScale} />;
}
