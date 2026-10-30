/**
 * Smooth: Catmull-Clark subdivision for CAD parts.
 *
 * A CAD mesh is triangles, and smoothing raw triangles comes out lumpy and depends on
 * which way each face's diagonals run. So the triangles are first merged back into the
 * flat faces they came from (a box is six squares again), then subdivided. The first
 * step turns every face into quads: that quad mesh is the "net" whose points the user
 * can pull. Each pulled point is solved so the smooth surface passes exactly through
 * where it was dropped. Edges marked as creases stay sharp, which keeps a flat bottom
 * flat on the bed.
 *
 * Pure math on typed arrays, so the browser and the desktop app build the same surface.
 */

export type Vec3 = [number, number, number];

/** Polygon mesh. Face f runs faceVerts[faceStart[f]] .. faceVerts[faceStart[f + 1] - 1], anticlockwise seen from outside. */
export type PolyMesh = {
  positions: Float64Array;
  faceStart: Uint32Array;
  faceVerts: Uint32Array;
  /** The flat CAD face each face came from. */
  parentFace: Uint32Array;
};

/** Sharp edges (keyed by `edgeKey`) and points that never move. */
export type CreaseTags = {
  crease: Set<number>;
  pinned: Uint8Array;
};

/** `from` set: the pull is the step from `from` to `to`, added to wherever the surface is now. */
export type SmoothPointTug = { detail: number; at: Vec3; to: Vec3; from?: Vec3 };
export type SmoothEdgeCrease = { detail: number; a: Vec3; b: Vec3; smooth?: boolean };

export function vertexCount(mesh: PolyMesh) {
  return mesh.positions.length / 3;
}

export function faceCount(mesh: PolyMesh) {
  return mesh.faceStart.length - 1;
}

export function edgeKey(a: number, b: number, nv: number) {
  return a < b ? a * nv + b : b * nv + a;
}

function point(positions: ArrayLike<number>, index: number): Vec3 {
  return [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(a: Vec3) {
  return Math.hypot(a[0], a[1], a[2]);
}

// ---------------------------------------------------------------------------
// Triangles back to flat faces

/**
 * Weld a triangle soup and merge coplanar neighbours back into polygons. A flat region
 * with a hole in it, or one too bent to fan from its middle, keeps its triangles.
 */
export function polygonize(soup: ArrayLike<number>, weldTol = 1e-4): PolyMesh | null {
  const index = new Map<string, number>();
  const pos: number[] = [];
  const vertexOf = (offset: number) => {
    const x = soup[offset];
    const y = soup[offset + 1];
    const z = soup[offset + 2];
    const key = `${Math.round(x / weldTol)},${Math.round(y / weldTol)},${Math.round(z / weldTol)}`;
    let id = index.get(key);
    if (id === undefined) {
      id = pos.length / 3;
      index.set(key, id);
      pos.push(x, y, z);
    }
    return id;
  };
  const tris: number[] = [];
  for (let i = 0; i + 8 < soup.length; i += 9) {
    const a = vertexOf(i);
    const b = vertexOf(i + 3);
    const c = vertexOf(i + 6);
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
  }
  const nv = pos.length / 3;
  const nt = tris.length / 3;
  if (nt < 4) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < nv; v += 1) {
    minX = Math.min(minX, pos[v * 3]); maxX = Math.max(maxX, pos[v * 3]);
    minY = Math.min(minY, pos[v * 3 + 1]); maxY = Math.max(maxY, pos[v * 3 + 1]);
    minZ = Math.min(minZ, pos[v * 3 + 2]); maxZ = Math.max(maxZ, pos[v * 3 + 2]);
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const planeTol = 1e-4 + extent * 1e-6;

  // Triangle planes; slivers too thin to have a trustworthy normal never merge.
  const normals = new Float64Array(nt * 3);
  const offsets = new Float64Array(nt);
  const usable = new Uint8Array(nt);
  for (let t = 0; t < nt; t += 1) {
    const a = point(pos, tris[t * 3]);
    const n = cross(sub(point(pos, tris[t * 3 + 1]), a), sub(point(pos, tris[t * 3 + 2]), a));
    const len = length(n);
    if (len > extent * extent * 1e-12) {
      normals[t * 3] = n[0] / len; normals[t * 3 + 1] = n[1] / len; normals[t * 3 + 2] = n[2] / len;
      offsets[t] = dot([normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]], a);
      usable[t] = 1;
    }
  }

  const halfedge = new Map<number, number>();
  const edgeUses = new Map<number, number>();
  for (let t = 0; t < nt; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + ((k + 1) % 3)];
      halfedge.set(a * nv + b, t);
      const key = edgeKey(a, b, nv);
      edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
    }
  }

  const parent = new Int32Array(nt).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const cosTol = Math.cos((1 * Math.PI) / 180);
  for (let t = 0; t < nt; t += 1) {
    if (!usable[t]) continue;
    for (let k = 0; k < 3; k += 1) {
      const a = tris[t * 3 + k];
      const b = tris[t * 3 + ((k + 1) % 3)];
      if (edgeUses.get(edgeKey(a, b, nv)) !== 2) continue;
      const u = halfedge.get(b * nv + a);
      if (u === undefined || !usable[u]) continue;
      const d = normals[t * 3] * normals[u * 3] + normals[t * 3 + 1] * normals[u * 3 + 1] + normals[t * 3 + 2] * normals[u * 3 + 2];
      if (d < cosTol || Math.abs(offsets[t] - offsets[u]) > planeTol) continue;
      const rt = find(t);
      const ru = find(u);
      if (rt !== ru) parent[rt] = ru;
    }
  }

  const groups = new Map<number, number[]>();
  for (let t = 0; t < nt; t += 1) {
    const root = find(t);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  }

  type Face = { verts: number[]; polygon: boolean; normal: Vec3 };
  const faces: Face[] = [];
  const keepTriangles = (members: number[]) => {
    for (const t of members) {
      faces.push({ verts: [tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]], polygon: false, normal: [normals[t * 3], normals[t * 3 + 1], normals[t * 3 + 2]] });
    }
  };
  for (const [root, members] of groups) {
    if (members.length === 1) {
      keepTriangles(members);
      continue;
    }
    const next = new Map<number, number>();
    let broken = false;
    for (const t of members) {
      for (let k = 0; k < 3; k += 1) {
        const a = tris[t * 3 + k];
        const b = tris[t * 3 + ((k + 1) % 3)];
        const twin = halfedge.get(b * nv + a);
        if (twin !== undefined && edgeUses.get(edgeKey(a, b, nv)) === 2 && find(twin) === root) continue;
        if (next.has(a)) broken = true;
        next.set(a, b);
      }
    }
    const loop: number[] = [];
    if (!broken && next.size >= 3) {
      const start = next.keys().next().value as number;
      let at = start;
      do {
        loop.push(at);
        const to = next.get(at);
        if (to === undefined || loop.length > next.size) {
          broken = true;
          break;
        }
        at = to;
      } while (at !== start);
    }
    // More than one loop is a face with a hole in it.
    if (broken || loop.length !== next.size) {
      keepTriangles(members);
      continue;
    }
    const normal: Vec3 = [normals[root * 3], normals[root * 3 + 1], normals[root * 3 + 2]];
    if (!starShapedFromCentroid(pos, loop, normal)) {
      keepTriangles(members);
      continue;
    }
    faces.push({ verts: loop, polygon: true, normal });
  }

  // A point in the middle of a straight edge only adds a kink to the net. Drop it when
  // just two flat faces meet there and it is straight in both.
  const polygonUses = new Uint32Array(nv);
  const straightUses = new Uint32Array(nv);
  const triangleUses = new Uint32Array(nv);
  for (const face of faces) {
    const n = face.verts.length;
    for (let i = 0; i < n; i += 1) {
      const v = face.verts[i];
      if (!face.polygon) {
        triangleUses[v] += 1;
        continue;
      }
      polygonUses[v] += 1;
      const p = point(pos, face.verts[(i + n - 1) % n]);
      const q = point(pos, face.verts[(i + 1) % n]);
      const c = point(pos, v);
      const along = sub(q, p);
      const len2 = dot(along, along);
      if (len2 > 0 && length(cross(along, sub(c, p))) ** 2 <= 1e-12 * len2 * len2 && dot(sub(c, p), along) > 0 && dot(sub(q, c), along) > 0) {
        straightUses[v] += 1;
      }
    }
  }
  const drop = (v: number) => triangleUses[v] === 0 && polygonUses[v] === 2 && straightUses[v] === 2;
  for (const face of faces) {
    if (!face.polygon) continue;
    const kept = face.verts.filter((v) => !drop(v));
    if (kept.length >= 3) face.verts = kept;
  }

  // Compact: interior points of merged faces are no longer used.
  const remap = new Int32Array(nv).fill(-1);
  const outPositions: number[] = [];
  const faceStart: number[] = [0];
  const faceVerts: number[] = [];
  for (const face of faces) {
    for (const v of face.verts) {
      if (remap[v] < 0) {
        remap[v] = outPositions.length / 3;
        outPositions.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      faceVerts.push(remap[v]);
    }
    faceStart.push(faceVerts.length);
  }
  const nf = faceStart.length - 1;
  return {
    positions: Float64Array.from(outPositions),
    faceStart: Uint32Array.from(faceStart),
    faceVerts: Uint32Array.from(faceVerts),
    parentFace: Uint32Array.from({ length: nf }, (_, f) => f),
  };
}

