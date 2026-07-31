/** キャラの見た目まわりのファイルURLを組み立てる */

export function vrmUrl(personaId: string, variantId: string): string {
  return `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(variantId)}.vrm`;
}

export function posterUrl(personaId: string, variantId: string): string {
  return `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(variantId)}.poster.webp`;
}

/** モーションはキャラ非依存。どのVRMにも同じ人型ボーン名でリターゲットして使う */
export function vrmaUrl(motionId: string): string {
  return `/vrma/${encodeURIComponent(motionId)}.vrma`;
}
