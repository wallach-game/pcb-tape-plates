// Plate geometry with manifold-3d. All lengths in mm.
export const DEFAULT_PARAMS = {
  trackHeight_mm: 0.18,
  plateThickness_mm: 0.12, // thin on purpose: plates are stacked into a multilayer board
  grooveOffset_mm: 0.1,
  grooveWidthTop_mm: 0.5,
  grooveDepth_mm: 0.4,
  grooveTipWidth_mm: 0.1,
  boardMargin_mm: 5,
  minViaHole_mm: 0.6,
  negativeClearance_mm: 0.2,
  lineWidth_mm: 0.45, // one extrusion line of your slicer profile (0.4 mm nozzle -> about 0.45)
  mode: 'groove', // 'groove' = one plate with knife groove; 'separate' = base + tracks + negative parts
  registrationPinDiameter_mm: 3, // 0 disables pins and holes
  registrationClearance_mm: 0.2,
  plateSpacing_mm: 5,
  bedSize_mm: 220,
  layerHeightBase_mm: 0.06,
  layerHeightFine_mm: 0.06,
  infillPercent: 15,
  solidZone_mm: 0.8, // fully solid band under the tracks/groove so thin tracks never print over sparse infill
  infillPattern: 'gyroid',
  extraSettings: '', // extra per-object PrusaSlicer settings, one 'key = value' per line
  mirrorX: false,
}

const CIRCLE_SEGMENTS = 32

/** Groove depth actually used: never cuts through the plate (leaves at least half of a thin plate, max 0.4 mm). */
export function effectiveGrooveDepth(p) {
  const floor = Math.min(0.4, p.plateThickness_mm / 2)
  return Math.max(0, Math.min(p.grooveDepth_mm, p.plateThickness_mm - floor))
}

/** Groove ring at a given depth: centered at c from the copper edge, half-width h. */
function ringAt(M, copper, c, h) {
  return copper.offset(c + h, 'Round', 2, CIRCLE_SEGMENTS).subtract(copper.offset(c - h, 'Round', 2, CIRCLE_SEGMENTS))
}

/**
 * copper: CrossSection (mm). bounds: {minX,minY,maxX,maxY} of the board (before margin).
 * Returns {manifold, copper (after mirror), plate: {minX,minY,maxX,maxY}}
 */
export function buildPlate(M, copperIn, bounds, p, holes = []) {
  const {Manifold, CrossSection} = M
  let copper = copperIn
  const b = {...bounds}
  if (p.mirrorX) copper = copper.mirror([1, 0]).translate([b.minX + b.maxX, 0]) // mirror about the board's center line, so all plates share one footprint
  const m = p.boardMargin_mm
  const plate = {minX: b.minX - m, minY: b.minY - m, maxX: b.maxX + m, maxY: b.maxY + m}
  const T = p.plateThickness_mm
  // through holes (design coordinates in; mirrored with the layer so they line up across plates)
  const hs = holes.map(h => ({x: p.mirrorX ? b.minX + b.maxX - h.x : h.x, y: h.y, d: Math.max(h.d, p.minViaHole_mm)}))
  if (p.mode === 'separate') return buildSeparate(M, copper, plate, p, hs)

  let groove2d = null
  let neg2d = CrossSection.square([plate.maxX - plate.minX, plate.maxY - plate.minY]).translate([plate.minX, plate.minY])
  let solid = Manifold.cube([plate.maxX - plate.minX, plate.maxY - plate.minY, T]).translate([plate.minX, plate.minY, 0])
  if (!copper.isEmpty()) {
    solid = solid.add(copper.extrude(p.trackHeight_mm).translate([0, 0, T]))

    // V-groove: stepped approximation, ~0.1 mm per step, each step a ring whose width shrinks with depth.
    const W = p.grooveWidthTop_mm, D = effectiveGrooveDepth(p)
    const c = p.grooveOffset_mm + W / 2
    const steps = Math.max(2, Math.round(D / 0.1))
    const tip = Math.max(0.01, p.grooveTipWidth_mm / 2)
    const cuts = []
    groove2d = ringAt(M, copper, c, W / 2)
    // negative = everything outside the groove: the tape that gets peeled away
    neg2d = neg2d.subtract(copper.offset(p.grooveOffset_mm + W, 'Round', 2, CIRCLE_SEGMENTS))
    for (let i = 0; i < steps; i++) {
      const z0 = T - (D * (i + 1)) / steps
      const mid = (i + 0.5) / steps
      const h = tip + (W / 2 - tip) * (1 - mid)
      const ring = ringAt(M, copper, c, h)
      // extend the first step above the surface so the cut is clean
      cuts.push(ring.extrude((D / steps) + (i === 0 ? 0.01 : 0.001)).translate([0, 0, z0]))
    }
    solid = solid.subtract(Manifold.union(cuts))
  }
  if (hs.length) {
    const H = T + p.trackHeight_mm + 2
    const cyl = hs.map(h => Manifold.cylinder(H, h.d / 2, h.d / 2, CIRCLE_SEGMENTS).translate([h.x, h.y, -1]))
    solid = solid.subtract(Manifold.union(cyl))
  }
  return {manifold: solid, copper, groove2d, neg2d, plate, holes: hs, T}
}

