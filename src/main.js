import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import * as THREE from 'three'
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js'
import {gerberToCrossSection} from './gerber.js'
import {parseExcellon} from './excellon.js'
import {unzipSync, strFromU8} from 'fflate'
import {buildPlate, DEFAULT_PARAMS, toBinaryStl} from './plate.js'
import {build3mf} from './threemf.js'

const examples = {
  test: import.meta.glob('../examples/testpattern*', {query: '?raw', import: 'default', eager: true}),
  demo4: import.meta.glob('../examples/demo4*', {query: '?raw', import: 'default', eager: true}),
}

const $ = id => document.getElementById(id)
const PARAM_UI = [
  ['trackHeight_mm', 'Track height (mm)', 0.05],
  ['plateThickness_mm', 'Plate thickness (mm)', 0.1],
  ['grooveOffset_mm', 'Groove offset from copper (mm)', 0.05],
  ['grooveWidthTop_mm', 'Groove width at top (mm)', 0.05],
  ['grooveDepth_mm', 'Groove depth (mm)', 0.05],
  ['grooveTipWidth_mm', 'Groove tip width (mm)', 0.05],
  ['boardMargin_mm', 'Board margin (mm)', 1],
  ['minViaHole_mm', 'Minimum hole diameter (mm)', 0.1],
  ['negativeClearance_mm', 'Negative clearance to copper (mm)', 0.05],
  ['registrationPinDiameter_mm', 'Registration pin Ø (mm, 0 = off)', 0.5],
  ['registrationClearance_mm', 'Registration clearance (mm)', 0.05],
  ['layerHeightBase_mm', 'Layer height, body (mm)', 0.05],
  ['layerHeightFine_mm', 'Layer height, track zone (mm)', 0.01],
  ['infillPercent', 'Infill (%)', 5],
  ['plateSpacing_mm', 'Plate spacing on bed (mm)', 1],
  ['bedSize_mm', 'Bed size (mm)', 10],
]
const STORE_KEY = 'pcbtape.params.v1'

let M, files = [], selected = null, params = loadParams(), result = null
const results = new Map() // copper file -> plate result

