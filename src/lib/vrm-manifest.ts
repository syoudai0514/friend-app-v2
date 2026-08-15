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
  "nagi": [
    {
      "id": "default",
      "name": "スタンダード",
      "rarity": "NR"
    }
  ],
  "rena": [
    {
      "id": "casual",
      "name": "私服",
      "rarity": "NR"
    },
    {
      "id": "default",
      "name": "スタンダード",
      "rarity": "NR"
    },
    {
      "id": "work",
      "name": "仕事着",
      "rarity": "NR"
    }
  ],
  "shizuku": [
    {
      "id": "cardigan",
      "name": "戦闘着1",
      "rarity": "NR"
    },
    {
      "id": "casual",
      "name": "私服",
      "rarity": "NR"
    },
    {
      "id": "fftifa",
      "name": "FFVティファ",
      "rarity": "NR"
    },
    {
      "id": "gunshorts",
      "name": "ショーパン",
      "rarity": "NR"
    },
    {
      "id": "knit",
      "name": "長袖ニット",
      "rarity": "NR"
    },
    {
      "id": "leather",
      "name": "黒レザードレス",
      "rarity": "NR"
    },
    {
      "id": "onepiece",
      "name": "ワンピース",
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
