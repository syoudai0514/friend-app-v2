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

/** v1のまばたき間隔・閉眼時間に合わせる */
const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;

export interface ModelBounds {
  height: number;
  minY: number;
}

export type VrmVisibilityMode = "full" | "base" | "clothes";

function isClothingMaterial(material: THREE.Material): boolean {
  return /_CLOTH(?:_| \(|$)/.test(material.name);
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
  visibilityMode = "full",
  fitCamera = true,
  syncMotion = false,
  modelScale = 1,
  modelOffsetY = 0,
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
  visibilityMode?: VrmVisibilityMode;
  fitCamera?: boolean;
  syncMotion?: boolean;
  modelScale?: number;
  modelOffsetY?: number;
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

  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

  // VRoidのマテリアル名にある _CLOTH を境界として、ベースの服を消したり
  // 服だけを残したりする。アウトライン材も元の名前を含むので同じ判定で揃う。
  useEffect(() => {
    if (!vrm) return;
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        const clothing = isClothingMaterial(material);
        material.visible =
          visibilityMode === "full" ||
          (visibilityMode === "base" && !clothing) ||
          (visibilityMode === "clothes" && clothing);
      }
    });
  }, [vrm, visibilityMode]);

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
    const humanoid = vrm.humanoid;
    const armDown = Math.PI * 0.42;
    const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftUpperArm) leftUpperArm.rotation.z = armDown;
    if (rightUpperArm) rightUpperArm.rotation.z = -armDown;
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

  // v1の立ち絵に近いサイズ感（全身〜ふくらはぎ）になる位置を初期カメラとして計算し、
  // OrbitControlsの注視点として渡す。そのあとの拡大・回転・移動はユーザー操作に任せる。
  // モデルごとの身長差を吸収するため、固定距離ではなく実際の全身の高さから逆算する
  useEffect(() => {
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    onMeasured?.({ height, minY: box.min.y });
    if (!fitCamera) return;

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
    }
  }, [vrm, camera, fitCamera, onMeasured, orbitControlsRef]);

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
      vrm.scene.position.y = modelOffsetY + Math.sin(t * 1.5) * 0.006;
      vrm.scene.rotation.z = Math.sin(t * 0.85) * 0.006;
    } else {
      vrm.scene.position.y = modelOffsetY;
      vrm.scene.rotation.z = 0;
    }
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} scale={modelScale} />;
}