/** Every edge seen anticlockwise from the vertex average, so Catmull-Clark's fan stays inside the face. */
function starShapedFromCentroid(pos: ArrayLike<number>, loop: number[], normal: Vec3) {
  const c: Vec3 = [0, 0, 0];
  for (const v of loop) {
    c[0] += pos[v * 3]; c[1] += pos[v * 3 + 1]; c[2] += pos[v * 3 + 2];
  }
  c[0] /= loop.length; c[1] /= loop.length; c[2] /= loop.length;
  for (let i = 0; i < loop.length; i += 1) {
    const a = sub(point(pos, loop[i]), c);
    const b = sub(point(pos, loop[(i + 1) % loop.length]), c);
    if (dot(cross(a, b), normal) <= 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Topology

type Topology = {
  nv: number;
  nf: number;
  ne: number;
  edgeA: Uint32Array;
  edgeB: Uint32Array;
  /** First two faces on each edge; -1 when missing. */
  edgeFace0: Int32Array;
  edgeFace1: Int32Array;
  edgeFaces: Uint32Array;
  /** Edge of face corner i, running to corner i + 1; aligned with faceVerts. */
  cornerEdge: Uint32Array;
  edgeIndex: Map<number, number>;
  vertEdgeStart: Uint32Array;
  vertEdges: Uint32Array;
  vertFaceStart: Uint32Array;
  /** Face corner index (into faceVerts) of each face around the vertex. */
  vertCorners: Uint32Array;
};

function buildTopology(mesh: PolyMesh): Topology {
  const nv = vertexCount(mesh);
  const nf = faceCount(mesh);
  const { faceStart, faceVerts } = mesh;
  const edgeIndex = new Map<number, number>();
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const cornerEdge = new Uint32Array(faceVerts.length);
  for (let f = 0; f < nf; f += 1) {
    const s = faceStart[f];
    const n = faceStart[f + 1] - s;
    for (let i = 0; i < n; i += 1) {
      const a = faceVerts[s + i];
      const b = faceVerts[s + ((i + 1) % n)];
      const key = edgeKey(a, b, nv);
      let e = edgeIndex.get(key);
      if (e === undefined) {
        e = edgeA.length;
        edgeIndex.set(key, e);
        edgeA.push(Math.min(a, b));
        edgeB.push(Math.max(a, b));
      }
      cornerEdge[s + i] = e;
    }
  }
  const ne = edgeA.length;
  const edgeFace0 = new Int32Array(ne).fill(-1);
  const edgeFace1 = new Int32Array(ne).fill(-1);
  const edgeFaces = new Uint32Array(ne);
  for (let f = 0; f < nf; f += 1) {
    for (let c = faceStart[f]; c < faceStart[f + 1]; c += 1) {
      const e = cornerEdge[c];
      if (edgeFaces[e] === 0) edgeFace0[e] = f;
      else if (edgeFaces[e] === 1) edgeFace1[e] = f;
      edgeFaces[e] += 1;
    }
  }
  const vertEdgeStart = new Uint32Array(nv + 1);
  for (let e = 0; e < ne; e += 1) {
    vertEdgeStart[edgeA[e] + 1] += 1;
    vertEdgeStart[edgeB[e] + 1] += 1;
  }
  for (let v = 0; v < nv; v += 1) vertEdgeStart[v + 1] += vertEdgeStart[v];
  const vertEdges = new Uint32Array(ne * 2);
  const fillE = vertEdgeStart.slice(0, nv);
  for (let e = 0; e < ne; e += 1) {
    vertEdges[fillE[edgeA[e]]++] = e;
    vertEdges[fillE[edgeB[e]]++] = e;
  }
  const vertFaceStart = new Uint32Array(nv + 1);
  for (let c = 0; c < faceVerts.length; c += 1) vertFaceStart[faceVerts[c] + 1] += 1;
  for (let v = 0; v < nv; v += 1) vertFaceStart[v + 1] += vertFaceStart[v];
  const vertCorners = new Uint32Array(faceVerts.length);
  const fillF = vertFaceStart.slice(0, nv);
  for (let c = 0; c < faceVerts.length; c += 1) vertCorners[fillF[faceVerts[c]]++] = c;
  return {
    nv, nf, ne,
    edgeA: Uint32Array.from(edgeA),
    edgeB: Uint32Array.from(edgeB),
    edgeFace0, edgeFace1, edgeFaces, cornerEdge, edgeIndex,
    vertEdgeStart, vertEdges, vertFaceStart, vertCorners,
  };
}

/** Face of each corner, for walking from a corner back to its face. */
function cornerFaces(mesh: PolyMesh) {
  const out = new Uint32Array(mesh.faceVerts.length);
  for (let f = 0; f < faceCount(mesh); f += 1) {
    for (let c = mesh.faceStart[f]; c < mesh.faceStart[f + 1]; c += 1) out[c] = f;
  }
  return out;
}

type VertexKind = { fixed: Uint8Array; creaseNeighbours: Int32Array; creaseCount: Uint8Array };

/**
 * How each point moves: fixed (pinned, a corner of three or more creases, or on an
 * edge shared by more than two faces), along a crease (two crease edges), or smooth.
 */
function classify(mesh: PolyMesh, topo: Topology, tags: CreaseTags, sharp: Uint8Array): VertexKind {
  const { nv } = topo;
  const fixed = new Uint8Array(nv);
  const creaseNeighbours = new Int32Array(nv * 2).fill(-1);
  const creaseCount = new Uint8Array(nv);
  for (let v = 0; v < nv; v += 1) {
    if (tags.pinned[v]) fixed[v] = 1;
    let count = 0;
    let boundary = 0;
    for (let i = topo.vertEdgeStart[v]; i < topo.vertEdgeStart[v + 1]; i += 1) {
      const e = topo.vertEdges[i];
      if (topo.edgeFaces[e] > 2) fixed[v] = 1;
      if (topo.edgeFaces[e] === 1) boundary += 1;
      if (!sharp[e]) continue;
      if (count < 2) creaseNeighbours[v * 2 + count] = topo.edgeA[e] === v ? topo.edgeB[e] : topo.edgeA[e];
      count += 1;
    }
    creaseCount[v] = Math.min(255, count);
    if (count >= 3) fixed[v] = 1;
    // An open corner (one face, two boundary edges) stays where it is.
    if (boundary >= 2 && topo.vertFaceStart[v + 1] - topo.vertFaceStart[v] === 1) fixed[v] = 1;
  }
  return { fixed, creaseNeighbours, creaseCount };
}

function sharpEdges(topo: Topology, tags: CreaseTags) {
  const sharp = new Uint8Array(topo.ne);
  for (let e = 0; e < topo.ne; e += 1) {
    if (topo.edgeFaces[e] !== 2 || tags.crease.has(edgeKey(topo.edgeA[e], topo.edgeB[e], topo.nv))) sharp[e] = 1;
  }
  return sharp;
}

// ---------------------------------------------------------------------------
// Catmull-Clark

export function emptyTags(mesh: PolyMesh): CreaseTags {
  return { crease: new Set(), pinned: new Uint8Array(vertexCount(mesh)) };
}

/**
 * One Catmull-Clark step without the positions: which points average which. It only
 * depends on how the net is joined and which edges are sharp, so a drag works it out once.
 */
type CcPlan = {
  source: PolyMesh;
  topo: Topology;
  sharp: Uint8Array;
  kind: VertexKind;
  faceOfCorner: Uint32Array;
  /** The finer net, its positions not yet filled in (zeros). */
  mesh: PolyMesh;
  tags: CreaseTags;
};

function ccPlan(mesh: PolyMesh, tags: CreaseTags): CcPlan {
  const topo = buildTopology(mesh);
  const { nv, nf, ne } = topo;
  const { faceStart, faceVerts } = mesh;
  const sharp = sharpEdges(topo, tags);
  const kind = classify(mesh, topo, tags, sharp);
  const total = nv + ne + nf;

  const newStart = new Uint32Array(faceVerts.length + 1);
  const newVerts = new Uint32Array(faceVerts.length * 4);
  const newParent = new Uint32Array(faceVerts.length);
  let q = 0;
  for (let f = 0; f < nf; f += 1) {
    const s = faceStart[f];
    const n = faceStart[f + 1] - s;
    for (let i = 0; i < n; i += 1) {
      const c = s + i;
      const prev = s + ((i + n - 1) % n);
      newVerts[q * 4] = faceVerts[c];
      newVerts[q * 4 + 1] = nv + topo.cornerEdge[c];
      newVerts[q * 4 + 2] = nv + ne + f;
      newVerts[q * 4 + 3] = nv + topo.cornerEdge[prev];
      newParent[q] = mesh.parentFace[f];
      q += 1;
      newStart[q] = q * 4;
    }
  }

  const crease = new Set<number>();
  for (let e = 0; e < ne; e += 1) {
    if (!tags.crease.has(edgeKey(topo.edgeA[e], topo.edgeB[e], nv))) continue;
    crease.add(edgeKey(topo.edgeA[e], nv + e, total));
    crease.add(edgeKey(nv + e, topo.edgeB[e], total));
  }
  const pinned = new Uint8Array(total);
  pinned.set(tags.pinned.subarray(0, nv));
  return {
    source: mesh,
    topo,
    sharp,
    kind,
    faceOfCorner: cornerFaces(mesh),
    mesh: { positions: new Float64Array(total * 3), faceStart: newStart, faceVerts: newVerts, parentFace: newParent },
    tags: { crease, pinned },
  };
}

/** The finer net's points from the coarser net's points `p`. */
function ccPositions(plan: CcPlan, p: ArrayLike<number>) {
  const { topo, sharp, kind, faceOfCorner } = plan;
  const { nv, nf, ne } = topo;
  const { faceStart, faceVerts } = plan.source;
  const out = new Float64Array((nv + ne + nf) * 3);

  const facePoint = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f += 1) {
    const s = faceStart[f];
    const n = faceStart[f + 1] - s;
    let x = 0, y = 0, z = 0;
    for (let c = s; c < s + n; c += 1) {
      const v = faceVerts[c];
      x += p[v * 3]; y += p[v * 3 + 1]; z += p[v * 3 + 2];
    }
    facePoint[f * 3] = x / n; facePoint[f * 3 + 1] = y / n; facePoint[f * 3 + 2] = z / n;
    const o = (nv + ne + f) * 3;
    out[o] = facePoint[f * 3]; out[o + 1] = facePoint[f * 3 + 1]; out[o + 2] = facePoint[f * 3 + 2];
  }

  for (let e = 0; e < ne; e += 1) {
    const a = topo.edgeA[e];
    const b = topo.edgeB[e];
    const o = (nv + e) * 3;
    for (let k = 0; k < 3; k += 1) {
      const mid = (p[a * 3 + k] + p[b * 3 + k]) / 2;
      out[o + k] = sharp[e]
        ? mid
        : (p[a * 3 + k] + p[b * 3 + k] + facePoint[topo.edgeFace0[e] * 3 + k] + facePoint[topo.edgeFace1[e] * 3 + k]) / 4;
    }
  }

  for (let v = 0; v < nv; v += 1) {
    const o = v * 3;
    if (kind.fixed[v]) {
      out[o] = p[o]; out[o + 1] = p[o + 1]; out[o + 2] = p[o + 2];
      continue;
    }
    if (kind.creaseCount[v] === 2) {
      const c1 = kind.creaseNeighbours[v * 2];
      const c2 = kind.creaseNeighbours[v * 2 + 1];
      for (let k = 0; k < 3; k += 1) out[o + k] = (p[c1 * 3 + k] + 6 * p[o + k] + p[c2 * 3 + k]) / 8;
      continue;
    }
    const n = topo.vertEdgeStart[v + 1] - topo.vertEdgeStart[v];
    const faces = topo.vertFaceStart[v + 1] - topo.vertFaceStart[v];
    if (n < 3 || faces === 0) {
      out[o] = p[o]; out[o + 1] = p[o + 1]; out[o + 2] = p[o + 2];
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      let fSum = 0;
      for (let i = topo.vertFaceStart[v]; i < topo.vertFaceStart[v + 1]; i += 1) fSum += facePoint[faceOfCorner[topo.vertCorners[i]] * 3 + k];
      let rSum = 0;
      for (let i = topo.vertEdgeStart[v]; i < topo.vertEdgeStart[v + 1]; i += 1) {
        const e = topo.vertEdges[i];
        rSum += (p[topo.edgeA[e] * 3 + k] + p[topo.edgeB[e] * 3 + k]) / 2;
      }
      out[o + k] = (fSum / faces + (2 * rSum) / n + (n - 3) * p[o + k]) / n;
    }
  }
  return out;
}

/** One Catmull-Clark step. Every face becomes quads; old points keep their index. */
export function ccStep(mesh: PolyMesh, tags: CreaseTags): { mesh: PolyMesh; tags: CreaseTags } {
  const plan = ccPlan(mesh, tags);
  return { mesh: { ...plan.mesh, positions: ccPositions(plan, mesh.positions) }, tags: plan.tags };
}

// ---------------------------------------------------------------------------
// Limit surface and pulled points

type LimitStencil = {
  topo: Topology;
  kind: VertexKind;
  /** Per vertex: edge neighbours and diagonal corners (quads only). */
  ringStart: Uint32Array;
  edgeRing: Uint32Array;
  diagStart: Uint32Array;
  diagRing: Uint32Array;
};

function limitStencil(mesh: PolyMesh, tags: CreaseTags): LimitStencil {
  const topo = buildTopology(mesh);
  const sharp = sharpEdges(topo, tags);
  const kind = classify(mesh, topo, tags, sharp);
  const { nv } = topo;
  const ringStart = new Uint32Array(nv + 1);
  const edgeRing: number[] = [];
  const diagStart = new Uint32Array(nv + 1);
  const diagRing: number[] = [];
  const faceOfCorner = cornerFaces(mesh);
  for (let v = 0; v < nv; v += 1) {
    for (let i = topo.vertEdgeStart[v]; i < topo.vertEdgeStart[v + 1]; i += 1) {
      const e = topo.vertEdges[i];
      edgeRing.push(topo.edgeA[e] === v ? topo.edgeB[e] : topo.edgeA[e]);
    }
    ringStart[v + 1] = edgeRing.length;
    for (let i = topo.vertFaceStart[v]; i < topo.vertFaceStart[v + 1]; i += 1) {
      const c = topo.vertCorners[i];
      const f = faceOfCorner[c];
      const s = mesh.faceStart[f];
      const n = mesh.faceStart[f + 1] - s;
      if (n === 4) diagRing.push(mesh.faceVerts[s + ((c - s + 2) % 4)]);
    }
    diagStart[v + 1] = diagRing.length;
  }
  return { topo, kind, ringStart, edgeRing: Uint32Array.from(edgeRing), diagStart, diagRing: Uint32Array.from(diagRing) };
}

/** Where point v lands on the infinitely smooth surface (quad-net masks). */
function limitOf(st: LimitStencil, p: ArrayLike<number>, v: number, out: Float64Array, o: number) {
  const { kind } = st;
  if (kind.fixed[v]) {
    out[o] = p[v * 3]; out[o + 1] = p[v * 3 + 1]; out[o + 2] = p[v * 3 + 2];
    return;
  }
  if (kind.creaseCount[v] === 2) {
    const c1 = kind.creaseNeighbours[v * 2];
    const c2 = kind.creaseNeighbours[v * 2 + 1];
    for (let k = 0; k < 3; k += 1) out[o + k] = (p[c1 * 3 + k] + 4 * p[v * 3 + k] + p[c2 * 3 + k]) / 6;
    return;
  }
  const n = st.ringStart[v + 1] - st.ringStart[v];
  const diagonals = st.diagStart[v + 1] - st.diagStart[v];
  if (n < 3 || diagonals !== n) {
    out[o] = p[v * 3]; out[o + 1] = p[v * 3 + 1]; out[o + 2] = p[v * 3 + 2];
    return;
  }
  for (let k = 0; k < 3; k += 1) {
    let e = 0;
    for (let i = st.ringStart[v]; i < st.ringStart[v + 1]; i += 1) e += p[st.edgeRing[i] * 3 + k];
    let d = 0;
    for (let i = st.diagStart[v]; i < st.diagStart[v + 1]; i += 1) d += p[st.diagRing[i] * 3 + k];
    out[o + k] = (n * n * p[v * 3 + k] + 4 * e + d) / (n * (n + 5));
  }
}

/** How far the limit point moves when its own control point moves by one. */
function limitSelfWeight(st: LimitStencil, v: number) {
  if (st.kind.fixed[v]) return 1;
  if (st.kind.creaseCount[v] === 2) return 4 / 6;
  const n = st.ringStart[v + 1] - st.ringStart[v];
  const diagonals = st.diagStart[v + 1] - st.diagStart[v];
  if (n < 3 || diagonals !== n) return 1;
  return n / (n + 5);
}

/** The limit masks of a net, worked out once: a drag only moves points, never rejoins them. */
export type NetStencil = LimitStencil;

export function netStencil(mesh: PolyMesh, tags: CreaseTags): NetStencil {
  return limitStencil(mesh, tags);
}

export function limitPositions(mesh: PolyMesh, tags: CreaseTags, stencil?: NetStencil) {
  const st = stencil ?? limitStencil(mesh, tags);
  const out = new Float64Array(mesh.positions.length);
  for (let v = 0; v < st.topo.nv; v += 1) limitOf(st, mesh.positions, v, out, v * 3);
  return out;
}

/** Move every point onto the limit surface, so even a coarse level shows the true shape. */
export function limitProject(mesh: PolyMesh, tags: CreaseTags): PolyMesh {
  return { ...mesh, positions: limitPositions(mesh, tags) };
}

/**
 * Move hidden control points so the smooth surface passes exactly through each target.
 * Untargeted points keep their place, so the rest of the surface stays plain
 * Catmull-Clark and nothing ripples.
 */
export function applyTugs(mesh: PolyMesh, tags: CreaseTags, targets: Map<number, Vec3>, stencil?: NetStencil): PolyMesh {
  if (targets.size === 0) return mesh;
  const st = stencil ?? limitStencil(mesh, tags);
  const p = Float64Array.from(mesh.positions);
  const limit = new Float64Array(3);
  for (let sweep = 0; sweep < 24; sweep += 1) {
    let worst = 0;
    for (const [v, target] of targets) {
      limitOf(st, p, v, limit, 0);
      const gain = 1 / limitSelfWeight(st, v);
      for (let k = 0; k < 3; k += 1) {
        const r = target[k] - limit[k];
        worst = Math.max(worst, Math.abs(r));
        // A fixed point is its own limit, so it simply goes to the target.
        p[v * 3 + k] += (st.kind.fixed[v] ? 1 : 0.9) * gain * r;
      }
    }
    if (worst < 1e-9) break;
  }
  return { ...mesh, positions: p };
}

/**
 * Soft pull: points within `radius` (measured along the surface) follow the dragged
 * ones, fading out smoothly. Returns each affected point's share of the pull.
 */
export function softWeights(mesh: PolyMesh, seeds: number[], radius: number, along: ArrayLike<number> = mesh.positions) {
  const weights = new Map<number, number>();
  for (const seed of seeds) weights.set(seed, 1);
  if (!(radius > 0)) return weights;
  const topo = buildTopology(mesh);
  const dist = new Float64Array(topo.nv).fill(Infinity);
  const heap: [number, number][] = [];
  const push = (d: number, v: number) => {
    heap.push([d, v]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const seed of seeds) {
    dist[seed] = 0;
    push(0, seed);
  }
  while (heap.length > 0) {
    const [d, v] = pop();
    if (d > dist[v] || d >= radius) continue;
    for (let i = topo.vertEdgeStart[v]; i < topo.vertEdgeStart[v + 1]; i += 1) {
      const e = topo.vertEdges[i];
      const u = topo.edgeA[e] === v ? topo.edgeB[e] : topo.edgeA[e];
      const step = Math.hypot(along[u * 3] - along[v * 3], along[u * 3 + 1] - along[v * 3 + 1], along[u * 3 + 2] - along[v * 3 + 2]);
      if (d + step < dist[u]) {
        dist[u] = d + step;
        push(d + step, u);
      }
    }
  }
  for (let v = 0; v < topo.nv; v += 1) {
    if (dist[v] >= radius || weights.has(v)) continue;
    const t = 1 - dist[v] / radius;
    weights.set(v, t * t * (3 - 2 * t));
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Triangles out

/**
 * Quads to triangles across the shorter diagonal, with normals that are smooth across
 * the surface but stay sharp at creases (faces more than 40° apart are not averaged).
 */
export function triangulateSmooth(mesh: PolyMesh): { positions: number[]; normals: number[] } {
  return triangulateWith(faceRings(mesh), mesh.positions);
}

/** Faces around each point, for averaging normals. */
type FaceRings = { mesh: PolyMesh; vertFaceStart: Uint32Array; vertFaces: Uint32Array };

function faceRings(mesh: PolyMesh): FaceRings {
  const { faceStart, faceVerts } = mesh;
  const nf = faceCount(mesh);
  const nv = vertexCount(mesh);
  const vertFaceStart = new Uint32Array(nv + 1);
  for (let c = 0; c < faceVerts.length; c += 1) vertFaceStart[faceVerts[c] + 1] += 1;
  for (let v = 0; v < nv; v += 1) vertFaceStart[v + 1] += vertFaceStart[v];
  const vertFaces = new Uint32Array(faceVerts.length);
  const fill = vertFaceStart.slice(0, nv);
  for (let f = 0; f < nf; f += 1) {
    for (let c = faceStart[f]; c < faceStart[f + 1]; c += 1) vertFaces[fill[faceVerts[c]]++] = f;
  }
  return { mesh, vertFaceStart, vertFaces };
}

function triangulateWith(rings: FaceRings, p: ArrayLike<number>): { positions: number[]; normals: number[] } {
  const { faceStart, faceVerts } = rings.mesh;
  const { vertFaceStart, vertFaces } = rings;
  const nf = faceCount(rings.mesh);
  const faceNormal = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f += 1) {
    const s = faceStart[f];
    const n = faceStart[f + 1] - s;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i += 1) {
      const a = faceVerts[s + i];
      const b = faceVerts[s + ((i + 1) % n)];
      x += (p[a * 3 + 1] - p[b * 3 + 1]) * (p[a * 3 + 2] + p[b * 3 + 2]);
      y += (p[a * 3 + 2] - p[b * 3 + 2]) * (p[a * 3] + p[b * 3]);
      z += (p[a * 3] - p[b * 3]) * (p[a * 3 + 1] + p[b * 3 + 1]);
    }
    faceNormal[f * 3] = x; faceNormal[f * 3 + 1] = y; faceNormal[f * 3 + 2] = z;
  }
  const cosSplit = Math.cos((40 * Math.PI) / 180);
  const unit = new Float64Array(nf * 3);
  for (let f = 0; f < nf; f += 1) {
    const len = Math.hypot(faceNormal[f * 3], faceNormal[f * 3 + 1], faceNormal[f * 3 + 2]) || 1;
    unit[f * 3] = faceNormal[f * 3] / len; unit[f * 3 + 1] = faceNormal[f * 3 + 1] / len; unit[f * 3 + 2] = faceNormal[f * 3 + 2] / len;
  }
  let triangles = 0;
  for (let f = 0; f < nf; f += 1) triangles += faceStart[f + 1] - faceStart[f] - 2;
  const positions: number[] = new Array(triangles * 9);
  const normals: number[] = new Array(triangles * 9);
  let o = 0;
  const emit = (f: number, a: number, b: number, c: number) => {
    for (const v of [a, b, c]) {
      positions[o] = p[v * 3]; positions[o + 1] = p[v * 3 + 1]; positions[o + 2] = p[v * 3 + 2];
      // The faces round the point that are near this one's facing: across a crease they are not averaged.
      let x = 0, y = 0, z = 0;
      for (let i = vertFaceStart[v]; i < vertFaceStart[v + 1]; i += 1) {
        const g = vertFaces[i];
        if (unit[g * 3] * unit[f * 3] + unit[g * 3 + 1] * unit[f * 3 + 1] + unit[g * 3 + 2] * unit[f * 3 + 2] < cosSplit) continue;
        x += faceNormal[g * 3]; y += faceNormal[g * 3 + 1]; z += faceNormal[g * 3 + 2];
      }
      const len = Math.hypot(x, y, z) || 1;
      normals[o] = x / len; normals[o + 1] = y / len; normals[o + 2] = z / len;
      o += 3;
    }
  };
  for (let f = 0; f < nf; f += 1) {
    const s = faceStart[f];
    const n = faceStart[f + 1] - s;
    if (n === 4) {
      const a = faceVerts[s], b = faceVerts[s + 1], c = faceVerts[s + 2], d = faceVerts[s + 3];
      const ac = Math.hypot(p[a * 3] - p[c * 3], p[a * 3 + 1] - p[c * 3 + 1], p[a * 3 + 2] - p[c * 3 + 2]);
      const bd = Math.hypot(p[b * 3] - p[d * 3], p[b * 3 + 1] - p[d * 3 + 1], p[b * 3 + 2] - p[d * 3 + 2]);
      if (ac <= bd) {
        emit(f, a, b, c);
        emit(f, a, c, d);
      } else {
        emit(f, a, b, d);
        emit(f, b, c, d);
      }
      continue;
    }
    for (let i = 1; i + 1 < n; i += 1) emit(f, faceVerts[s], faceVerts[s + i], faceVerts[s + i + 1]);
  }
  return { positions, normals };
}

// ---------------------------------------------------------------------------
// The whole build

export type SmoothNetOptions = {
  /** Keep the faces lying on the lowest plane flat (their rim becomes a crease). */
  keepBottomFlat: boolean;
  /** Crease the part's own edges, so the net starts on the shape exactly. */
  keepEdges?: boolean;
  /** Extra subdivisions of the net before pulling: more points to grab, less shrink. */
  detail: number;
  /** Pulled points, world space. `at` is the point's net position before any pull at its detail. */
  tugs: SmoothPointTug[];
  /** Sharp edges made by hand, found by their end points' unpulled places. */
  creases?: SmoothEdgeCrease[];
  /** Flat faces that stay exactly as they are, each found by a spot on it. */
  keepFaces?: Vec3[];
  /** How close a stored pull must be to a net point to still belong to it. */
  matchTol?: number;
};

export type SmoothNet = {
  /** The net with the pulls applied. */
  net: PolyMesh;
  tags: CreaseTags;
  /**
   * The net's points as they would be with no pulls at all: the keys new pulls are stored
   * under. They depend only on the parts, so pulls are found again after the rough shape changes.
   */
  keys: Float64Array;
  /** Where the surface passes at the final detail before that detail's own pulls. */
  before: Float64Array;
  /** Points that were already there one detail down (they come first); 0 at the lowest detail. */
  coarseCount: number;
  /** Sharp edges that still matched two neighbouring points. */
  creasesApplied: SmoothEdgeCrease[];
  /** Each applied sharp edge's two points; a point keeps its number at every finer detail. */
  creaseEnds: [number, number][];
  /** Where the final detail's pulls put their points, by net point. */
  targets: Map<number, Vec3>;
  /** Pulls that still matched a point. */
  applied: SmoothPointTug[];
  /** Pulls made at a finer detail than this build: kept for when the detail goes back up. */
  resting: SmoothPointTug[];
  dropped: number;
  /** Pulls on a kept face, removed. */
  heldBack: number;
  /** Net points on a kept face (1), which pulls leave alone. */
  locked: Uint8Array;
};

/** Crease the rim of the faces lying flat on the lowest plane. */
export function bottomCreases(mesh: PolyMesh): CreaseTags {
  const tags = emptyTags(mesh);
  const nv = vertexCount(mesh);
  const nf = faceCount(mesh);
  let minY = Infinity;
  let maxExtent = 0;
  for (let v = 0; v < nv; v += 1) minY = Math.min(minY, mesh.positions[v * 3 + 1]);
  for (let v = 0; v < nv; v += 1) maxExtent = Math.max(maxExtent, mesh.positions[v * 3 + 1] - minY);
  const tol = 0.01 + maxExtent * 1e-6;
  const bottom = new Uint8Array(nf);
  let any = false;
  for (let f = 0; f < nf; f += 1) {
    let flat = true;
    for (let c = mesh.faceStart[f]; c < mesh.faceStart[f + 1]; c += 1) {
      if (mesh.positions[mesh.faceVerts[c] * 3 + 1] - minY > tol) {
        flat = false;
        break;
      }
    }
    if (flat) {
      bottom[f] = 1;
      any = true;
    }
  }
  if (!any) return tags;
  const topo = buildTopology(mesh);
  for (let e = 0; e < topo.ne; e += 1) {
    const f0 = topo.edgeFace0[e];
    const f1 = topo.edgeFace1[e];
    if (f0 < 0 || f1 < 0) continue;
    if (bottom[f0] !== bottom[f1]) tags.crease.add(edgeKey(topo.edgeA[e], topo.edgeB[e], nv));
  }
  return tags;
}

/** Folds sharper than this between neighbouring faces are the part's own edges. */
const EDGE_FOLD_DEGREES = 30;

/** Crease the part's own edges: where neighbouring faces meet at a fold, not along a curve. */
export function featureCreases(mesh: PolyMesh, tags: CreaseTags = emptyTags(mesh)): CreaseTags {
  const nv = vertexCount(mesh);
  const normals = new Float64Array(faceCount(mesh) * 3);
  for (let f = 0; f < faceCount(mesh); f += 1) {
    const s = mesh.faceStart[f];
    const n = mesh.faceStart[f + 1] - s;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i += 1) {
      const a = mesh.faceVerts[s + i] * 3;
      const b = mesh.faceVerts[s + ((i + 1) % n)] * 3;
      const p = mesh.positions;
      x += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
      y += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
      z += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
    }
    const length = Math.hypot(x, y, z) || 1;
    normals[f * 3] = x / length;
    normals[f * 3 + 1] = y / length;
    normals[f * 3 + 2] = z / length;
  }
  const limit = Math.cos((EDGE_FOLD_DEGREES * Math.PI) / 180);
  const crease = new Set(tags.crease);
  const topo = buildTopology(mesh);
  for (let e = 0; e < topo.ne; e += 1) {
    const f0 = topo.edgeFace0[e];
    const f1 = topo.edgeFace1[e];
    if (f0 < 0 || f1 < 0) continue;
    const dot = normals[f0 * 3] * normals[f1 * 3] + normals[f0 * 3 + 1] * normals[f1 * 3 + 1] + normals[f0 * 3 + 2] * normals[f1 * 3 + 2];
    if (dot < limit) crease.add(edgeKey(topo.edgeA[e], topo.edgeB[e], nv));
  }
  return { ...tags, crease };
}

/** Unit normal (Newell) and plane offset of each face. */
function facePlanes(mesh: PolyMesh) {
  const nf = faceCount(mesh);
  const normals = new Float64Array(nf * 3);
  const offsets = new Float64Array(nf);
  const p = mesh.positions;
  for (let f = 0; f < nf; f += 1) {
    const s = mesh.faceStart[f];
    const n = mesh.faceStart[f + 1] - s;
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i += 1) {
      const a = mesh.faceVerts[s + i] * 3;
      const b = mesh.faceVerts[s + ((i + 1) % n)] * 3;
      x += (p[a + 1] - p[b + 1]) * (p[a + 2] + p[b + 2]);
      y += (p[a + 2] - p[b + 2]) * (p[a] + p[b]);
      z += (p[a] - p[b]) * (p[a + 1] + p[b + 1]);
    }
    const len = Math.hypot(x, y, z) || 1;
    normals[f * 3] = x / len; normals[f * 3 + 1] = y / len; normals[f * 3 + 2] = z / len;
    const v = mesh.faceVerts[s] * 3;
    offsets[f] = normals[f * 3] * p[v] + normals[f * 3 + 1] * p[v + 1] + normals[f * 3 + 2] * p[v + 2];
  }
  return { normals, offsets };
}

function faceCentroid(mesh: PolyMesh, f: number): Vec3 {
  const s = mesh.faceStart[f];
  const n = mesh.faceStart[f + 1] - s;
  const c: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const v = mesh.faceVerts[s + i] * 3;
    c[0] += mesh.positions[v]; c[1] += mesh.positions[v + 1]; c[2] += mesh.positions[v + 2];
  }
  return [c[0] / n, c[1] / n, c[2] / n];
}

