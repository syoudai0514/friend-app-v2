"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useState, type RefObject } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { StageViewState } from "./stage-view";

interface LoadedModel {
  scene: THREE.Group;
  size: THREE.Vector3;
  target: THREE.Vector3;
}

function disposeScene(scene: THREE.Object3D): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry?.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

function GlbModel({
  url,
  initialView,
  orbitControlsRef,
  onReady,
  onError,
}: {
  url: string;
  initialView: StageViewState | null;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  onReady?: () => void;
  onError?: () => void;
}) {
  const { camera, size: viewportSize } = useThree();
  const [model, setModel] = useState<LoadedModel | null>(null);

  // GLBの読み込みはURLが変わったときだけ行う。画面回転やReact再描画のたびに
  // 56MB級モデルを読み直すとiPhoneで破綻するため、カメラ調整とは分離する。
  useEffect(() => {
    let cancelled = false;
    let loadedScene: THREE.Group | null = null;
    setModel(null);

    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        loadedScene = gltf.scene;
        if (cancelled) {
          disposeScene(gltf.scene);
          return;
        }

        // Tripoの高密度メッシュは初期境界から外れやすいため、描画省略を無効化する。
        gltf.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) object.frustumCulled = false;
        });

        // モデルの足元をY=0、左右と奥行きを原点中心に置く。
        const sourceBounds = new THREE.Box3().setFromObject(gltf.scene);
        const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
        gltf.scene.position.set(-sourceCenter.x, -sourceBounds.min.y, -sourceCenter.z);
        gltf.scene.updateMatrixWorld(true);

        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const modelSize = bounds.getSize(new THREE.Vector3());
        const modelCenter = bounds.getCenter(new THREE.Vector3());
        setModel({
          scene: gltf.scene,
          size: modelSize,
          target: new THREE.Vector3(0, modelCenter.y, 0),
        });
        onReady?.();
      },
      undefined,
      () => {
        if (!cancelled) onError?.();
      },
    );

    return () => {
      cancelled = true;
      if (loadedScene) disposeScene(loadedScene);
    };
  }, [onError, onReady, url]);

  // モデル自体は再読込せず、Canvasサイズが変わったときだけ全身が収まるよう再フィットする。
  useEffect(() => {
    if (!model) return;
    const controls = orbitControlsRef.current;
    const perspectiveCamera = camera as THREE.PerspectiveCamera;

    if (initialView) {
      camera.position.set(...initialView.cameraPosition);
      if (perspectiveCamera.isPerspectiveCamera) {
        perspectiveCamera.zoom = initialView.zoom;
        perspectiveCamera.updateProjectionMatrix();
      }
      controls?.target.set(...initialView.target);
    } else if (perspectiveCamera.isPerspectiveCamera) {
      const verticalFov = THREE.MathUtils.degToRad(perspectiveCamera.fov);
      const aspect = Math.max(viewportSize.width / Math.max(viewportSize.height, 1), 0.01);
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const distanceForHeight = (model.size.y * 0.56) / Math.tan(verticalFov / 2);
      const distanceForWidth = (model.size.x * 0.56) / Math.tan(horizontalFov / 2);
      const distance = Math.max(distanceForHeight, distanceForWidth, model.size.z * 1.5, 0.5);

      camera.position.set(0, model.target.y, distance);
      controls?.target.copy(model.target);
    }

    camera.lookAt(controls?.target ?? model.target);
    controls?.update();
    controls?.saveState();
  }, [camera, initialView, model, orbitControlsRef, viewportSize.height, viewportSize.width]);

  return model ? <primitive object={model.scene} /> : null;
}

/**
 * VRMではない通常のglTF/GLBを表示するPoC用Canvas。
 * 現時点では骨・表情・口パクを持たない静止3Dとして扱い、OrbitControlsで
 * 実際のアプリ画面に置いたときの見た目とiPhone負荷を先に検証する。
 */
export function GlbCanvas({
  url,
  initialView = null,
  onViewChange,
  orbitControlsRef,
  onReady,
  onError,
}: {
  url: string;
  initialView?: StageViewState | null;
  onViewChange?: (view: StageViewState) => void;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  onReady?: () => void;
  onError?: () => void;
}) {
  const [canvasKey, setCanvasKey] = useState(0);
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
      camera={{ fov: 28, near: 0.01, far: 50 }}
      // 約100万頂点のTripoモデルをまずそのまま試すため、VRMより少し低い上限に抑える。
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.domElement.addEventListener(
          "webglcontextlost",
          (event: Event) => {
            event.preventDefault();
            setCanvasKey((key) => key + 1);
          },
          { once: true },
        );
      }}
    >
      <ambientLight intensity={1.25} />
      <directionalLight position={[1.2, 2.2, 2.5]} intensity={1.35} />
      <directionalLight position={[-1.5, 1.2, -1]} intensity={0.35} />
      <GlbModel
        url={url}
        initialView={initialView}
        orbitControlsRef={orbitControlsRef}
        onReady={onReady}
        onError={onError}
      />
      <OrbitControls
        ref={orbitControlsRef}
        onChange={rememberView}
        enableDamping
        dampingFactor={0.15}
        minDistance={0.15}
        maxDistance={12}
        minPolarAngle={0.05}
        maxPolarAngle={Math.PI * 0.68}
      />
    </Canvas>
  );
}
