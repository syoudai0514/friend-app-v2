"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";
import { createVRMAnimationClip } from "@pixiv/three-vrm-animation";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { EXPRESSIONS, type Expression } from "@/lib/expressions";
import { performanceRuntime } from "@/lib/performance";
import type { ModelPerformanceIntent } from "@/lib/types";
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

const BLINK_MIN_MS = 2600;
const BLINK_MAX_MS = 6200;
const BLINK_CLOSE_MS = 130;
const MIN_HEAD_CAMERA_DISTANCE = 0.45;

export interface ModelBounds {
  height: number;
  minY: number;
  head: { x: number; y: number; z: number } | null;
}

export type VrmMaterialMode = "full" | "bodyAndClothes" | "onlyClothes" | "onlyHair";

function isClothingMaterial(material: THREE.Material): boolean {
  return /_CLOTH(?:_| \(|$)/.test(material.name);
}

function isHairMaterial(material: THREE.Material): boolean {
  return /_HAIR(?:_| \(|$)/.test(material.name);
}

function isBodyMaterial(material: THREE.Material): boolean {
  return /Body_00_SKIN/.test(material.name);
}

function bodyGeometryWithoutHead(
  mesh: THREE.SkinnedMesh,
  head: THREE.Object3D,
): THREE.BufferGeometry | null {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!position || !skinIndex || !skinWeight) return null;

  const headBoneIndices = new Set<number>();
  head.traverse((node) => {
    const boneIndex = mesh.skeleton.bones.indexOf(node as THREE.Bone);
    if (boneIndex >= 0) headBoneIndices.add(boneIndex);
  });
  if (headBoneIndices.size === 0) return null;

  const belongsToHead = new Uint8Array(position.count);
  let matchingVertices = 0;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    let headWeight = 0;
    for (let slot = 0; slot < 4; slot += 1) {
      if (headBoneIndices.has(skinIndex.getComponent(vertex, slot))) {
        headWeight += skinWeight.getComponent(vertex, slot);
      }
    }
    if (headWeight >= 0.35) {
      belongsToHead[vertex] = 1;
      matchingVertices += 1;
    }
  }
  if (matchingVertices === 0) return null;

  const sourceIndex = geometry.index;
  const sourceCount = sourceIndex?.count ?? position.count;
  const indexAt = (offset: number) => (sourceIndex ? sourceIndex.getX(offset) : offset);
  const sourceGroups =
    geometry.groups.length > 0
      ? geometry.groups
      : [{ start: 0, count: sourceCount, materialIndex: 0 }];
  const ranges = new Map<string, { start: number; count: number }>();
  const indices: number[] = [];

  for (const group of sourceGroups) {
    const key = `${group.start}:${group.count}`;
    if (ranges.has(key)) continue;
    const start = indices.length;
    const end = Math.min(group.start + group.count, sourceCount);
    for (let offset = group.start; offset + 2 < end; offset += 3) {
      const a = indexAt(offset);
      const b = indexAt(offset + 1);
      const c = indexAt(offset + 2);
      if (belongsToHead[a] || belongsToHead[b] || belongsToHead[c]) continue;
      indices.push(a, b, c);
    }
    ranges.set(key, { start, count: indices.length - start });
  }

  const filtered = geometry.clone();
  filtered.setIndex(indices);
  filtered.clearGroups();
  for (const group of sourceGroups) {
    const range = ranges.get(`${group.start}:${group.count}`);
    if (range) filtered.addGroup(range.start, range.count, group.materialIndex);
  }
  filtered.computeBoundingBox();
  filtered.computeBoundingSphere();
  return filtered;
}

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

function fitDistance(visibleHeight: number, verticalFovRad: number): number {
  return visibleHeight / 2 / Math.tan(verticalFovRad / 2);
}