/** A spot on face f's plane lies inside it: faces fan out from their middle without folding. */
function insideFace(mesh: PolyMesh, f: number, at: Vec3, normal: Vec3, tol: number) {
  const s = mesh.faceStart[f];
  const n = mesh.faceStart[f + 1] - s;
  const c = faceCentroid(mesh, f);
  const side = (from: Vec3, to: Vec3) => {
    const edge = sub(to, from);
    return dot(cross(edge, sub(at, from)), normal) >= -tol * (length(edge) || 1);
  };
  for (let i = 0; i < n; i += 1) {
    const a = point(mesh.positions, mesh.faceVerts[s + i]);
    const b = point(mesh.positions, mesh.faceVerts[s + ((i + 1) % n)]);
    if (side(c, a) && side(a, b) && side(b, c)) return true;
  }
  return false;
}

/**
 * The flat face of the part under a spot: the face `at` lies on, and every face joined to
 * it in the same plane (a flat face with a hole in it is several faces).
 */
export function flatFaceAt(base: PolyMesh, at: Vec3, tol: number): number[] {
  const { normals, offsets } = facePlanes(base);
  const nf = faceCount(base);
  let seed = -1;
  for (let f = 0; f < nf && seed < 0; f += 1) {
    const normal: Vec3 = [normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2]];
    if (Math.abs(dot(normal, at) - offsets[f]) <= tol && insideFace(base, f, at, normal, tol)) seed = f;
  }
  if (seed < 0) return [];
  const topo = buildTopology(base);
  const cosTol = Math.cos((1 * Math.PI) / 180);
  const region = new Set([seed]);
  const queue = [seed];
  while (queue.length > 0) {
    const f = queue.pop()!;
    for (let c = base.faceStart[f]; c < base.faceStart[f + 1]; c += 1) {
      const e = topo.cornerEdge[c];
      const g = topo.edgeFace0[e] === f ? topo.edgeFace1[e] : topo.edgeFace0[e];
      if (g < 0 || region.has(g)) continue;
      const same = normals[f * 3] * normals[g * 3] + normals[f * 3 + 1] * normals[g * 3 + 1] + normals[f * 3 + 2] * normals[g * 3 + 2];
      if (same < cosTol || Math.abs(offsets[f] - offsets[g]) > tol) continue;
      region.add(g);
      queue.push(g);
    }
  }
  return [...region];
}

