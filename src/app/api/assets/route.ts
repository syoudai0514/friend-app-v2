import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * public/ に置かれたVRM関連ファイルを探して一覧を返す。
 *
 *   public/vrm/<キャラID>/<バリアントID>.vrm          … VRM本体
 *   public/vrm/<キャラID>/<バリアントID>.poster.webp  … 読み込み前後に出す静止画
 *   public/vrma/<モーションID>.vrma                   … 骨格アニメーション
 *
 * 開発中にファイルを置いてリロードするだけで反映されるよう、
 * リクエストのたびにディレクトリを読む。
 *
 * 本番（Vercelなどのサーバーレス）では public/ が関数から見えないことがあるため、
 * next.config.ts の outputFileTracingIncludes で明示的に同梱している。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLIC_DIR = path.join(process.cwd(), "public");

interface VariantAssets {
  vrm: string;
  poster: string | null;
}

interface AssetManifest {
  personas: Record<string, Record<string, VariantAssets>>;
  motions: Record<string, string>;
}

async function listDir(relDir: string): Promise<import("node:fs").Dirent[]> {
  try {
    return await readdir(path.join(PUBLIC_DIR, relDir), { withFileTypes: true });
  } catch {
    // フォルダが無いのは正常（まだファイルを置いていないだけ）
    return [];
  }
}

async function personaVariants(personaId: string): Promise<Record<string, VariantAssets>> {
  const entries = await listDir(path.join("vrm", personaId));
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const variants: Record<string, VariantAssets> = {};
  for (const f of files) {
    if (!f.toLowerCase().endsWith(".vrm")) continue;
    const id = path.basename(f, path.extname(f));
    const posterName = `${id}.poster.webp`;
    variants[id] = {
      vrm: `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(f)}`,
      poster: files.includes(posterName)
        ? `/vrm/${encodeURIComponent(personaId)}/${encodeURIComponent(posterName)}`
        : null,
    };
  }
  return variants;
}

export async function GET() {
  const manifest: AssetManifest = { personas: {}, motions: {} };

  const personaDirs = await listDir("vrm");
  for (const dir of personaDirs) {
    if (!dir.isDirectory()) continue;
    const variants = await personaVariants(dir.name);
    if (Object.keys(variants).length > 0) manifest.personas[dir.name] = variants;
  }

  for (const f of (await listDir("vrma")).filter((e) => e.isFile())) {
    if (!f.name.toLowerCase().endsWith(".vrma")) continue;
    const id = path.basename(f.name, path.extname(f.name));
    manifest.motions[id] = `/vrma/${encodeURIComponent(f.name)}`;
  }

  return Response.json(manifest, { headers: { "Cache-Control": "no-store" } });
}
