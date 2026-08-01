"use client";

import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

interface UseVrmResult {
  vrm: VRM | null;
  loading: boolean;
  error: boolean;
}

/**
 * VRMを1体読み込む。urlが変わるたびに読み直し、
 * 前のVRMは確実にdispose（GPUメモリ解放）してから次を読む
 */
export function useVrm(url: string | null): UseVrmResult {
  const [vrm, setVrm] = useState<VRM | null>(null);
  const [loading, setLoading] = useState(url !== null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) {
      setVrm(null);
      setLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    setVrm(null);
    setLoading(true);
    setError(false);

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return;
        const loaded = gltf.userData.vrm as VRM | undefined;
        if (!loaded) {
          setError(true);
          setLoading(false);
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);

        // 髪・顔のパーツ（VRoidの命名規則で名前の末尾が _HAIR / _FACE）は
        // 片面描画のことが多く、自由に回せるカメラで裏側に回り込むと消えて見える。
        // この2カテゴリだけ両面描画にする。
        // 服（_CLOTH）は元々VRoidの書き出し時点で必要な面は両面設定済みなので触らない
        // ——ここまで一律で両面化していたら、しゃがみ姿勢で服の折り返り部分の裏側
        // （本来見える想定のない面）まで見えてしまう副作用が出たため、対象を絞った
        gltf.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of materials) {
            if ((mat as { isOutline?: boolean }).isOutline) continue;
            if (!/_(HAIR|FACE)$/.test(mat.name)) continue;
            mat.side = THREE.DoubleSide;
          }
        });

        setVrm(loaded);
        setLoading(false);
      },
      undefined,
      () => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [url]);

  // 読み込んだVRMは、次のVRMに切り替わる・アンマウントされるときに必ず解放する
  useEffect(() => {
    if (!vrm) return;
    return () => {
      VRMUtils.deepDispose(vrm.scene);
    };
  }, [vrm]);

  return { vrm, loading, error };
}