/**
 * The part's face nearest a spot on the smooth surface, facing `toward` (the camera), and
 * a spot on that face to find it by. The smooth surface may sit off the face, so the
 * nearest face wins rather than one the spot lies on.
 */
export function nearestFlatFace(base: PolyMesh, spot: Vec3, toward: Vec3): { at: Vec3; faces: number[] } | null {
  const { normals, offsets } = facePlanes(base);
  const tol = 1e-4 + meshExtent(base) * 1e-6;
  let best: { distance: number; at: Vec3 } | null = null;
  for (let f = 0; f < faceCount(base); f += 1) {
    const normal: Vec3 = [normals[f * 3], normals[f * 3 + 1], normals[f * 3 + 2]];
    if (dot(normal, toward) <= 0) continue;
    const off = dot(normal, spot) - offsets[f];
    const onPlane: Vec3 = [spot[0] - off * normal[0], spot[1] - off * normal[1], spot[2] - off * normal[2]];
    let distance = Math.abs(off);
    let at = onPlane;
    if (!insideFace(base, f, onPlane, normal, tol)) {
      // Outside the face: how far to its nearest edge, and found again by its middle.
      const s = base.faceStart[f];
      const n = base.faceStart[f + 1] - s;
      let edge = Infinity;
      for (let i = 0; i < n; i += 1) {
        const a = point(base.positions, base.faceVerts[s + i]);
        const ab = sub(point(base.positions, base.faceVerts[s + ((i + 1) % n)]), a);
        const t = Math.max(0, Math.min(1, dot(sub(spot, a), ab) / (dot(ab, ab) || 1)));
        edge = Math.min(edge, length(sub(spot, [a[0] + t * ab[0], a[1] + t * ab[1], a[2] + t * ab[2]])));
      }
      distance = edge;
      at = faceCentroid(base, f);
    }
    if (!best || distance < best.distance) best = { distance, at };
  }
  if (!best) return null;
  return { at: best.at, faces: flatFaceAt(base, best.at, tol) };
}

