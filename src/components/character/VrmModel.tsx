"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { EXPRESSIONS, type Expression } from "@/lib/expressions";
import { useVrm } from "./useVrm";
import { useVrma } from "./useVrma";

/** 気分の表情プリセット。まばたき(blink*)や口の形(aa)とは別に、毎フレーム一度リセットしてから適用する */
const MOOD_PRESETS = ["happy", "angry", "sad", "relaxed", "surprised", "neutral"];

/** v1のまばたき間隔・閉眼時間に合わせる */
const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;

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
  const { vrm, error } = useVrm(url);
  const { vrmAnimation } = useVrma(motionUrl);
  const { camera } = useThree();
  const blink = useRef({ nextAt: 0, closingUntil: 0 });
  const talkClock = useRef(0);
  const mixer = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

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
      return;
    }
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    const m = new THREE.AnimationMixer(vrm.scene);
    m.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();

    // ループの継ぎ目でポーズが不連続に飛ぶと、髪などのスプリングボーン物理が
    // その勢いを拾って一瞬暴れることがある。ループのたびに物理状態を
    // 今の姿勢でリセットして、暴れを引きずらないようにする
    const onLoop = () => vrm.springBoneManager?.reset();
    m.addEventListener("loop", onLoop);

    mixer.current = m;
    return () => {
      m.removeEventListener("loop", onLoop);
      m.stopAllAction();
      mixer.current = null;
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
  }, [vrm, camera, orbitControlsRef]);

  useFrame((state, delta) => {
    if (!vrm) return;

    if (mixer.current) {
      // 視差効果を減らす設定のときはモーションも止める（姿勢はそのまま維持）
      mixer.current.timeScale = reducedMotion ? 0 : 1;
      mixer.current.update(delta);
    }
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
