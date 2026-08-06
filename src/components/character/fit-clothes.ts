import * as THREE from "three";

/**
 * 借りた服が着る人の体を突き抜けないよう、服のメッシュを体の外側へ押し出す。
 *
 * 借りた服は提供元の体型に合わせて作られた硬いスキンメッシュなので、着る側の方が
 * 大きい部位（胸・肩・背中）は必ず服の外へ出る。逆に服の面が体の内側へ入ると
 * 裏面カリングで消え、「上着の背中が割れて袖だけ浮いている」ようにも見える。
 *
 * ここでは**体には一切触らず、服だけを動かす**。着る人の体型がそのまま服に出るので
 * 「本人が他人の服を着ている」自然な見た目になり、服のデザインも保たれる。
 *
 * バインド姿勢で1回だけ焼き込む。スキニングはこのあとに適用されるため、
 * 変位はそのまま全モーションへ追従する。
 */

/** 服の面を体からこれだけ浮かせる（m）。小さすぎるとチラつき、大きいと浮いて見える */
const SURFACE_MARGIN = 0.005;
/**
 * 襟ぐり・袖口・裾など、服の開いた縁（boundary edge）にだけ使う大きめの余裕（m）。
 * 縁が体すれすれを走ると、体と服が交互に前後してギザギザの継ぎ目に見えるため、
 * 縁だけははっきり浮かせて逃がす。
 */
const BOUNDARY_MARGIN = 0.014;
/** この距離より遠い体表しか無い頂点は「体から離れている」とみなして動かさない（m）。スカートの裾・ゆるい袖を守る */
const SEARCH_RADIUS = 0.06;
/** 1頂点あたりの押し出し量の上限（m）。破綻した入力で服が極端に膨らむのを防ぐ */
const MAX_PUSH = 0.05;
/** 変位を均すLaplacianの回数。境目が角張らないようにする */
const SMOOTH_ITERATIONS = 4;