/** Kept faces: their rim is sharp and their corners stay put, so they come out exactly flat. */
function keptFaceTags(base: PolyMesh, kept: Uint8Array, tags: CreaseTags): CreaseTags {
  const nv = vertexCount(base);
  const crease = new Set(tags.crease);
  const pinned = Uint8Array.from(tags.pinned);
  const topo = buildTopology(base);
  for (let e = 0; e < topo.ne; e += 1) {
    const f0 = topo.edgeFace0[e];
    const f1 = topo.edgeFace1[e];
    if (f0 >= 0 && f1 >= 0 && kept[f0] !== kept[f1]) crease.add(edgeKey(topo.edgeA[e], topo.edgeB[e], nv));
  }
  for (let f = 0; f < faceCount(base); f += 1) {
    if (!kept[f]) continue;
    for (let c = base.faceStart[f]; c < base.faceStart[f + 1]; c += 1) pinned[base.faceVerts[c]] = 1;
  }
  return { crease, pinned };
}

/** Net points on or around a kept face: pulls leave them alone. */
function pointsOnKeptFaces(net: PolyMesh, kept: Uint8Array) {
  const locked = new Uint8Array(vertexCount(net));
  for (let f = 0; f < faceCount(net); f += 1) {
    if (!kept[net.parentFace[f]]) continue;
    for (let c = net.faceStart[f]; c < net.faceStart[f + 1]; c += 1) locked[net.faceVerts[c]] = 1;
  }
  return locked;
}