function loadParams() {
  try { return {...DEFAULT_PARAMS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}')} } catch { return {...DEFAULT_PARAMS} }
}
function saveParams() { try { localStorage.setItem(STORE_KEY, JSON.stringify(params)) } catch {} }

// ---------- file handling ----------
function detectType(name) {
  const n = name.toLowerCase()
  if (/silk|mask|paste|document|assembly|fab|legend|\.(gto|gbo|gts|gbs|gtp|gbp|gdl)$/.test(n)) return 'ignore'
  if (/\.(drl|xln|exc|drd)$|drill|pth/.test(n)) return 'drill'
  if (/outline|edge_?cuts|\.(gko|gm1|gml)$/.test(n)) return 'outline'
  if (/\.(gtl|gbl|g\d+|gl\d+)$|_cu\b|copper|toplayer|bottomlayer|innerlayer/.test(n)) return 'copper'
  return 'ignore'
}
const isBottom = name => /\.gbl$|b[._]cu|bottom/i.test(name)
const firstCopper = () => files.find(f => f.type === 'copper') || null

async function addFiles(list) {
  const entries = []
  for (const f of list) {
    if (/\.zip$/i.test(f.name)) {
      // EasyEDA / KiCad Gerber export zips
      const z = unzipSync(new Uint8Array(await f.arrayBuffer()))
      for (const [path, data] of Object.entries(z)) {
        const name = path.split('/').pop()
        if (!name || path.startsWith('__MACOSX') || data.length > 40e6) continue
        entries.push({name, text: strFromU8(data)})
      }
    } else entries.push({name: f.name, text: await f.text()})
  }
  for (const {name, text} of entries) {
    files = files.filter(x => x.name !== name)
    files.push({name, text, type: detectType(name), mirror: isBottom(name)})
  }
  const rank = f => (f.type !== 'copper' ? 3 : isBottom(f.name) ? 2 : /\.g\d+$|in\d/i.test(f.name) ? 1 : 0)
  files.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  if (!files.includes(selected)) {
    selected = firstCopper()
  }
  syncParams()
  renderLayers()
  regenerate()
}

function renderLayers() {
  const ul = $('layers')
  ul.innerHTML = ''
  if (!files.length) { ul.innerHTML = '<li class="muted">No files loaded</li>'; return }
  for (const f of files) {
    const li = document.createElement('li')
    const radio = document.createElement('input')
    radio.type = 'radio'; radio.name = 'sel'; radio.disabled = f.type !== 'copper'
    radio.checked = f === selected
    radio.onchange = () => { selected = f; syncParams(); regenerate() }
    const name = document.createElement('span'); name.className = 'name'; name.textContent = f.name; name.title = f.name
    const sel = document.createElement('select')
    for (const t of ['copper', 'outline', 'drill', 'ignore']) {
      const o = document.createElement('option'); o.value = o.textContent = t; o.selected = f.type === t; sel.append(o)
    }
    sel.onchange = () => {
      f.type = sel.value
      if (f === selected && f.type !== 'copper') selected = firstCopper()
      if (!selected) selected = firstCopper()
      renderLayers(); regenerate()
    }
    li.append(radio, name, sel)
    ul.append(li)
  }
}

// ---------- params ----------
function buildParamsForm() {
  const form = $('params')
  form.innerHTML = ''
  const SELECTS = [
    ['mode', 'Plate style', [['groove', 'Knife groove (single plate)'], ['separate', 'Separate base+tracks / negative']]],
    ['infillPattern', 'Infill pattern', [['gyroid', 'Gyroid'], ['grid', 'Grid'], ['rectilinear', 'Rectilinear'], ['honeycomb', 'Honeycomb'], ['cubic', 'Cubic']]],
  ]
  for (const [key, label, opts] of SELECTS) {
    const ml = document.createElement('label')
    ml.append(label)
    const ms = document.createElement('select'); ms.dataset.key = key
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; ms.append(o) }
    ms.onchange = () => { params[key] = ms.value; saveParams(); applyModeUi(); schedule() }
    ml.append(ms); form.append(ml)
  }
  for (const [key, label, step] of PARAM_UI) {
    const l = document.createElement('label')
    l.append(label)
    const i = document.createElement('input')
    i.type = 'number'; i.step = step; i.min = 0; i.dataset.key = key
    i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) { params[key] = v; saveParams(); schedule() } }
    l.append(i); form.append(l)
  }
  const l = document.createElement('label')
  l.append('Mirror X (selected layer)')
  const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.key = 'mirrorX'
  c.onchange = () => { if (selected) selected.mirror = c.checked; schedule() }
  l.append(c); form.append(l)
  syncParams()
}
// grey out the parameters that don't apply to the current plate style
function applyModeUi() {
  const sep = params.mode === 'separate'
  const groove = ['grooveOffset_mm', 'grooveWidthTop_mm', 'grooveDepth_mm', 'grooveTipWidth_mm']
  for (const el of $('params').querySelectorAll('input[type=number]')) {
    const k = el.dataset.key
    el.closest('label').style.opacity = (sep && groove.includes(k)) || (!sep && k === 'negativeClearance_mm') ? 0.35 : 1
  }
}
function syncParams() {
  for (const el of $('params').querySelectorAll('input, select')) {
    if (el.tagName === 'SELECT') el.value = params[el.dataset.key]
    else if (el.type === 'checkbox') el.checked = !!selected?.mirror; else el.value = params[el.dataset.key]
  }
  applyModeUi()
}

// ---------- generation ----------
let timer
const schedule = () => { clearTimeout(timer); timer = setTimeout(regenerate, 250) }
const cache = new Map()

function parseCached(f) {
  const key = f.name + ':' + f.text.length
  if (!cache.has(key)) cache.set(key, gerberToCrossSection(M, f.text))
  return cache.get(key)
}

