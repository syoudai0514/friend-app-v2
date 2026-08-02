import { SCENE } from "./catalog";

const sceneIds = new Set(SCENE.map((scene) => scene.id));

/** 選択値が壊れていても、必ず存在する背景へ戻す。 */
export function backgroundUrl(sceneId: string): string {
  const safeSceneId = sceneIds.has(sceneId) ? sceneId : "room";
  return `/backgrounds/${safeSceneId}.webp`;
}