export function hasFlatBottom(mesh: PolyMesh) {
  return bottomCreases(mesh).crease.size > 0;
}

/** Points of `positions` within `tol` of each key, through a grid hash. */
export function matchPoints(positions: ArrayLike<number>, keys: Vec3[], tol: number): number[] {
  const nearest = pointMatcher(positions, tol);
  return keys.map(([x, y, z]) => nearest(x, y, z));
}

/** Finds the point within `tol` of a spot, from a grid built once. */
function pointMatcher(positions: ArrayLike<number>, tol: number) {
  const cell = Math.max(tol * 4, 1e-6);
  const grid = new Map<string, number[]>();
  const cellKey = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let v = 0; v < positions.length / 3; v += 1) {
    const key = cellKey(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    const list = grid.get(key);
    if (list) list.push(v);
    else grid.set(key, [v]);
  }
  return (x: number, y: number, z: number) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bestDist = tol;
    for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) for (let dz = -1; dz <= 1; dz += 1) {
      for (const v of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const d = Math.hypot(positions[v * 3] - x, positions[v * 3 + 1] - y, positions[v * 3 + 2] - z);
        if (d <= bestDist) {
          best = v;
          bestDist = d;
        }
      }
    }
    return best;
  };
}

/** Flat faces → first Catmull-Clark step → extra detail, applying the sharp edges and pulls made at each detail. */
export function buildSmoothNet(base: PolyMesh, options: SmoothNetOptions): SmoothNet {
  const bottomTags = options.keepBottomFlat ? bottomCreases(base) : emptyTags(base);
  const edgeTags = options.keepEdges ? featureCreases(base, bottomTags) : bottomTags;
  const extent = meshExtent(base);
  const kept = new Uint8Array(faceCount(base));
  for (const at of options.keepFaces ?? []) {
    for (const f of flatFaceAt(base, at, 1e-4 + extent * 1e-6)) kept[f] = 1;
  }
  const keepsFaces = kept.includes(1);
  const baseTags = keepsFaces ? keptFaceTags(base, kept, edgeTags) : edgeTags;
  let { mesh: net, tags } = ccStep(base, baseTags);
  // The same net with nothing pulled or sharpened: where every point is keyed.
  let rest = { mesh: net, tags };
  const tol = options.matchTol ?? Math.max(1e-3, extent * 1e-5);
  const applied: SmoothPointTug[] = [];
  const creasesApplied: SmoothEdgeCrease[] = [];
  const creaseEnds: [number, number][] = [];
  let targets = new Map<number, Vec3>();
  let dropped = 0;
  let heldBack = 0;
  const detail = Math.max(0, Math.min(2, Math.round(options.detail)));
  let keys = Float64Array.from(net.positions);
  let before = limitPositions(net, tags);
  let coarseCount = 0;
  for (let d = 0; d <= detail; d += 1) {
    keys = Float64Array.from(rest.mesh.positions);
    const sharp = (options.creases ?? []).filter((crease) => crease.detail === d);
    if (sharp.length > 0) {
      const ends = matchPoints(keys, sharp.flatMap((crease) => [crease.a, crease.b]), tol);
      const nv = vertexCount(net);
      const edges = new Set<number>();
      const list = netEdges(net);
      for (let i = 0; i < list.length; i += 2) edges.add(edgeKey(list[i], list[i + 1], nv));
      const crease = new Set(tags.crease);
      sharp.forEach((entry, i) => {
        const a = ends[i * 2];
        const b = ends[i * 2 + 1];
        if (a < 0 || b < 0 || !edges.has(edgeKey(a, b, nv))) return;
        if (entry.smooth) crease.delete(edgeKey(a, b, nv));
        else crease.add(edgeKey(a, b, nv));
        creasesApplied.push(entry);
        creaseEnds.push([a, b]);
      });
      tags = { ...tags, crease };
    }
    before = limitPositions(net, tags);
    const here = options.tugs.filter((tug) => tug.detail === d);
    targets = new Map();
    if (here.length > 0) {
      const locked = keepsFaces ? pointsOnKeptFaces(net, kept) : null;
      const matched = matchPoints(keys, here.map((tug) => tug.at), tol);
      // Pulls stored before keys ignored the pulls below them.
      const pulledKeys = d > 0 && matched.some((v) => v < 0) ? matchPoints(net.positions, here.map((tug) => tug.at), tol) : null;
      here.forEach((tug, i) => {
        const v = matched[i] >= 0 ? matched[i] : pulledKeys?.[i] ?? -1;
        if (v < 0) {
          dropped += 1;
          return;
        }
        if (locked?.[v]) {
          heldBack += 1;
          return;
        }
        const target: Vec3 = tug.from
          ? [before[v * 3] + tug.to[0] - tug.from[0], before[v * 3 + 1] + tug.to[1] - tug.from[1], before[v * 3 + 2] + tug.to[2] - tug.from[2]]
          : tug.to;
        targets.set(v, target);
        applied.push(tug);
      });
      net = applyTugs(net, tags, targets);
    }
    if (d < detail) {
      coarseCount = vertexCount(net);
      const next = ccStep(net, tags);
      net = next.mesh;
      tags = next.tags;
      rest = ccStep(rest.mesh, rest.tags);
    }
  }
  const resting = options.tugs.filter((tug) => tug.detail > detail);
  const locked = keepsFaces ? pointsOnKeptFaces(net, kept) : new Uint8Array(vertexCount(net));
  return { net, tags, keys, before, coarseCount, creasesApplied, creaseEnds, targets, applied, resting, dropped, heldBack, locked };
}