function regenerate() {
  const warn = $('warnings'); warn.innerHTML = ''
  const addWarn = (t, err) => { const li = document.createElement('li'); li.textContent = t; if (err) li.className = 'err'; warn.append(li) }
  $('export').disabled = true; $('export3mf').disabled = true
  for (const r of results.values()) { r.manifold.delete(); r.neg2d?.delete(); if (r.parts) Object.values(r.parts).forEach(x => x.delete()) }
  results.clear(); result = null
  const coppers = files.filter(f => f.type === 'copper')
  if (!M || !selected || !coppers.length) { renderStackup([], []); draw2d(); update3d(); return }
  try {
    const parsed = coppers.map(f => ({f, ...parseCached(f)}))
    parsed.forEach(({f, warnings}) => warnings.forEach(w => addWarn((coppers.length > 1 ? f.name + ': ' : '') + w)))
    // one shared board rectangle so every plate has the same footprint
    let bounds = null
    const outline = files.find(f => f.type === 'outline')
    if (outline && !parseCached(outline).cs.isEmpty()) bounds = boundsOf(parseCached(outline).cs)
    else {
      addWarn('No board outline layer: plate size is based on the copper extents.')
      for (const {cs} of parsed) {
        if (cs.isEmpty()) continue
        const b = boundsOf(cs)
        bounds = bounds ? {minX: Math.min(bounds.minX, b.minX), minY: Math.min(bounds.minY, b.minY), maxX: Math.max(bounds.maxX, b.maxX), maxY: Math.max(bounds.maxY, b.maxY)} : b
      }
    }
    if (!bounds) { addWarn('No copper found.', true); draw2d(); update3d(); return }
    const rd = params.registrationPinDiameter_mm
    if (rd > 0 && params.boardMargin_mm < rd + params.registrationClearance_mm + 1.5) addWarn('Board margin is too small for the registration pins; increase it or reduce the pin diameter.')
    const holes = []
    for (const f of files.filter(x => x.type === 'drill')) {
      const r = parseExcellonCached(f)
      holes.push(...r.holes); r.warnings.forEach(w => addWarn(f.name + ': ' + w))
    }
    for (const {f, cs} of parsed) {
      if (cs.isEmpty()) { addWarn(f.name + ': layer contains no copper.', true); continue }
      const r = buildPlate(M, cs, bounds, {...params, mirrorX: f.mirror}, [...holes, ...regHoles(bounds)])
      if (r.manifold.status() !== 'NoError') addWarn(f.name + ': mesh status ' + r.manifold.status(), true)
      results.set(f, r)
    }
    result = results.get(selected) || null
    if (result) {
      const pl = result.plate, w = pl.maxX - pl.minX, h = pl.maxY - pl.minY
      $('info').textContent = `${w.toFixed(1)} × ${h.toFixed(1)} mm · ${results.size} layer(s) · ${result.manifold.numTri().toLocaleString()} triangles (selected)`
      if (w > 220 || h > 220) addWarn(`Plate is ${w.toFixed(0)} × ${h.toFixed(0)} mm, larger than a 220 × 220 mm bed.`)
      $('export').disabled = false; $('export3mf').disabled = false
    }
    renderStackup(parsed, holes)
    draw2d(); update3d()
  } catch (e) {
    console.error(e); addWarn('Failed: ' + e.message, true); result = null; draw2d()
  }
}
const excellonCache = new Map()
function parseExcellonCached(f) {
  const key = f.name + ':' + f.text.length
  if (!excellonCache.has(key)) excellonCache.set(key, parseExcellon(f.text))
  return excellonCache.get(key)
}

// ---------- stack-up ----------
const polyCache = new WeakMap()
function inCopper(cs, x, y) {
  let polys = polyCache.get(cs)
  if (!polys) polyCache.set(cs, (polys = cs.toPolygons()))
  let inside = false
  for (const p of polys) {
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i], [xj, yj] = p[j]
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
    }
  }
  return inside
}

