import * as THREE from "three";

/**
 * 借りた服が覆っている範囲の体を隠す。
 *
 * 借りた服は提供元の体型に合わせて作られた硬いスキンメッシュなので、着る側の方が
 * 大きい部位（胸・肩・背中）は服を突き抜けて飛び出す。
 *
 * **服を体の外へ押し出して避ける方法は捨てた。** 服の三角形は平らなので、頂点を
 * 体表の外まで動かしても面の内側が胸のような曲面を貫いたままになり、押し出し量を
 * 上げると今度は服のメッシュ自体が破綻して黒い塊が出る（実際に何度も往復した）。
 *
 * ここでは**VRoid自身と同じやり方**を取る。VRoidは服の下に隠れる体を
 * テクスチャのアルファで消しており、それを借り物の服の形に合わせて実行時にやる。
 * 覆われている体を消してしまえば、貫通は原理的に起きない。
 *
 * バインド姿勢で1回だけ判定する。スキニングはこのあとに適用されるため、
 * 隠した面はそのまま全モーションで隠れ続ける。
 */

interface Triangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
  /** 服の開いた縁（襟ぐり・袖口・裾）に接する三角形か。体を隠す範囲を縁の手前で止めるのに使う */
  nearBoundary: boolean;
}

/**
 * 三角形を一様グリッドに登録して近傍検索を速くする。
 * three-mesh-bvh は未導入で、この用途（体1〜2万頂点 × 服数千頂点）には
 * 素朴なグリッドで十分速いため自前で持つ。
 */
class TriangleGrid {
  private readonly cells = new Map<string, Triangle[]>();
  private readonly cellSize: number;

