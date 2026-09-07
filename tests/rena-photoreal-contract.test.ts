import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

interface RenaManifest {
  status: string;
  asset: {
    path: string;
    sha256: string;
    bytes: number;
    format: string;
    rigged: boolean;
  };
  visualContract: {
    preserveApprovedBodyStyle: boolean;
    neckSeamMustNotBeVisible: boolean;
    headMustNotReadAsForwardOffset: boolean;
    chinMustNotReadAsProtruding: boolean;
  };
}

const root = process.cwd();
const manifestPath = join(root, "public/models/rena/manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as RenaManifest;
const assetPath = join(root, "public", manifest.asset.path.replace(/^\//, ""));

function source(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

test("CURRENT Rena photoreal asset is the explicitly locked GLB", () => {
  assert.equal(manifest.status, "current");
  assert.equal(manifest.asset.path, "/models/rena/loose.glb");
  assert.equal(manifest.asset.format, "glTF-binary");
  assert.equal(manifest.asset.rigged, false);
  assert.equal(statSync(assetPath).size, manifest.asset.bytes);

  const binary = readFileSync(assetPath);
  assert.equal(binary.subarray(0, 4).toString("ascii"), "glTF");
  const sha256 = createHash("sha256").update(binary).digest("hex");
  assert.equal(sha256, manifest.asset.sha256);
});

test("Rena remains on the dedicated photoreal loader path", () => {
  const stage = source("src/components/character/CharacterStage.tsx");
  assert.match(stage, /NEXT_PUBLIC_RENA_GLB_URL\?\.trim\(\) \|\| "\/models\/rena\/loose\.glb"/);
  assert.match(stage, /const usePhotorealRena = personaId === "rena"/);
  assert.match(stage, /usePhotorealRena \? \(/);
  assert.match(stage, /<GlbCanvas/);
});

test("visual invariants are explicit and motion capability is not overstated", () => {
  assert.equal(manifest.visualContract.preserveApprovedBodyStyle, true);
  assert.equal(manifest.visualContract.neckSeamMustNotBeVisible, true);
  assert.equal(manifest.visualContract.headMustNotReadAsForwardOffset, true);
  assert.equal(manifest.visualContract.chinMustNotReadAsProtruding, true);

  const glbCanvas = source("src/components/character/GlbCanvas.tsx");
  assert.match(glbCanvas, /骨・表情・口パクを持たない静止3Dとして扱い/);
});