function renderStackup(parsed, holes) {
  const box = $('stackup')
  if (!parsed.length) { box.innerHTML = '<span class="muted">Load copper layers to see the stack-up.</span>'; return }
  const layers = parsed.map(p => p.f), n = layers.length
  // group holes by which layers have copper at the hole centre
  const groups = new Map()
  for (const h of holes) {
    const hit = []
    parsed.forEach(({cs}, i) => { if (!cs.isEmpty() && inCopper(cs, h.x, h.y)) hit.push(i) })
    const key = (hit.length ? hit[0] + '-' + hit[hit.length - 1] + '-' + hit.join('.') : 'none') + '|' + h.d.toFixed(2)
    const g = groups.get(key) || {hit, d: h.d, count: 0}
    g.count++; groups.set(key, g)
  }
  const gl = [...groups.values()].sort((a, b) => (a.hit[0] ?? 99) - (b.hit[0] ?? 99) || b.count - a.count)
  const W = 288, rowH = 24, gap = 16, top = 6, x0 = 112
  const H = top * 2 + n * rowH + (n - 1) * gap
  const cy = i => top + i * (rowH + gap) + rowH / 2
  const colW = gl.length ? Math.min(22, (W - x0 - 14) / gl.length) : 0
  const col = k => x0 + 10 + k * colW
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Layer stack-up">`
  layers.forEach((f, i) => {
    const color = '#' + LAYER_COLORS[i % LAYER_COLORS.length].toString(16).padStart(6, '0')
    const y = top + i * (rowH + gap)
    s += `<rect x="0" y="${y}" width="${W}" height="${rowH}" rx="3" fill="${color}" opacity=".85"/>`
    s += `<rect x="0" y="${y + rowH - 5}" width="${W}" height="5" fill="#000" opacity=".25"/>`
    s += `<text x="6" y="${y + 15}" font-size="11" fill="#111">L${i + 1} ${esc(f.name.replace(/\.[^.]+$/, '').slice(-13))}${f.mirror ? ' ⇋' : ''}</text>`
    if (i < n - 1) s += `<text x="6" y="${y + rowH + 11}" font-size="9" fill="currentColor" opacity=".6">plate ${params.plateThickness_mm} mm${i === 0 ? '' : ''}</text>`
  })
  gl.forEach((g, k) => {
    const x = col(k)
    if (!g.hit.length) { s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${H - top}" stroke="#888" stroke-width="2" stroke-dasharray="3 3"/>`; return }
    const a = g.hit[0], b = g.hit[g.hit.length - 1]
    s += `<line x1="${x}" y1="${cy(a)}" x2="${x}" y2="${cy(b)}" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`
    s += `<line x1="${x}" y1="${cy(a)}" x2="${x}" y2="${cy(b)}" stroke="#111" stroke-width="1"/>`
    for (const i of g.hit) s += `<circle cx="${x}" cy="${cy(i)}" r="4.5" fill="#fff" stroke="#111" stroke-width="1.5"/>`
  })
  s += '</svg>'
  const kind = g => !g.hit.length ? 'no copper (mounting)' : g.hit.length === 1 ? 'single layer' : g.hit[0] === 0 && g.hit[g.hit.length - 1] === n - 1 ? 'through' : g.hit[0] === 0 || g.hit[g.hit.length - 1] === n - 1 ? 'blind' : 'buried'
  const names = g => g.hit.length ? g.hit.map(i => 'L' + (i + 1)).join('+') : '—'
  s += '<ul class="muted vias">' + gl.map(g => `<li>${g.count}× Ø${g.d.toFixed(2)} mm · ${names(g)} · ${kind(g)}</li>`).join('') + '</ul>'
  s += `<div class="muted">${n} plates × (${params.plateThickness_mm} plate + ${params.trackHeight_mm} track) = ${(n * (params.plateThickness_mm + params.trackHeight_mm)).toFixed(1)} mm stacked</div>`
  box.innerHTML = s
}
const esc = t => t.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]))

// Registration holes sit in the board margin at three corners (asymmetric: a rotated or flipped plate won't fit).
// They are in design coordinates and mirrored together with the layer, like the vias.
function regHoles(bounds) {
  const d = params.registrationPinDiameter_mm
  if (!(d > 0)) return []
  const mg = params.boardMargin_mm, ins = mg / 2
  const x0 = bounds.minX - mg + ins, x1 = bounds.maxX + mg - ins, y0 = bounds.minY - mg + ins, y1 = bounds.maxY + mg - ins
  const dia = d + params.registrationClearance_mm
  return [[x0, y0], [x1, y0], [x0, y1]].map(([x, y]) => ({x, y, d: dia}))
}

