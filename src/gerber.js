// Gerber -> 2D copper CrossSection (mm). Uses @tracespace for parsing/plotting.
import {parse} from '@tracespace/parser'
import {plot} from '@tracespace/plotter'

const ARC_STEP_RAD = Math.PI / 24 // flattening resolution for arcs
const CIRCLE_SEGMENTS = 32

/** Flatten segments into polylines; a new polyline starts wherever the path is not contiguous. */
function flattenContours(segments) {
  const out = []
  let pts = null
  const near = (p, q) => Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9
  for (const s of segments) {
    const start = [s.start[0], s.start[1]]
    if (!pts || !near(pts[pts.length - 1], start)) out.push((pts = [start]))
    if (s.type === 'line') {
      pts.push([s.end[0], s.end[1]])
    } else {
      const [cx, cy] = s.center
      const t0 = s.start[2], t1 = s.end[2]
      const n = Math.max(2, Math.ceil(Math.abs(t1 - t0) / ARC_STEP_RAD))
      for (let i = 1; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n
        pts.push(i === n ? [s.end[0], s.end[1]] : [cx + s.radius * Math.cos(t), cy + s.radius * Math.sin(t)])
      }
    }
  }
  return out
}

/** Parse Gerber text. Returns {cs: CrossSection (mm), warnings: string[]}. */
export function gerberToCrossSection(M, text) {
  const {CrossSection} = M
  const warnings = []
  if (/%LPC\*%/.test(text)) warnings.push('Clear polarity (LPC) is not supported by the plotter; those areas are drawn as copper.')
  if (/%SR[XY]/.test(text)) warnings.push('Step-and-repeat (SR) is not supported.')
  const image = plot(parse(text))
  const k = image.units === 'in' ? 25.4 : 1
  const sc = pts => pts.map(p => [p[0] * k, p[1] * k])
  const parts = []
  let skipped = 0

  const capsule = (a, b, r) => {
    const c1 = CrossSection.circle(r, CIRCLE_SEGMENTS).translate(a[0], a[1])
    if (a[0] === b[0] && a[1] === b[1]) return c1
    return CrossSection.hull([c1, CrossSection.circle(r, CIRCLE_SEGMENTS).translate(b[0], b[1])])
  }
  const simple = sh => {
    switch (sh.type) {
      case 'circle': return CrossSection.circle(sh.r * k, CIRCLE_SEGMENTS).translate(sh.cx * k, sh.cy * k)
      case 'rectangle': {
        if (sh.r) warnings.push('Rounded rectangle pad drawn with square corners.')
        return CrossSection.square([sh.xSize * k, sh.ySize * k]).translate(sh.x * k, sh.y * k)
      }
      case 'polygon': return CrossSection.ofPolygons([sc(sh.points)], 'NonZero')
      case 'outline': return CrossSection.ofPolygons(flattenContours(sh.segments).map(sc), 'NonZero')
    }
  }

  for (const n of image.children) {
    try {
      if (n.type === 'imageShape') {
        if (n.shape.type === 'layeredShape') {
          let acc = null
          for (const sub of n.shape.shapes) {
            const cs = simple(sub)
            if (!cs) continue
            acc = !acc ? (sub.erase ? null : cs) : sub.erase ? acc.subtract(cs) : acc.add(cs)
          }
          if (acc) parts.push(acc)
        } else {
          const cs = simple(n.shape)
          if (cs) parts.push(cs)
        }
      } else if (n.type === 'imagePath') {
        const r = (n.width * k) / 2
        for (const c of flattenContours(n.segments)) {
          const pts = sc(c)
          for (let i = 1; i < pts.length; i++) parts.push(capsule(pts[i - 1], pts[i], r))
        }
      } else if (n.type === 'imageRegion') {
        parts.push(CrossSection.ofPolygons(flattenContours(n.segments).map(sc), 'NonZero'))
      }
    } catch (e) {
      skipped++
    }
  }
  if (skipped) warnings.push(`${skipped} graphic object(s) could not be converted and were skipped.`)
  const cs = parts.length ? CrossSection.union(parts) : CrossSection.square([0, 0])
  return {cs, warnings}
}
