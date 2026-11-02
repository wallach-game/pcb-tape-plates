import Module from 'manifold-3d'
import wasmUrl from 'manifold-3d/manifold.wasm?url'
import * as THREE from 'three'
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js'
import {gerberToCrossSection} from './gerber.js'
import {buildPlate, DEFAULT_PARAMS, toBinaryStl} from './plate.js'

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
]
const STORE_KEY = 'pcbtape.params.v1'

let M, files = [], selected = null, params = loadParams(), result = null

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
  for (const f of list) {
    const text = await f.text()
    files = files.filter(x => x.name !== f.name)
    files.push({name: f.name, text, type: detectType(f.name)})
  }
  const rank = f => (f.type !== 'copper' ? 3 : isBottom(f.name) ? 2 : /.gd+$|ind/i.test(f.name) ? 1 : 0)
  files.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  if (!files.includes(selected)) {
    selected = firstCopper()
    if (selected) params.mirrorX = isBottom(selected.name)
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
    radio.onchange = () => { selected = f; params.mirrorX = isBottom(f.name); syncParams(); regenerate() }
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
  if (files.some(f => f.type === 'drill')) {
    const li = document.createElement('li'); li.className = 'muted'
    li.textContent = 'Drill files are not used yet (planned for 0.0.2); holes are not cut.'
    ul.append(li)
  }
}

// ---------- params ----------
function buildParamsForm() {
  const form = $('params')
  form.innerHTML = ''
  for (const [key, label, step] of PARAM_UI) {
    const l = document.createElement('label')
    l.append(label)
    const i = document.createElement('input')
    i.type = 'number'; i.step = step; i.min = 0; i.dataset.key = key
    i.oninput = () => { const v = parseFloat(i.value); if (!isNaN(v)) { params[key] = v; saveParams(); schedule() } }
    l.append(i); form.append(l)
  }
  const l = document.createElement('label')
  l.append('Mirror X (bottom layers)')
  const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.key = 'mirrorX'
  c.onchange = () => { params.mirrorX = c.checked; saveParams(); schedule() }
  l.append(c); form.append(l)
  syncParams()
}
function syncParams() {
  for (const el of $('params').querySelectorAll('input')) {
    const v = params[el.dataset.key]
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v
  }
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
  $('export').disabled = true
  if (!M || !selected) { result = null; draw2d(); return }
  try {
    const {cs, warnings} = parseCached(selected)
    warnings.forEach(w => addWarn(w))
    if (cs.isEmpty()) { addWarn('This layer contains no copper.', true); result = null; draw2d(); return }
    const bb = cs.bounds()
    let bounds = {minX: bb.min[0], minY: bb.min[1], maxX: bb.max[0], maxY: bb.max[1]}
    const outline = files.find(f => f.type === 'outline')
    if (outline) {
      const oc = parseCached(outline).cs
      if (!oc.isEmpty()) {
        const ob = oc.bounds()
        bounds = {minX: ob.min[0], minY: ob.min[1], maxX: ob.max[0], maxY: ob.max[1]}
      }
    } else addWarn('No board outline layer: plate size is based on the copper extents.')
    result?.manifold.delete()
    result = buildPlate(M, cs, bounds, params)
    const m = result.manifold
    if (m.status() !== 'NoError') addWarn('Mesh status: ' + m.status(), true)
    const pl = result.plate
    const w = pl.maxX - pl.minX, h = pl.maxY - pl.minY
    $('info').textContent = `${w.toFixed(1)} × ${h.toFixed(1)} mm · ${m.numTri().toLocaleString()} triangles`
    if (w > 220 || h > 220) addWarn(`Plate is ${w.toFixed(0)} × ${h.toFixed(0)} mm, larger than a 220 × 220 mm bed.`)
    $('export').disabled = false
    draw2d(); update3d()
  } catch (e) {
    console.error(e); addWarn('Failed: ' + e.message, true); result = null; draw2d()
  }
}

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
  g.fillStyle = '#8b919c'; g.font = '12px system-ui'
  g.fillText(params.mirrorX ? 'Mirrored (as printed, viewed from above)' : 'As designed (viewed from above)', 12, H - 12)
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
let mesh3d = null, fitted = false

function update3d() {
  if (mesh3d) { scene.remove(mesh3d); mesh3d.geometry.dispose() }
  const mm = result.manifold.getMesh()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(mm.vertProperties.slice(), mm.numProp))
  geo.setIndex(new THREE.BufferAttribute(mm.triVerts.slice(), 1))
  const flat = geo.toNonIndexed(); flat.computeVertexNormals()
  mesh3d = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({color: 0xc9a27a, roughness: 0.7}))
  scene.add(mesh3d)
  if (!fitted) {
    const pl = result.plate, cx = (pl.minX + pl.maxX) / 2, cy = (pl.minY + pl.maxY) / 2
    controls.target.set(cx, cy, 0)
    camera.position.set(cx, cy - (pl.maxY - pl.minY) * 1.2, (pl.maxX - pl.minX) * 1.1)
    fitted = true
  }
}
function resize3d() {
  const w = c3.clientWidth, h = c3.clientHeight
  if (!w || !h) return
  renderer.setPixelRatio(devicePixelRatio); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
}
renderer.setAnimationLoop(() => { if (!c3.hidden) { controls.update(); renderer.render(scene, camera) } })

// ---------- UI wiring ----------
for (const b of document.querySelectorAll('nav button')) {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x === b))
    const v3 = b.dataset.view === '3d'
    c3.hidden = !v3; c2d.hidden = v3
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
$('reset').onclick = () => { params = {...DEFAULT_PARAMS, mirrorX: params.mirrorX}; saveParams(); syncParams(); regenerate() }
$('export').onclick = () => {
  if (!result) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(toBinaryStl(result.manifold))
  a.download = (selected.name.replace(/\.[^.]+$/, '') || 'plate') + '.stl'
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

buildParamsForm()
M = await Module({locateFile: () => wasmUrl}); M.setup()
{ const q = new URLSearchParams(location.search); if (q.has('example')) loadExample('test'); if (q.has('demo4')) loadExample('demo4') }
