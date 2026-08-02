import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");

// 顔のUVはVRoid間で共通なので、各キャラの代表VRMから独立した顔画像だけを取り出す。
const SOURCES = {
  aimi: "swimsuit",
  shizuku: "casual",
};

const PARTS = {
  iris: /EyeIris_00_EYE/,
  brows: /FaceBrow_00_FACE/,
  mouth: /FaceMouth_00_FACE/,
};

function glbChunks(buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("GLBではありません");
  let offset = 12;
  let json = null;
  let bin = null;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8").trim());
    if (type === 0x004e4942) bin = data;
    offset += 8 + length;
  }
  if (!json || !bin) throw new Error("JSON/BINチャンクがありません");
  return { json, bin };
}

function imageForMaterial(json, bin, materialPattern) {
  const material = json.materials?.find((candidate) => materialPattern.test(candidate.name ?? ""));
  const textureIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  const imageIndex = textureIndex == null ? null : json.textures?.[textureIndex]?.source;
  const image = imageIndex == null ? null : json.images?.[imageIndex];
  const view = image?.bufferView == null ? null : json.bufferViews?.[image.bufferView];
  if (!image || !view) return null;
  const start = view.byteOffset ?? 0;
  return {
    bytes: bin.subarray(start, start + view.byteLength),
    extension: image.mimeType === "image/jpeg" ? "jpg" : "png",
  };
}

let count = 0;
for (const [personaId, variantId] of Object.entries(SOURCES)) {
  const vrmPath = path.join(PUBLIC_DIR, "vrm", personaId, `${variantId}.vrm`);
  let buffer;
  try {
    buffer = await readFile(vrmPath);
  } catch {
    continue;
  }
  const { json, bin } = glbChunks(buffer);
  const outDir = path.join(PUBLIC_DIR, "face-parts", personaId);
  await mkdir(outDir, { recursive: true });
  for (const [partId, pattern] of Object.entries(PARTS)) {
    const image = imageForMaterial(json, bin, pattern);
    if (!image) continue;
    await writeFile(path.join(outDir, `${partId}.${image.extension}`), image.bytes);
    count += 1;
  }
}

console.log(`face parts: ${count}画像 -> public/face-parts/`);