interface Triangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  normal: THREE.Vector3;
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
function collectTriangles(meshes: THREE.Mesh[]): Triangle[] {
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
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index.getX(i) : i;
      const ib = index ? index.getX(i + 1) : i + 1;
      const ic = index ? index.getX(i + 2) : i + 2;
      const a = vertices[ia];
      const b = vertices[ib];
      const c = vertices[ic];
      if (!a || !b || !c) continue;
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(_v1.subVectors(c, a));
      const length = normal.length();
      // 面積ゼロの縮退三角形は法線が定まらないので捨てる
      if (length < 1e-12) continue;
      normal.multiplyScalar(1 / length);
      triangles.push({ a, b, c, normal });
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

/** index から頂点の隣接表を作る（変位の平滑化に使う） */
function buildAdjacency(geometry: THREE.BufferGeometry, vertexCount: number): number[][] {
  const adjacency: number[][] = Array.from({ length: vertexCount }, () => []);
  const index = geometry.index;
  const count = index ? index.count : vertexCount;
  for (let i = 0; i + 2 < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    adjacency[ia].push(ib, ic);
    adjacency[ib].push(ia, ic);
    adjacency[ic].push(ia, ib);
  }
  return adjacency;
}

export interface ClothFitHandle {
  /** 変位を取り消して元のジオメトリに戻す */
  restore(): void;
  /** 実際に動かした頂点の数。0なら突き抜けが無かった（またはフィット対象が見つからなかった） */
  movedVertices: number;
}

/** 体側の近傍検索構造。同じ人を着せ替えるあいだは作り直さなくてよいので呼び出し側で使い回す */
export interface BodyCollider {
  readonly grid: TriangleGrid;
}

/**
 * 体の三角形から近傍検索構造を作る。
 * 呼ぶ前に matrixWorld が静止姿勢で更新されていること。
 */
export function buildBodyCollider(bodyMeshes: THREE.Mesh[]): BodyCollider | null {
  const triangles = collectTriangles(bodyMeshes);
  if (triangles.length === 0) return null;
  return { grid: new TriangleGrid(triangles, SEARCH_RADIUS) };
}

/**
 * clothMeshes を体の外側へ押し出す。
 * 呼ぶ前に服の matrixWorld が、collider を作ったときと**同じ静止姿勢で**更新されていること。
 */
export function fitClothingToBody(
  clothMeshes: THREE.Mesh[],
  collider: BodyCollider,
): ClothFitHandle {
  const originals: Array<{ geometry: THREE.BufferGeometry; position: THREE.BufferAttribute }> = [];
  const restore = () => {
    for (const { geometry, position } of originals) {
      geometry.setAttribute("position", position);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
    originals.length = 0;
  };

  const { grid } = collider;
  let movedVertices = 0;
  const candidates: Triangle[] = [];
  const worldVertex = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const best = new THREE.Vector3();
  const bestNormal = new THREE.Vector3();

  for (const mesh of clothMeshes) {
    const attribute = mesh.geometry.getAttribute("position");
    if (!attribute || !(attribute instanceof THREE.BufferAttribute)) continue;

    const vertexCount = attribute.count;
    // ワールド空間での押し出しベクトル。あとで平滑化してからローカルへ戻す
    const displacement = new Float32Array(vertexCount * 3);
    const boundary = findBoundaryVertices(mesh.geometry, vertexCount);
    let meshMoved = 0;

    for (let i = 0; i < vertexCount; i += 1) {
      worldVertex.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
      grid.near(worldVertex, SEARCH_RADIUS, candidates);
      if (candidates.length === 0) continue;

      let bestDistanceSq = Infinity;
      for (const triangle of candidates) {
        closestPointOnTriangle(worldVertex, triangle, closest);
        const distanceSq = closest.distanceToSquared(worldVertex);
        if (distanceSq < bestDistanceSq) {
          bestDistanceSq = distanceSq;
          best.copy(closest);
          bestNormal.copy(triangle.normal);
        }
      }
      if (bestDistanceSq > SEARCH_RADIUS * SEARCH_RADIUS) continue;

      // 体表からの符号付き距離。マイナスなら体に食い込んでいる
      const signed = _v1.subVectors(worldVertex, best).dot(bestNormal);
      const margin = boundary[i] ? BOUNDARY_MARGIN : SURFACE_MARGIN;
      const push = margin - signed;
      if (push <= 0) continue;

      const amount = Math.min(push, MAX_PUSH);
      displacement[i * 3] = bestNormal.x * amount;
      displacement[i * 3 + 1] = bestNormal.y * amount;
      displacement[i * 3 + 2] = bestNormal.z * amount;
      meshMoved += 1;
    }

    if (meshMoved === 0) continue;
    movedVertices += meshMoved;

    // 押し出した所と押し出していない所の境目が角張らないよう変位を均す。
    // 頂点位置ではなく変位だけを均すので、服のディテールは失われない
    const adjacency = buildAdjacency(mesh.geometry, vertexCount);
    let current = displacement;
    for (let iteration = 0; iteration < SMOOTH_ITERATIONS; iteration += 1) {
      const next = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i += 1) {
        const neighbours = adjacency[i];
        if (neighbours.length === 0) {
          next[i * 3] = current[i * 3];
          next[i * 3 + 1] = current[i * 3 + 1];
          next[i * 3 + 2] = current[i * 3 + 2];
          continue;
        }
        let sx = current[i * 3];
        let sy = current[i * 3 + 1];
        let sz = current[i * 3 + 2];
        for (const n of neighbours) {
          sx += current[n * 3];
          sy += current[n * 3 + 1];
          sz += current[n * 3 + 2];
        }
        const weight = 1 / (neighbours.length + 1);
        next[i * 3] = sx * weight;
        next[i * 3 + 1] = sy * weight;
        next[i * 3 + 2] = sz * weight;
      }
      current = next;
    }

    // 平滑化で押し出しが足りなくなった分を補う（食い込みが残るより浮く方がまし）
    for (let i = 0; i < vertexCount; i += 1) {
      const ox = displacement[i * 3];
      const oy = displacement[i * 3 + 1];
      const oz = displacement[i * 3 + 2];
      const originalLength = Math.hypot(ox, oy, oz);
      if (originalLength === 0) continue;
      const sx = current[i * 3];
      const sy = current[i * 3 + 1];
      const sz = current[i * 3 + 2];
      const along = (sx * ox + sy * oy + sz * oz) / originalLength;
      if (along >= originalLength) continue;
      const deficit = (originalLength - along) / originalLength;
      current[i * 3] = sx + ox * deficit;
      current[i * 3 + 1] = sy + oy * deficit;
      current[i * 3 + 2] = sz + oz * deficit;
    }

    // ワールドの変位をメッシュのローカル空間へ戻す（平行移動成分は乗せない）
    const worldToLocal = new THREE.Matrix3().setFromMatrix4(
      new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
    );
    const fitted = attribute.clone();
    const delta = new THREE.Vector3();
    for (let i = 0; i < vertexCount; i += 1) {
      delta
        .set(current[i * 3], current[i * 3 + 1], current[i * 3 + 2])
        .applyMatrix3(worldToLocal);
      fitted.setXYZ(
        i,
        attribute.getX(i) + delta.x,
        attribute.getY(i) + delta.y,
        attribute.getZ(i) + delta.z,
      );
    }
    fitted.needsUpdate = true;

    originals.push({ geometry: mesh.geometry, position: attribute });
    mesh.geometry.setAttribute("position", fitted);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }

  return { restore, movedVertices };
}
