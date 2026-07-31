"use client";

import { useEffect, useState } from "react";
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