/**
 * Separate-parts style: base plate with the raised tracks on it, and a separate negative (filler) part.
 * The negative is trackHeight thick. The negative fills the area where the tape is
 * peeled away, leaving negativeClearance around the copper. Parts are laid side by side in
 * manifold (for export); parts.* hold each body at its own origin for assembled preview.
 */
function buildSeparate(M, copper, plate, p, hs) {
  const {Manifold, CrossSection} = M
  const T = p.plateThickness_mm, h = p.trackHeight_mm, W = p.grooveWidthTop_mm
  const w = plate.maxX - plate.minX, d = plate.maxY - plate.minY
  const rect = CrossSection.square([w, d]).translate([plate.minX, plate.minY])
  const cut = (man, H) => hs.length ? man.subtract(Manifold.union(hs.map(q => Manifold.cylinder(H + 2, q.d / 2, q.d / 2, CIRCLE_SEGMENTS).translate([q.x, q.y, -1])))) : man
  const base = cut(rect.extrude(T).add(copper.extrude(h).translate([0, 0, T])), T + h)
  const neg2d = rect.subtract(copper.offset(p.negativeClearance_mm, 'Round', 2, CIRCLE_SEGMENTS))
  const neg = cut(neg2d.extrude(h), h)
  const groove2d = ringAt(M, copper, p.grooveOffset_mm + W / 2, W / 2)
  const gap = 5
  const manifold = Manifold.union([base, neg.translate([w + gap, 0, 0])])
  return {manifold, parts: {base, neg}, copper, groove2d: null, neg2d, plate, holes: hs, T, mode: 'separate'}
}

/** Binary STL from a manifold. */
export function toBinaryStl(manifold) {
  const mesh = manifold.getMesh()
  const v = mesh.vertProperties, t = mesh.triVerts, np = mesh.numProp
  const n = t.length / 3
  const buf = new ArrayBuffer(84 + n * 50)
  const dv = new DataView(buf)
  dv.setUint32(80, n, true)
  let o = 84
  for (let i = 0; i < n; i++) {
    const a = t[3 * i] * np, b = t[3 * i + 1] * np, c = t[3 * i + 2] * np
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2]
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2]
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    for (const x of [nx, ny, nz]) { dv.setFloat32(o, x, true); o += 4 }
    for (const q of [a, b, c]) for (let j = 0; j < 3; j++) { dv.setFloat32(o, v[q + j], true); o += 4 }
    o += 2
  }
  return new Blob([buf], {type: 'model/stl'})
}