  constructor(triangles: Triangle[], cellSize: number) {
    this.cellSize = cellSize;
    const min = new THREE.Vector3();
    const max = new THREE.Vector3();
    for (const triangle of triangles) {
      min.copy(triangle.a).min(triangle.b).min(triangle.c);
      max.copy(triangle.a).max(triangle.b).max(triangle.c);
      const x0 = Math.floor(min.x / cellSize);
      const y0 = Math.floor(min.y / cellSize);
      const z0 = Math.floor(min.z / cellSize);
      const x1 = Math.floor(max.x / cellSize);
      const y1 = Math.floor(max.y / cellSize);
      const z1 = Math.floor(max.z / cellSize);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          for (let z = z0; z <= z1; z += 1) {
            const key = `${x},${y},${z}`;
            const bucket = this.cells.get(key);
            if (bucket) bucket.push(triangle);
            else this.cells.set(key, [triangle]);
          }
        }
      }
    }
  }

  /** point の周囲 radius 内のセルに登録された三角形を集める（重複あり） */
  near(point: THREE.Vector3, radius: number, out: Triangle[]): Triangle[] {
    out.length = 0;
    const size = this.cellSize;
    const x0 = Math.floor((point.x - radius) / size);
    const y0 = Math.floor((point.y - radius) / size);
    const z0 = Math.floor((point.z - radius) / size);
    const x1 = Math.floor((point.x + radius) / size);
    const y1 = Math.floor((point.y + radius) / size);
    const z1 = Math.floor((point.z + radius) / size);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) {
        for (let z = z0; z <= z1; z += 1) {
          const bucket = this.cells.get(`${x},${y},${z}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  }
}

/** 三角形上の point に最も近い点を closest に書き込む（Ericson, Real-Time Collision Detection） */
function closestPointOnTriangle(
  point: THREE.Vector3,
  triangle: Triangle,
  closest: THREE.Vector3,
): void {
  const { a, b, c } = triangle;
  const ab = _v1.subVectors(b, a);
  const ac = _v2.subVectors(c, a);
  const ap = _v3.subVectors(point, a);
  const d1 = ab.dot(ap);
  const d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) {
    closest.copy(a);
    return;
  }

  const bp = _v4.subVectors(point, b);
  const d3 = ab.dot(bp);
  const d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) {
    closest.copy(b);
    return;
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    closest.copy(a).addScaledVector(ab, d1 / (d1 - d3));
    return;
  }

  const cp = _v5.subVectors(point, c);
  const d5 = ab.dot(cp);
  const d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) {
    closest.copy(c);
    return;
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    closest.copy(a).addScaledVector(ac, d2 / (d2 - d6));
    return;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    closest.copy(b).addScaledVector(_v6.subVectors(c, b), (d4 - d3) / (d4 - d3 + (d5 - d6)));
    return;
  }

  const denom = 1 / (va + vb + vc);
  closest
    .copy(a)
    .addScaledVector(ab, vb * denom)
    .addScaledVector(ac, vc * denom);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3();
const _v6 = new THREE.Vector3();

/** メッシュ群からワールド空間の三角形を集める */
function collectTriangles(meshes: THREE.Mesh[], markBoundary = false): Triangle[] {
  const triangles: Triangle[] = [];
  const position = new THREE.Vector3();
  for (const mesh of meshes) {
    const attribute = mesh.geometry.getAttribute("position");
    if (!attribute) continue;
    const index = mesh.geometry.index;
    const count = index ? index.count : attribute.count;
    const vertices: THREE.Vector3[] = [];
    for (let i = 0; i < attribute.count; i += 1) {
      position.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
      vertices.push(position.clone());
    }
    const boundary = markBoundary
      ? findBoundaryVertices(mesh.geometry, attribute.count)
      : null;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      const a = vertices[ia];
      const b = vertices[ib];
      const c = vertices[ic];
      if (!a || !b || !c) continue;
      const nearBoundary = boundary
        ? Boolean(boundary[ia] || boundary[ib] || boundary[ic])
        : false;
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(_v1.subVectors(c, a));
      const length = normal.length();
      // 面積ゼロの縮退三角形は法線が定まらないので捨てる
      if (length < 1e-12) continue;
      normal.multiplyScalar(1 / length);
      triangles.push({ a, b, c, normal, nearBoundary });
    }
  }
  return triangles;
}

/**
 * 開いた縁（1枚の三角形にしか属さない辺）に載っている頂点を洗い出す。
 * 服は襟ぐり・袖口・裾が開いた曲面なので、そこが縁になる。
 */
function findBoundaryVertices(geometry: THREE.BufferGeometry, vertexCount: number): Uint8Array {
  const useCount = new Map<number, number>();
  const index = geometry.index;
  const count = index ? index.count : vertexCount;
  const at = (i: number) => (index ? index.getX(i) : i);
  const key = (a: number, b: number) => (a < b ? a * vertexCount + b : b * vertexCount + a);

  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(p, q);
      useCount.set(k, (useCount.get(k) ?? 0) + 1);
    }
  }

  const boundary = new Uint8Array(vertexCount);
  for (let i = 0; i + 2 < count; i += 3) {
    const a = at(i);
    const b = at(i + 1);
    const c = at(i + 2);
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      if (useCount.get(key(p, q)) === 1) {
        boundary[p] = 1;
        boundary[q] = 1;
      }
    }
  }
  return boundary;
}

/** 服が覆っているとみなす、体表から服までの距離の上限（m） */
const COVERED_RADIUS = 0.11;

/**
 * 服が覆っている範囲の体を隠す。VRoid自身が「服の下の体」をテクスチャのアルファで
 * 消しているのと同じことを、借り物の服の形に合わせて実行時にやる。
 *
 * 押し出し（fitClothingToBody）だけでは、服の三角形が平らなぶん胸のように
 * 曲率の大きい部位を面の内側が貫いてしまい、体が黒い塊として飛び出す。
 * **覆われている体を消してしまえば貫通は原理的に起きない。**
 *
 * 襟ぐり・袖口・裾に接する三角形は判定から除くので、服の開口部から見える肌は残る。
 */
export function maskBodyUnderClothing(
  bodyMeshes: THREE.Mesh[],
  clothMeshes: THREE.Mesh[],
): { restore(): void; hiddenTriangles: number } {
  const replacements: Array<{ mesh: THREE.Mesh; original: THREE.BufferGeometry }> = [];
  const restore = () => {
    for (const { mesh, original } of replacements) {
      const filtered = mesh.geometry;
      mesh.geometry = original;
      filtered.dispose();
    }
    replacements.length = 0;
  };

  const clothTriangles = collectTriangles(clothMeshes, true);
  if (clothTriangles.length === 0) return { restore, hiddenTriangles: 0 };
  const grid = new TriangleGrid(clothTriangles, COVERED_RADIUS);

  let hiddenTriangles = 0;
  const candidates: Triangle[] = [];
  const worldVertex = new THREE.Vector3();
  const closest = new THREE.Vector3();

  for (const mesh of bodyMeshes) {
    const attribute = mesh.geometry.getAttribute("position");
    if (!attribute) continue;
    const vertexCount = attribute.count;
    const covered = new Uint8Array(vertexCount);

    for (let i = 0; i < vertexCount; i += 1) {
      worldVertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
      grid.near(worldVertex, COVERED_RADIUS, candidates);
      let bestDistanceSq = Infinity;
      let bestNearBoundary = false;
      for (const triangle of candidates) {
        closestPointOnTriangle(worldVertex, triangle, closest);
        const distanceSq = closest.distanceToSquared(worldVertex);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          bestNearBoundary = triangle.nearBoundary;
        }
      }
      // 服の開いた縁（襟ぐり・袖口・裾）がいちばん近い頂点は肌を残す。
      // ここを一緒に隠すと、裾のすぐ下など「服が終わっていて体が見えるべき所」まで
      // 削れてしまい、スカートの下に黒い欠けができる（実際に1度やって出た）
      if (bestDistanceSq <= COVERED_RADIUS * COVERED_RADIUS && !bestNearBoundary) {
        covered[i] = 1;
      }
    }

    const geometry = mesh.geometry;
    const index = geometry.index;
    const sourceCount = index ? index.count : vertexCount;
    const at = (offset: number) => (index ? index.getX(offset) : offset);
    const sourceGroups =
      geometry.groups.length > 0
        ? geometry.groups
        : [{ start: 0, count: sourceCount, materialIndex: 0 }];
    const ranges = new Map<string, { start: number; count: number }>();
    const indices: number[] = [];
    let dropped = 0;

    for (const group of sourceGroups) {
      const key = `${group.start}:${group.count}`;
      if (ranges.has(key)) continue;
      const start = indices.length;
      const end = Math.min(group.start + group.count, sourceCount);
      for (let offset = group.start; offset + 2 < end; offset += 3) {
        const ia = at(offset);
        const ib = at(offset + 1);
        const ic = at(offset + 2);
        // 3頂点のうち2つ以上が服の下なら落とす。「3つとも」にすると、胸の頂点のように
        // 判定から漏れたものが1つあるだけで面が残り、そこだけ貫通して見える。
        // 1つだけ覆われている三角形は開口部の際なので残し、肌が欠けないようにする
        if (covered[ia] + covered[ib] + covered[ic] >= 2) {
          dropped += 1;
          continue;
        }
        indices.push(ia, ib, ic);
      }
      ranges.set(key, { start, count: indices.length - start });
    }
    if (dropped === 0) continue;

    const filtered = geometry.clone();
    filtered.setIndex(indices);
    filtered.clearGroups();
    for (const group of sourceGroups) {
      const range = ranges.get(`${group.start}:${group.count}`);
      if (range) filtered.addGroup(range.start, range.count, group.materialIndex);
    }
    filtered.computeBoundingBox();
    filtered.computeBoundingSphere();
    replacements.push({ mesh, original: geometry });
    mesh.geometry = filtered;
    hiddenTriangles += dropped;
  }

  return { restore, hiddenTriangles };
}