function boundsOf(cs) { const b = cs.bounds(); return {minX: b.min[0], minY: b.min[1], maxX: b.max[0], maxY: b.max[1]} }

// ---------- 2D preview ----------
const c2d = $('c2d')
function draw2d() {
  const dpr = devicePixelRatio || 1
  const W = c2d.clientWidth, H = c2d.clientHeight
  c2d.width = W * dpr; c2d.height = H * dpr
  const g = c2d.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, W, H)
  if (!result) return
  const pl = result.plate
  const pw = pl.maxX - pl.minX, ph = pl.maxY - pl.minY
  const s = Math.min((W - 40) / pw, (H - 80) / ph)
  const ox = (W - pw * s) / 2, oy = (H - ph * s) / 2 + 20
  const X = x => ox + (x - pl.minX) * s, Y = y => oy + (pl.maxY - y) * s
  const path = polys => {
    g.beginPath()
    for (const p of polys) { p.forEach((q, i) => (i ? g.lineTo(X(q[0]), Y(q[1])) : g.moveTo(X(q[0]), Y(q[1])))); g.closePath() }
  }
  g.fillStyle = '#2a2f38'; g.fillRect(X(pl.minX), Y(pl.maxY), pw * s, ph * s)
  if (result.groove2d) { path(result.groove2d.toPolygons()); g.fillStyle = '#0b0c0e'; g.fill('evenodd') }
  path(result.copper.toPolygons()); g.fillStyle = '#d9822b'; g.fill('evenodd')
  g.fillStyle = '#14161a'
  for (const h of result.holes || []) { g.beginPath(); g.arc(X(h.x), Y(h.y), Math.max(1.5, (h.d / 2) * s), 0, 7); g.fill() }
  g.fillStyle = '#8b919c'; g.font = '12px system-ui'
  g.fillText(selected?.mirror ? 'Mirrored (as printed, viewed from above)' : 'As designed (viewed from above)', 12, H - 12)
}

// ---------- 3D preview ----------
const c3 = $('c3d')
const renderer = new THREE.WebGLRenderer({antialias: true})
c3.append(renderer.domElement)
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000)
camera.up.set(0, 0, 1)
const controls = new OrbitControls(camera, renderer.domElement)
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6))
const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-50, -80, 120); scene.add(dl)
const LAYER_COLORS = [0xd9a066, 0x7fb3d5, 0x9ccc7a, 0xc792ea, 0xe5c07b, 0x66c2b0]
let meshes = [], fitted = false, explode = 0, explodeTarget = 0
const explodeSlider = $('explode')

const vis = {plate: true, copper: true, neg: true, groove: false}
const PART_COLORS = {copper: 0xe8892b, neg: 0x19c3b1, groove: 0x15171b}

function toGeometry(man) {
  const mm = man.getMesh()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(mm.vertProperties.slice(), mm.numProp))
  geo.setIndex(new THREE.BufferAttribute(mm.triVerts.slice(), 1))
  const flat = geo.toNonIndexed(); flat.computeVertexNormals()
  return flat
}
function slab(cs, z0, h, color) {
  if (!cs || cs.isEmpty()) return null
  const man = cs.extrude(h).translate([0, 0, z0])
  const mesh = new THREE.Mesh(toGeometry(man), new THREE.MeshStandardMaterial({color, roughness: 0.6}))
  man.delete()
  return mesh
}