export function VrmModel({
  url,
  motionUrl,
  expression,
  talking,
  lipSync,
  performance,
  reducedMotion,
  orbitControlsRef,
  materialMode = "full",
  hideClothes = false,
  hideBody = false,
  hideHair = false,
  irisTextureUrl = null,
  browsTextureUrl = null,
  mouthTextureUrl = null,
  bodySkinColor = null,
  bodySkinSourceColor = null,
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
  lipSync: number;
  performance?: Partial<ModelPerformanceIntent>;
  reducedMotion: boolean;
  orbitControlsRef: RefObject<OrbitControlsImpl | null>;
  materialMode?: VrmMaterialMode;
  hideClothes?: boolean;
  hideBody?: boolean;
  hideHair?: boolean;
  irisTextureUrl?: string | null;
  browsTextureUrl?: string | null;
  mouthTextureUrl?: string | null;
  bodySkinColor?: string | null;
  bodySkinSourceColor?: string | null;
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
  const mixer = useRef<THREE.AnimationMixer | null>(null);
  const activeAction = useRef<THREE.AnimationAction | null>(null);
  const clipDuration = useRef(0);
  const moodWeights = useRef(initialMoodWeights());
  const shyPose = useRef<ShyPose | null>(null);
  const headWorldPosition = useRef(new THREE.Vector3());
  const headCameraOffset = useRef(new THREE.Vector3());
  const performanceStartedAt = useRef(0);

  useEffect(() => {
    performanceStartedAt.current = window.performance.now();
  }, [expression, performance]);

  useEffect(() => {
    if (error) onError?.();
  }, [error, onError]);

  useEffect(() => {
    if (!vrm) return;
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        const clothing = isClothingMaterial(material);
        const body = isBodyMaterial(material);
        const hair = isHairMaterial(material);
        if (materialMode === "bodyAndClothes") {
          material.visible = body || clothing;
        } else if (materialMode === "onlyClothes") {
          material.visible = clothing;
        } else if (materialMode === "onlyHair") {
          material.visible = hair;
        } else {
          material.visible =
            !(hideClothes && clothing) && !(hideBody && body) && !(hideHair && hair);
        }
      }
    });
  }, [hideBody, hideClothes, hideHair, materialMode, vrm]);

  useEffect(() => {
    if (!vrm || materialMode !== "bodyAndClothes") return;
    const head = vrm.humanoid.getRawBoneNode("head");
    if (!head) return;

    const replacements: Array<{
      mesh: THREE.SkinnedMesh;
      original: THREE.BufferGeometry;
      filtered: THREE.BufferGeometry;
    }> = [];
    vrm.scene.traverse((obj) => {
      if (!(obj instanceof THREE.SkinnedMesh)) return;
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (!materials.some(isBodyMaterial)) return;
      const filtered = bodyGeometryWithoutHead(obj, head);
      if (!filtered) return;
      replacements.push({ mesh: obj, original: obj.geometry, filtered });
      obj.geometry = filtered;
    });

    return () => {
      for (const { mesh, original, filtered } of replacements) {
        mesh.geometry = original;
        filtered.dispose();
      }
    };
  }, [materialMode, vrm]);

  useEffect(() => {
    if (vrm) onReady?.();
  }, [vrm, onReady]);

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
        if (!isBodyMaterial(material) || !hasTextureMap(material) || !material.map) continue;
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

  useEffect(() => {
    if (!vrm) return;
    const humanoid = vrm.humanoid;
    const armDown = Math.PI * 0.42;
    const leftUpperArm = humanoid.getNormalizedBoneNode("leftUpperArm");
    const rightUpperArm = humanoid.getNormalizedBoneNode("rightUpperArm");
    if (leftUpperArm) leftUpperArm.rotation.z = armDown;
    if (rightUpperArm) rightUpperArm.rotation.z = -armDown;
  }, [vrm]);

  useEffect(() => {
    if (!vrm || !vrmAnimation) {
      mixer.current = null;
      activeAction.current = null;
      clipDuration.current = 0;
      return;
    }
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    const animationMixer = new THREE.AnimationMixer(vrm.scene);
    const action = animationMixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
    const onLoop = () => vrm.springBoneManager?.reset();
    animationMixer.addEventListener("loop", onLoop);

    mixer.current = animationMixer;
    activeAction.current = action;
    clipDuration.current = clip.duration;
    return () => {
      animationMixer.removeEventListener("loop", onLoop);
      animationMixer.stopAllAction();
      mixer.current = null;
      activeAction.current = null;
      clipDuration.current = 0;
    };
  }, [vrm, vrmAnimation]);

  useEffect(() => {
    if (!vrm) return;
    vrm.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const height = box.max.y - box.min.y;
    if (!Number.isFinite(height) || height <= 0) return;

    const headNode = vrm.humanoid.getRawBoneNode("head");
    const headPosition = headNode ? headNode.getWorldPosition(new THREE.Vector3()) : null;
    onMeasured?.({
      height,
      minY: box.min.y,
      head: headPosition
        ? { x: headPosition.x, y: headPosition.y, z: headPosition.z }
        : null,
    });
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
      controls.saveState();
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
  }, [vrm, camera, fitCamera, initialView, minCameraDistance, onMeasured, orbitControlsRef]);

  useFrame((frameState, delta) => {
    if (!vrm) return;

    const cueElapsedSeconds = reducedMotion
      ? Number.POSITIVE_INFINITY
      : Math.max(0, (window.performance.now() - performanceStartedAt.current) / 1000);
    const runtimePerformance = performanceRuntime(
      { expression, ...performance },
      cueElapsedSeconds,
    );

    const pose = shyPose.current;
    // ownership: 前フレームのsemantic overlayを外す → VRMA base motion → 今フレームoverlay。
    if (pose) clearShyPose(pose);

    if (mixer.current) {
      mixer.current.timeScale = reducedMotion ? 0 : 1;
      if (syncMotion && activeAction.current && clipDuration.current > 0) {
        activeAction.current.time = reducedMotion
          ? 0
          : frameState.clock.elapsedTime % clipDuration.current;
        mixer.current.update(0);
      } else {
        mixer.current.update(delta);
      }
    }

    if (pose) {
      const target = [...runtimePerformance.head, ...runtimePerformance.eyes].some(
        (value) => Math.abs(value) > 0.001,
      )
        ? 1
        : 0;
      pose.weight = reducedMotion
        ? target
        : THREE.MathUtils.damp(pose.weight, target, 10, delta);
      const weight = pose.weight;
      applyBoneOffset(
        pose.head,
        THREE.MathUtils.degToRad(runtimePerformance.head[0]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.head[1]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.head[2]) * weight,
      );
      applyBoneOffset(
        pose.leftEye,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[0]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[1]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[2]) * weight,
      );
      applyBoneOffset(
        pose.rightEye,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[0]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[1]) * weight,
        THREE.MathUtils.degToRad(runtimePerformance.eyes[2]) * weight,
      );
    }

    const expressionManager = vrm.expressionManager;
    if (expressionManager) {
      // expression morph ownership。semantic intensityは0..1にclamp済み。
      for (const name of MOOD_PRESETS) {
        const presetWeight =
          EXPRESSIONS[expression].find(({ preset }) => preset === name)?.weight ?? 0;
        const target = presetWeight * runtimePerformance.intensity;
        const value = reducedMotion
          ? target
          : THREE.MathUtils.damp(moodWeights.current[name], target, 14, delta);
        moodWeights.current[name] = value;
        expressionManager.setValue(name, value);
      }

      const now = frameState.clock.elapsedTime * 1000;
      const blinkState = blink.current;
      if (blinkState.nextAt === 0) {
        blinkState.nextAt = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
      }
      if (blinkState.closingUntil === 0 && now >= blinkState.nextAt) {
        blinkState.closingUntil = now + BLINK_CLOSE_MS;
      }
      if (blinkState.closingUntil > 0) {
        expressionManager.setValue("blink", 1);
        if (now >= blinkState.closingUntil) {
          blinkState.closingUntil = 0;
          blinkState.nextAt = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
        }
      } else {
        expressionManager.setValue("blink", 0);
      }

      // lip morph ownershipは最後。generation/busyではなくactual audio playingだけ。
      expressionManager.setValue(
        "aa",
        talking ? THREE.MathUtils.clamp(lipSync, 0, 1) * 0.72 : 0,
      );
    }

    vrm.update(delta);

    if (!reducedMotion) {
      const time = frameState.clock.elapsedTime;
      vrm.scene.position.x = modelOffsetX;
      vrm.scene.position.y = modelOffsetY + Math.sin(time * 1.5) * 0.006;
      vrm.scene.position.z = modelOffsetZ;
      vrm.scene.rotation.z = Math.sin(time * 0.85) * 0.006;
    } else {
      vrm.scene.position.x = modelOffsetX;
      vrm.scene.position.y = modelOffsetY;
      vrm.scene.position.z = modelOffsetZ;
      vrm.scene.rotation.z = 0;
    }

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
