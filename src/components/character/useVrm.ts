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

/** three-vrm が生成する MToon マテリアルのうち、肌の艶に使う部分だけを表した型 */
type SkinMToonMaterial = THREE.Material & {
  isMToonMaterial: true;
  parametricRimColorFactor: THREE.Color;
  rimLightingMixFactor: number;
  parametricRimFresnelPowerFactor: number;
  parametricRimLiftFactor: number;
};

function isSkinMToonMaterial(material: THREE.Material): material is SkinMToonMaterial {
  return (
    (material as { isMToonMaterial?: boolean }).isMToonMaterial === true &&
    /_SKIN(?: \(Instance\))?$/.test(material.name)
  );
}

/**
 * VRoid 側のテクスチャはそのままに、アプリの照明を受ける暖色のリム光を足す。
 * 顔は控えめ、脚を含む Body は少し強めにして、テカりではなく自然な艶に見せる。
 */
function addSkinSheen(material: SkinMToonMaterial): void {
  const isFace = /Face_00_SKIN/.test(material.name);
  material.parametricRimColorFactor.setRGB(
    isFace ? 0.055 : 0.12,
    isFace ? 0.025 : 0.055,
    isFace ? 0.018 : 0.035,
  );
  material.parametricRimFresnelPowerFactor = isFace ? 5 : 3;
  material.parametricRimLiftFactor = isFace ? 0.02 : 0.05;
  material.rimLightingMixFactor = 0.75;
  material.needsUpdate = true;
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
        // VRM0.0（VRoidの旧エクスポート設定など）はモデルの正面が180度逆。
        // VRM1.0との混在を前提にしているため、読み込み時に一度だけ揃える
        if (loaded.meta?.metaVersion === "0") {
          VRMUtils.rotateVRM0(loaded);
        }

        // 読み込み時に顔・目・髪の描画方法を一度決め、以後は角度や姿勢に
        // 左右されないよう固定する。これらは片面描画のことが多く、自由に
        // 回せるカメラで裏側に回り込むと顔だけ消えて見えるため両面描画にする。
        // 服（_CLOTH）は元々VRoidの書き出し時点で必要な面は両面設定済みなので触らない
        // ——ここまで一律で両面化していたら、しゃがみ姿勢で服の折り返り部分の裏側
        // （本来見える想定のない面）まで見えてしまう副作用が出たため、対象を絞った
        gltf.scene.traverse((obj) => {
          if (!(obj instanceof THREE.Mesh)) return;
          // 初期姿勢の境界で描画省略すると、モーションで大きく動いた顔・髪・身体が
          // 画面内でも消えるため、VRMメッシュは常に描画候補に残す。
          obj.frustumCulled = false;
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of materials) {
            if ((mat as { isOutline?: boolean }).isOutline) continue;
            // GLTFLoader が名前の末尾に付けることがある " (Instance)" も許容する。
            if (
              /_(HAIR|FACE|EYE)(?: \(Instance\))?$/.test(mat.name) ||
              /Face_00_SKIN(?: \(Instance\))?$/.test(mat.name)
            ) {
              mat.side = THREE.DoubleSide;
              mat.needsUpdate = true;
            }
            if (isSkinMToonMaterial(mat)) addSkinSheen(mat);
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
