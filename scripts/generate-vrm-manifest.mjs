import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * public/vrm/<personaId>/*.vrm を探して、キャラごとのバリアント一覧を書き出す。
 *
 * 実行時にフォルダを読む方式だと、Vercel のようなサーバーレス環境で
 * public/ が関数から見えず、選択肢が出ないことがある。
 * ビルド前にここで一覧を固めてしまえば、どこに置いても確実に表示できる。
 *
 * VRM本体・poster画像・VRMAモーションは今までどおり public/ から静的配信されるので、
 * ここで書き出すのは「どのバリアントがあるか」だけ。
 */

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const OUT_FILE = path.join(ROOT, "src", "lib", "vrm-manifest.ts");

/**
 * クローゼットに出す表示名。ファイル名（variantId）とは別に、
 * 見せたい名前をここで上書きできる。無ければファイル名をそのまま使う
 */
const DISPLAY_NAMES = {
  aimi: {
    swimsuit: "ドレス",
    shirt: "腰巻きギャル",
    knit: "オフショルニット",
  },
  shizuku: {
    casual: "私服",
    knit: "長袖ニット",
    leather: "黒レザードレス",
    fftifa: "FFVティファ",
    onepiece: "ワンピース",
    cardigan: "戦闘着1",
    gunshorts: "ショーパン",
  },
  nagi: {
    default: "スタンダード",
  },
  rena: {
    default: "スタンダード",
    work: "仕事着",
    casual: "私服",
  },
};

async function variantIdsIn(personaId) {
  try {
    const entries = await readdir(path.join(PUBLIC_DIR, "vrm", personaId), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".vrm"))
      .map((e) => path.basename(e.name, path.extname(e.name)))
      .sort();
  } catch {
    // フォルダが無いのは正常（まだVRMを置いていないだけ）
    return [];
  }
}

async function build() {
  const manifest = {};
  let personaDirs;
  try {
    personaDirs = await readdir(path.join(PUBLIC_DIR, "vrm"), { withFileTypes: true });
  } catch {
    // vrm フォルダ自体が無い場合もそのまま進む
    return manifest;
  }

  for (const dir of personaDirs.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dir.isDirectory()) continue;
    const variantIds = await variantIdsIn(dir.name);
    if (variantIds.length === 0) continue;
    const names = DISPLAY_NAMES[dir.name] ?? {};
    manifest[dir.name] = variantIds.map((id) => ({ id, name: names[id] ?? id, rarity: "NR" }));
  }

  return manifest;
}

const manifest = await build();

const source = `import type { PartOption } from "./types";

/**
 * public/vrm/<personaId>/*.vrm を元にした、キャラごとのバリアント一覧。
 * このファイルは自動生成されています。直接編集しないでください。
 * 生成元: scripts/generate-vrm-manifest.mjs（npm run dev / build の前に走ります）
 */
export const VRM_MANIFEST: Record<string, PartOption[]> = ${JSON.stringify(manifest, null, 2)};

/**
 * 指定キャラのバリアント一覧。まだ1つもVRMを置いていないキャラでは、
 * 今えらんでいるIDだけをそのまま選択肢にして、クローゼットが空にならないようにする
 */
export function variantsFor(personaId: string, currentVariantId: string): PartOption[] {
  const known = VRM_MANIFEST[personaId];
  if (known && known.length > 0) return known;
  return [{ id: currentVariantId, name: "スタンダード", rarity: "NR" }];
}
`;

await writeFile(OUT_FILE, source, "utf8");

const variantCount = Object.values(manifest).reduce((n, list) => n + list.length, 0);
console.log(
  `vrm manifest: ${Object.keys(manifest).length}キャラ / バリアント${variantCount}件 -> src/lib/vrm-manifest.ts`,
);