function update3d() {
  for (const o of meshes) { scene.remove(o.group); o.group.traverse(x => x.geometry?.dispose()) }
  meshes = []
  const list = files.filter(f => results.has(f))
  list.forEach((f, idx) => {
    const r = results.get(f), T = r.T
    const group = new THREE.Group()
    const parts = {}
    const mat = c => new THREE.MeshStandardMaterial({color: c, roughness: 0.7})
    if (r.mode === 'separate') {
      // assembled: base with its raised tracks, and the negative part sitting on top of the base
      parts.plate = new THREE.Mesh(toGeometry(r.parts.base), mat(LAYER_COLORS[idx % LAYER_COLORS.length]))
      parts.copper = slab(r.copper, T, params.trackHeight_mm + 0.02, PART_COLORS.copper)
      parts.neg = new THREE.Mesh(toGeometry(r.parts.neg), mat(PART_COLORS.neg))
      parts.neg.position.z = T
    } else {
      parts.plate = new THREE.Mesh(toGeometry(r.manifold), mat(LAYER_COLORS[idx % LAYER_COLORS.length]))
      parts.copper = slab(r.copper, T, params.trackHeight_mm + 0.02, PART_COLORS.copper)
      parts.neg = slab(r.neg2d, T, 0.06, PART_COLORS.neg)
      parts.groove = slab(r.groove2d, T, 0.04, PART_COLORS.groove)
    }
    for (const mesh of Object.values(parts)) if (mesh) group.add(mesh)
    scene.add(group)
    meshes.push({group, parts, level: list.length - 1 - idx}) // first listed layer (top) sits highest
  })
  applyExplode(); applyVisibility()
  if (!fitted && result) {
    const pl = result.plate, cx = (pl.minX + pl.maxX) / 2, cy = (pl.minY + pl.maxY) / 2
    controls.target.set(cx, cy, 8)
    camera.position.set(cx, cy - (pl.maxY - pl.minY) * 1.8, (pl.maxX - pl.minX) * 1.1 + 40)
    fitted = true
  }
  renderLegend(list)
}
function applyVisibility() {
  for (const o of meshes) for (const [k, mesh] of Object.entries(o.parts)) if (mesh) mesh.visible = vis[k]
}
function applyExplode() {
  const pitch = params.plateThickness_mm + params.trackHeight_mm
  for (const o of meshes) o.group.position.z = o.level * (pitch + explode)
}
function renderLegend(list) {
  $('legend').innerHTML = list.map((f, i) => '<span><i style="background:#' + LAYER_COLORS[i % LAYER_COLORS.length].toString(16).padStart(6, '0') + '"></i>' + f.name + (f.mirror ? ' (mirrored)' : '') + '</span>').join('')
}
function resize3d() {
  const w = c3.clientWidth, h = c3.clientHeight
  if (!w || !h) return
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
}
renderer.setAnimationLoop(() => {
  if (Math.abs(explode - explodeTarget) > 0.01) { explode += (explodeTarget - explode) * 0.15; applyExplode() }
  if (!c3.hidden) { controls.update(); renderer.render(scene, camera) } })

// ---------- UI wiring ----------
for (const b of document.querySelectorAll('nav button')) {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b))
    const v3 = b.dataset.view === '3d'
    c3.hidden = !v3; c2d.hidden = v3
    $('explodeBox').hidden = !v3; $('viewBox').hidden = !v3; $('legend').hidden = !v3
    if (v3) resize3d(); else draw2d()
  }
}
addEventListener('resize', () => { draw2d(); resize3d() })
const drop = $('drop')
drop.onclick = () => $('file').click()
$('file').onchange = e => addFiles([...e.target.files])
drop.ondragover = e => { e.preventDefault(); drop.classList.add('over') }
drop.ondragleave = () => drop.classList.remove('over')
drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files]) }
function loadExample(key) {
  const list = Object.entries(examples[key]).map(([p, text]) => new File([text], p.split('/').pop()))
  files = []; selected = null; addFiles(list)
}
$('example').onclick = () => loadExample('test')
$('example4').onclick = () => loadExample('demo4')
$('reset').onclick = () => { params = {...DEFAULT_PARAMS}; saveParams(); syncParams(); regenerate() }
function download(blob, name) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

