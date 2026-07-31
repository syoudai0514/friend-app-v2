"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { EXPRESSIONS, type Expression } from "@/lib/expressions";
import { useVrm } from "./useVrm";
import type { CharacterView } from "./view";

/** 気分の表情プリセット。まばたき(blink*)や口の形(aa)とは別に、毎フレーム一度リセットしてから適用する */
const MOOD_PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral"];

/** v1のまばたき間隔・閉眼時間に合わせる */
const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;

/**
 * 「気をつけ」の直立ではなく、少し甘えたような雰囲気にするための
 * 姿勢の上乗せ（度数、モデル自身の基本姿勢に加算する）。
 * 見え方はモデルのボーン構成次第で変わるので、実物を見ながら調整する前提の初期値
 */
const IDLE_POSE_OFFSET_DEG: Partial<Record<VRMHumanBoneName, [number, number, number]>> = {
  head: [3, 6, 5],
  neck: [2, 0, 2],
  chest: [4, 0, 0],
  leftUpperArm: [10, 0, -12],
  rightUpperArm: [10, 0, 12],
  leftLowerArm: [0, 0, -18],
  rightLowerArm: [0, 0, 18],
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 全身が収まるカメラ距離を、実際の身長(height)とカメラの垂直画角から逆算する */
function fitDistance(visibleHeight: number, verticalFovRad: number): number {
  return visibleHeight / 2 / Math.tan(verticalFovRad / 2);
}

export function VrmModel({
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
  const { vrm, error } = useVrm(url);
  const { camera } = useThree();
  const blink = useRef({ nextAt: 0, closingUntil: 0 });
  const talkClock = useRef(0);

  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

  // 「気をつけ」で立っているだけに見えないよう、腕・首・胸に軽く姿勢を足す。
  // モデル自身の基本姿勢に対する上乗せ（差分）として掛けるので、
  // 元のポーズがどんな角度で書き出されていても崩れにくい
  useEffect(() => {
    if (!vrm) return;
    const humanoid = vrm.humanoid;
    for (const [name, [x, y, z]] of Object.entries(IDLE_POSE_OFFSET_DEG) as [
      VRMHumanBoneName,
      [number, number, number],
    ][]) {
      const node = humanoid.getNormalizedBoneNode(name);
      if (!node) continue;
      const offset = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          THREE.MathUtils.degToRad(x),
          THREE.MathUtils.degToRad(y),
          THREE.MathUtils.degToRad(z),
        ),
      );
      node.quaternion.multiply(offset);
    }
  }, [vrm]);

  // v1の立ち絵に近いサイズ感（全身〜ふくらはぎ）を基準に、タップで
  // 見上げ／背面などの視点にも切り替えられるようにする。
  // モデルごとの身長差を吸収するため、固定距離ではなく実際の全身の高さから逆算する
  useEffect(() => {
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    const perspective = camera as THREE.PerspectiveCamera;
    const vFov = THREE.MathUtils.degToRad(perspective.fov);

    if (view === "low") {
      // 足元近くから、顔のあたりを見上げる
      const lookY = box.min.y + height * 0.82;
      const distance = fitDistance(height * 0.62, vFov);
      camera.position.set(centerX, box.min.y + height * 0.04, centerZ + distance * 0.8);
      camera.lookAt(centerX, lookY, centerZ);
      return;
    }

    // front（全身）・back（背面）は同じ画角で、Zの正負だけを反転させる
    const visibleTop = box.max.y + height * 0.06;
    const visibleBottom = box.min.y + height * 0.06;
    const visibleHeight = visibleTop - visibleBottom;
    const lookY = (visibleTop + visibleBottom) / 2;
    const distance = fitDistance(visibleHeight, vFov);
    const side = view === "back" ? -1 : 1;

    camera.position.set(centerX, lookY, centerZ + distance * side);
    camera.lookAt(centerX, lookY, centerZ);
  }, [vrm, camera, view]);

  useFrame((state, delta) => {
    if (!vrm) return;
    vrm.update(delta);

    const expr = vrm.expressionManager;
    if (expr) {
      for (const name of MOOD_PRESETS) expr.setValue(name, 0);
      for (const { preset, weight } of EXPRESSIONS[expression]) {
        expr.setValue(preset, weight);
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

    // 呼吸とゆらぎ。視差効果を減らす設定のときは止める
    if (!reducedMotion) {
      const t = state.clock.elapsedTime;
      vrm.scene.position.y = Math.sin(t * 1.5) * 0.006;
      vrm.scene.rotation.z = Math.sin(t * 0.85) * 0.006;
    } else {
      vrm.scene.position.y = 0;
      vrm.scene.rotation.z = 0;
    }
  });

  if (!vrm) return null;
  return <primitive object={vrm.scene} />;
}
