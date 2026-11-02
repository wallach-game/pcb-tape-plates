// Minimal Excellon drill parser -> holes in mm: [{x, y, d}]
export function parseExcellon(text) {
  const warnings = []
  const tools = {}
  const holes = []
  let inch = false, decimals = null, cur = null, header = true, lastX = 0, lastY = 0, slots = 0
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim()
    if (!l || l.startsWith(';')) continue
    if (l.startsWith('M48')) { header = true; continue }
    if (l === '%' || l.startsWith('M95')) { header = false; continue }
    const u = l.match(/^(METRIC|INCH)(?:,(?:LZ|TZ))?(?:,(\d+)\.(\d+))?/)
    if (u) { inch = u[1] === 'INCH'; if (u[3]) decimals = u[3].length; continue }
    const t = l.match(/^T(\d+)(?:.*?C([\d.]+))?/)
    if (t && !/[XY]/.test(l)) {
      const id = +t[1]
      if (t[2]) tools[id] = parseFloat(t[2]) * (inch ? 25.4 : 1)
      else cur = id
      continue
    }
    if (/G85/.test(l)) { slots++; continue }
    const mx = l.match(/X(-?[\d.]+)/), my = l.match(/Y(-?[\d.]+)/)
    if ((mx || my) && !header) {
      const conv = s => {
        const v = s.includes('.') ? parseFloat(s) : parseInt(s, 10) / 10 ** (decimals ?? (inch ? 4 : 3))
        return v * (inch ? 25.4 : 1)
      }
      if (mx) lastX = conv(mx[1])
      if (my) lastY = conv(my[1])
      if (cur == null || !tools[cur]) { warnings.push('Drill hit before a tool was defined.'); continue }
      holes.push({x: lastX, y: lastY, d: tools[cur]})
    }
  }
  if (slots) warnings.push(`${slots} routed slot(s) (G85) are not supported and were skipped.`)
  return {holes, warnings}
}
