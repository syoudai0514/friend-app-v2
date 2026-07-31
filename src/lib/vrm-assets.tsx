/** キャラの見た目まわりのファイルURLを組み立てる */

export function vrmUrl(personaId: string, variantId: string): string {
  return `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(variantId)}.vrm`;
}

export function posterUrl(personaId: string, variantId: string): string {
  return `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(variantId)}.poster.webp`;
}