/** One 3MF with every plate (and the registration pins) laid out on the bed, plus PrusaSlicer settings. */
function export3mf() {
  const {Manifold} = M
  const items = []
  const T = params.plateThickness_mm, h = params.trackHeight_mm
  const grooveD = Math.min(params.grooveDepth_mm, T - 0.4)
  const base = n => n.replace(/\.[^.]+$/, '')
  const common = {fill_density: params.infillPercent + '%', fill_pattern: params.infillPattern}
  const list = files.filter(f => results.has(f))
  for (const f of list) {
    const r = results.get(f), n = base(f.name)
    if (r.mode === 'separate') {
      items.push({
        name: n + '_base', man: r.parts.base, plate: r.plate, options: {...common, layer_height: params.layerHeightBase_mm},
        ranges: [{min: T, max: T + h, options: {layer_height: params.layerHeightFine_mm}}], // fine layers for the raised tracks
      })
      items.push({name: n + '_negative', man: r.parts.neg, plate: r.plate, options: {fill_density: '100%', layer_height: params.layerHeightFine_mm}})
    } else {
      items.push({
        name: n, man: r.manifold, plate: r.plate, options: {...common, layer_height: params.layerHeightBase_mm},
        // fine layers only where the groove and tracks are; coarse below
        ranges: [{min: T - grooveD, max: T + h, options: {layer_height: params.layerHeightFine_mm}}],
      })
    }
  }
  // shelf-pack onto the bed
  const sp = params.plateSpacing_mm, bed = params.bedSize_mm
  let x = sp, y = sp, rowH = 0, overflow = false
  const placed = []
  const place = (man, w, d, o) => {
    if (x + w + sp > bed && x > sp) { x = sp; y += rowH + sp; rowH = 0 }
    if (y + d + sp > bed || w + 2 * sp > bed) overflow = true
    placed.push({...o, manifold: man.translate([x, y, 0]), tmp: true})
    x += w + sp; rowH = Math.max(rowH, d)
  }
  for (const it of items) {
    const w = it.plate.maxX - it.plate.minX, d = it.plate.maxY - it.plate.minY
    place(it.man.translate([-it.plate.minX, -it.plate.minY, 0]), w, d, {name: it.name, options: it.options, ranges: it.ranges})
  }
  const rd = params.registrationPinDiameter_mm
  if (rd > 0 && list.length) {
    const L = list.length * (T + h) + 2
    const pins = Manifold.union([0, 1, 2].map(i => Manifold.cylinder(L, rd / 2, rd / 2, 32).translate([rd / 2 + i * (rd + 2), rd / 2, 0])))
    place(pins, 3 * rd + 4, rd, {name: 'registration_pins', options: {fill_density: '100%', layer_height: params.layerHeightBase_mm}})
  }
  const blob = build3mf(placed)
  placed.forEach(o => o.manifold.delete())
  download(blob, 'copper-tape-plates.3mf')
  if (overflow) alert('Warning: not everything fits on a ' + bed + ' mm bed; some parts overlap the bed edge. Reduce the board margin or print in several jobs.')
}
$('export3mf').onclick = export3mf

$('export').onclick = () => {
  if (!result) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(toBinaryStl(result.manifold))
  a.download = (selected.name.replace(/\.[^.]+$/, '') || 'plate') + '.stl'
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

explodeSlider.oninput = () => { explodeTarget = parseFloat(explodeSlider.value) }
$('explodeBtn').onclick = () => { explodeTarget = explodeTarget > 0 ? 0 : 15; explodeSlider.value = explodeTarget }
for (const cb of document.querySelectorAll('#viewBox input')) {
  cb.checked = vis[cb.dataset.part]
  cb.onchange = () => { vis[cb.dataset.part] = cb.checked; applyVisibility() }
}
buildParamsForm()
M = await Module({locateFile: () => wasmUrl}); M.setup()
{ const q = new URLSearchParams(location.search); if (q.has('separate')) { params.mode = 'separate'; syncParams() } if (q.has('example')) loadExample('test'); if (q.has('demo4')) loadExample('demo4') }
if (new URLSearchParams(location.search).has('3d')) { document.querySelector('nav button[data-view="3d"]').click(); if (new URLSearchParams(location.search).has('exploded')) { explodeTarget = 12; explodeSlider.value = 12 } }
