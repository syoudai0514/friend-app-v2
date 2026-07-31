"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { EXPRESSIONS, type Expression } from "@/lib/expressions";
import { useVrm } from "./useVrm";

/** 気分の表情プリセット。まばたき(blink*)や口の形(aa)とは別に、毎フレーム一度リセットしてから適用する */
const MOOD_PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral"];

/** v1のまばたき間隔・閉眼時間に合わせる */
const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function VrmModel({
  url,
  expression,
  talking,
  reducedMotion,
  onReady,
  onError,
}: {
  url: string;
  expression: Expression;
  talking: boolean;
  reducedMotion: boolean;
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

  // v1の立ち絵と同じく、頭からふくらはぎまで見える全身に近いサイズで映す。
  // モデルごとの身長差を吸収するため、固定距離ではなく実際の全身の高さから
  // カメラを引く距離を逆算する
  useEffect(() => {
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    const centerX = (box.min.x + box.max.x) / 2;
    const centerZ = (box.min.z + box.max.z) / 2;
    // 頭上に少し余白を残しつつ、足首より少し上までを画面に収める
    const visibleTop = box.max.y + height * 0.06;
    const visibleBottom = box.min.y + height * 0.06;
    const visibleHeight = visibleTop - visibleBottom;
    const lookY = (visibleTop + visibleBottom) / 2;

    const perspective = camera as THREE.PerspectiveCamera;
    const vFov = THREE.MathUtils.degToRad(perspective.fov);
    const distance = visibleHeight / 2 / Math.tan(vFov / 2);

    camera.position.set(centerX, lookY, centerZ + distance);
    camera.lookAt(centerX, lookY, centerZ);
  }, [vrm, camera]);

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
