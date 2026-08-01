import type { PartOption } from "./types";

/**
 * public/vrm/<personaId>/*.vrm を元にした、キャラごとのバリアント一覧。
 * このファイルは自動生成されています。直接編集しないでください。
 * 生成元: scripts/generate-vrm-manifest.mjs（npm run dev / build の前に走ります）
 */
export const VRM_MANIFEST: Record<string, PartOption[]> = {
  "aimi": [
    {
      "id": "knit",
      "name": "オフショルニット",
      "rarity": "NR"
    },
    {
      "id": "shirt",
      "name": "腰巻きギャル",
      "rarity": "NR"
    },
    {
      "id": "swimsuit",
      "name": "ドレス",
      "rarity": "NR"
    }
  ],
  "shizuku": [
    {
      "id": "casual",
      "name": "私服",
      "rarity": "NR"
    }
  ]
};

/**
 * 指定キャラのバリアント一覧。まだ1つもVRMを置いていないキャラでは、
 * 今えらんでいるIDだけをそのまま選択肢にして、クローゼットが空にならないようにする
 */
export function variantsFor(personaId: string, currentVariantId: string): PartOption[] {
  const known = VRM_MANIFEST[personaId];
  if (known && known.length > 0) return known;
  return [{ id: currentVariantId, name: "スタンダード", rarity: "NR" }];
}
