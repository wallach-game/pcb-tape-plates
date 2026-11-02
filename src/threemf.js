// 3MF writer with PrusaSlicer per-object settings and layer-height ranges.
// objects: [{name, manifold (already positioned on the bed, mm), options: {key: value}, ranges: [{min, max, options}]}]
import {zipSync, strToU8} from 'fflate'

const esc = t => String(t).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]))
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n'

export function build3mf(objects) {
  const model = [XML + '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    '<metadata name="Application">pcb-tape-plates</metadata>', '<resources>']
  const cfg = [XML + '<config>']
  const rng = [XML + '<objects>']
  const build = []
  objects.forEach((o, i) => {
    const id = i + 1
    const mesh = o.manifold.getMesh()
    const np = mesh.numProp, v = mesh.vertProperties, t = mesh.triVerts
    const nv = v.length / np, nt = t.length / 3
    const vs = new Array(nv)
    for (let k = 0; k < nv; k++) vs[k] = `<vertex x="${v[k * np].toFixed(4)}" y="${v[k * np + 1].toFixed(4)}" z="${v[k * np + 2].toFixed(4)}"/>`
    const ts = new Array(nt)
    for (let k = 0; k < nt; k++) ts[k] = `<triangle v1="${t[3 * k]}" v2="${t[3 * k + 1]}" v3="${t[3 * k + 2]}"/>`
    model.push(`<object id="${id}" name="${esc(o.name)}" type="model"><mesh><vertices>${vs.join('')}</vertices><triangles>${ts.join('')}</triangles></mesh></object>`)
    build.push(`<item objectid="${id}"/>`)

    cfg.push(` <object id="${id}" instances_count="1">`, `  <metadata type="object" key="name" value="${esc(o.name)}"/>`)
    for (const [k, val] of Object.entries(o.options || {})) cfg.push(`  <metadata type="object" key="${k}" value="${esc(val)}"/>`)
    cfg.push(`  <volume firstid="0" lastid="${nt - 1}">`, `   <metadata type="volume" key="name" value="${esc(o.name)}"/>`,
      '   <metadata type="volume" key="volume_type" value="ModelPart"/>',
      '   <metadata type="volume" key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>', '  </volume>', ' </object>')

    if (o.ranges?.length) {
      rng.push(` <object id="${id}">`)
      for (const r of o.ranges) {
        rng.push(`  <range min_z="${r.min.toFixed(4)}" max_z="${r.max.toFixed(4)}">`)
        for (const [k, val] of Object.entries(r.options)) rng.push(`   <option opt_key="${k}">${esc(val)}</option>`)
        rng.push('  </range>')
      }
      rng.push(' </object>')
    }
  })
  model.push('</resources>', '<build>', ...build, '</build>', '</model>')
  cfg.push('</config>')
  rng.push('</objects>')

  const files = {
    '[Content_Types].xml': strToU8(XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    '_rels/.rels': strToU8(XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(model.join('\n')),
    'Metadata/Slic3r_PE_model.config': strToU8(cfg.join('\n')),
  }
  if (rng.length > 2) files['Metadata/Prusa_Slicer_layer_config_ranges.xml'] = strToU8(rng.join('\n'))
  return new Blob([zipSync(files, {level: 6})], {type: 'model/3mf'})
}