/** Subdivide the net to the chosen level and put it on the limit surface. */
export function finishSmooth(net: PolyMesh, tags: CreaseTags, level: number) {
  return runSmoothPlan(planSmooth(net, tags, level), net.positions);
}

/** Everything `finishSmooth` works out from how the net is joined, so a drag only redoes the positions. */
export type SmoothPlan = { steps: CcPlan[]; stencil: LimitStencil; rings: FaceRings };

export function planSmooth(net: PolyMesh, tags: CreaseTags, level: number): SmoothPlan {
  const steps: CcPlan[] = [];
  let mesh = net;
  let t = tags;
  for (let i = 1; i < level; i += 1) {
    const step = ccPlan(mesh, t);
    steps.push(step);
    mesh = step.mesh;
    t = step.tags;
  }
  return { steps, stencil: limitStencil(mesh, t), rings: faceRings(mesh) };
}

/** The finished surface for net points `positions`, joined as when the plan was made. */
export function runSmoothPlan(plan: SmoothPlan, positions: ArrayLike<number>) {
  let p: ArrayLike<number> = positions;
  for (const step of plan.steps) p = ccPositions(step, p);
  const limit = new Float64Array(p.length);
  for (let v = 0; v < plan.stencil.topo.nv; v += 1) limitOf(plan.stencil, p, v, limit, v * 3);
  return triangulateWith(plan.rings, limit);
}

