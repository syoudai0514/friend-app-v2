"use client";

import { useEffect, useState } from "react";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMAnimationLoaderPlugin, type VRMAnimation } from "@pixiv/three-vrm-animation";

interface UseVrmaResult {
  vrmAnimation: VRMAnimation | null;
}

/** VRMA（骨格アニメーション）を1本読み込む。読み込めなければ静かに諦める（静止ポーズにフォールバック） */
export function useVrma(url: string | null): UseVrmaResult {
  const [vrmAnimation, setVrmAnimation] = useState<VRMAnimation | null>(null);

  useEffect(() => {
    if (!url) {
      setVrmAnimation(null);
      return;
    }

    let cancelled = false;
    setVrmAnimation(null);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const animations = gltf.userData.vrmAnimations as VRMAnimation[] | undefined;
        setVrmAnimation(animations?.[0] ?? null);
      },
      undefined,
      () => {
        // モーションが無い・壊れているのはVRM本体ほど致命的ではないので、
        // エラー扱いにはせず静止ポーズのままにする
        if (!cancelled) setVrmAnimation(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { vrmAnimation };
}