export function meshExtent(mesh: PolyMesh) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], mesh.positions[i + k]);
      max[k] = Math.max(max[k], mesh.positions[i + k]);
    }
  }
  return Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0);
}

/** Quads a level makes from this net. */
export function predictQuads(net: PolyMesh, level: number) {
  return (net.faceVerts.length / 4) * 4 ** Math.max(0, level - 1);
}

/** The highest level up to `level` whose triangles fit under the cap. */
export function clampSmoothLevel(net: PolyMesh, level: number, triangleCap: number) {
  let chosen = Math.max(1, Math.min(3, Math.round(level)));
  while (chosen > 1 && predictQuads(net, chosen) * 2 > triangleCap) chosen -= 1;
  return chosen;
}

/** The net's edges as index pairs, for drawing. */
export function netEdges(mesh: PolyMesh) {
  const topo = buildTopology(mesh);
  const out = new Uint32Array(topo.ne * 2);
  for (let e = 0; e < topo.ne; e += 1) {
    out[e * 2] = topo.edgeA[e];
    out[e * 2 + 1] = topo.edgeB[e];
  }
  return out;
}

/**
 * Each point's twin across the middle of the points, mirrored along `normal` (a unit
 * direction), or -1 where the shape is not symmetric. A point on the middle is its own twin.
 * Points without an exact twin take the nearest point within `nearTol`, so a surface whose
 * points are not laid out evenly still mirrors.
 */
export function mirrorPartners(keys: ArrayLike<number>, normal: Vec3, tol: number, nearTol = 0): Int32Array {
  const n = keys.length / 3;
  const along = (v: number) => keys[v * 3] * normal[0] + keys[v * 3 + 1] * normal[1] + keys[v * 3 + 2] * normal[2];
  let min = Infinity;
  let max = -Infinity;
  for (let v = 0; v < n; v += 1) {
    min = Math.min(min, along(v));
    max = Math.max(max, along(v));
  }
  const middle = (min + max) / 2;
  const mirrored: Vec3[] = [];
  for (let v = 0; v < n; v += 1) {
    const step = 2 * (middle - along(v));
    mirrored.push([keys[v * 3] + step * normal[0], keys[v * 3 + 1] + step * normal[1], keys[v * 3 + 2] + step * normal[2]]);
  }
  const twins = Int32Array.from(matchPoints(keys, mirrored, tol));
  if (nearTol > tol) {
    const missing: number[] = [];
    for (let v = 0; v < n; v += 1) if (twins[v] < 0) missing.push(v);
    const near = matchPoints(keys, missing.map((v) => mirrored[v]), nearTol);
    missing.forEach((v, i) => { twins[v] = near[i]; });
  }
  return twins;
}

/**
 * Twins for Mirror, across whichever middle line suits the shape: the grid's own axis, or
 * the sides of a part turned by one of `turns` (degrees about the vertical). The line that
 * pairs the most points wins, nearest `axis` (0 for left to right, 2 for front to back) on a tie.
 */
export function findMirrorPartners(keys: ArrayLike<number>, axis: 0 | 2, turns: number[], tol: number, nearTol = 0) {
  const angles = new Set<number>();
  for (const turn of [0, ...turns]) {
    for (const quarter of [0, 90]) for (const sign of [1, -1]) {
      angles.add(Math.round((((sign * turn + quarter) % 180) + 180) % 180 * 1000) / 1000);
    }
  }
  const want = axis === 0 ? 0 : 90;
  // Each line is tried on a sample of the points, so fine nets stay quick.
  const n = keys.length / 3;
  const stride = Math.max(1, Math.ceil(n / 3000));
  const nearest = pointMatcher(keys, tol);
  const middleOf = (normal: Vec3) => {
    let min = Infinity;
    let max = -Infinity;
    for (let v = 0; v < n; v += 1) {
      const d = keys[v * 3] * normal[0] + keys[v * 3 + 1] * normal[1] + keys[v * 3 + 2] * normal[2];
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return (min + max) / 2;
  };
  let best: { normal: Vec3; paired: number; off: number } | null = null;
  for (const angle of angles) {
    const rad = (angle * Math.PI) / 180;
    const normal: Vec3 = [Math.cos(rad), 0, Math.sin(rad)];
    const middle = middleOf(normal);
    let paired = 0;
    for (let v = 0; v < n; v += stride) {
      const step = 2 * (middle - (keys[v * 3] * normal[0] + keys[v * 3 + 1] * normal[1] + keys[v * 3 + 2] * normal[2]));
      if (nearest(keys[v * 3] + step * normal[0], keys[v * 3 + 1], keys[v * 3 + 2] + step * normal[2]) >= 0) paired += 1;
    }
    const off = Math.min(Math.abs(angle - want), 180 - Math.abs(angle - want));
    if (!best || paired > best.paired || (paired === best.paired && off < best.off)) best = { normal, paired, off };
  }
  const normal = best!.normal;
  return { normal, twins: mirrorPartners(keys, normal, tol, nearTol) };
}

/** Net edges whose two ends are both in `points`. */
export function edgesAmong(mesh: PolyMesh, points: ReadonlySet<number>): [number, number][] {
  const list = netEdges(mesh);
  const out: [number, number][] = [];
  for (let i = 0; i < list.length; i += 2) {
    if (points.has(list[i]) && points.has(list[i + 1])) out.push([list[i], list[i + 1]]);
  }
  return out;
}

/** Which way the surface faces at each point, from the faces around it, for box select. */
export function pointNormals(mesh: PolyMesh, positions: ArrayLike<number> = mesh.positions): Float32Array {
  const out = new Float32Array(positions.length);
  for (let f = 0; f < faceCount(mesh); f += 1) {
    const s = mesh.faceStart[f];
    const n = mesh.faceStart[f + 1] - s;
    // Newell's method: the area-weighted normal of the face.
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < n; i += 1) {
      const a = mesh.faceVerts[s + i] * 3;
      const b = mesh.faceVerts[s + ((i + 1) % n)] * 3;
      x += (positions[a + 1] - positions[b + 1]) * (positions[a + 2] + positions[b + 2]);
      y += (positions[a + 2] - positions[b + 2]) * (positions[a] + positions[b]);
      z += (positions[a] - positions[b]) * (positions[a + 1] + positions[b + 1]);
    }
    for (let i = 0; i < n; i += 1) {
      const v = mesh.faceVerts[s + i] * 3;
      out[v] += x; out[v + 1] += y; out[v + 2] += z;
    }
  }
  for (let v = 0; v < out.length; v += 3) {
    const l = Math.hypot(out[v], out[v + 1], out[v + 2]) || 1;
    out[v] /= l; out[v + 1] /= l; out[v + 2] /= l;
  }
  return out;
}
