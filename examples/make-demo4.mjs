// Generates a 4-layer demo board: node examples/make-demo4.mjs
import fs from 'node:fs'
const f = v => Math.round(v * 1e6)
const hdr = ['%FSLAX46Y46*%', '%MOMM*%', '%LPD*%', '%ADD10C,0.3*%', '%ADD11C,0.5*%', '%ADD20C,1.6*%', '%ADD21C,1.0*%', '%ADD22R,1.6X1.6*%', 'G01*']
const Y = i => 12 + 2.54 * i
const U1 = {l: 10, r: 17.62}, U2 = {l: 26, r: 33.62}
const pads = [] // [x, y, aperture]
for (const U of [U1, U2]) for (let i = 0; i < 4; i++) for (const x of [U.l, U.r]) pads.push([x, Y(i), x === U1.l && i === 0 && U === U1 ? 22 : 20])
const J1 = i => [4, Y(i)], J2 = i => [38, Y(i)]
for (let i = 0; i < 4; i++) pads.push([...J1(i), 20], [...J2(i), 20])
const vias = [[22, 6], [22, 26]]
const dr = p => `X${f(p[0])}Y${f(p[1])}D03*`
const line = (a, b, ap) => [`D${ap}*`, `X${f(a[0])}Y${f(a[1])}D02*`, `X${f(b[0])}Y${f(b[1])}D01*`]
const flash = (list, ap) => [`D${ap}*`, ...list.map(dr)]
const padsOf = pred => pads.filter(pred)
const write = (name, body) => fs.writeFileSync(new URL('./' + name, import.meta.url), [...hdr, ...body, 'M02*'].join('\n') + '\n')
const allPads = ap => flash(pads.filter(p => p[2] === ap), ap)

// Top: all pads, U1->U2 buses, via pads
const top = [...allPads(20), ...allPads(22), ...flash(vias, 21)]
for (let i = 0; i < 4; i++) top.push(...line([U1.r, Y(i)], [U2.l, Y(i)], 10))
write('demo4-F_Cu.gtl', top)

// Inner 1: GND (U1 pin1 and U2 pin 4 right) + rail + pour
const gndPads = [[U1.l, Y(0)], [U2.r, Y(0)]]
const in1 = [...flash(gndPads, 20), ...flash([vias[0]], 21)]
in1.push(...line([U1.l, Y(0)], [U1.l, 6], 11), ...line([U2.r, Y(0)], [U2.r, 6], 11), ...line([4, 6], [U2.r, 6], 11))
in1.push('G36*', `X${f(12)}Y${f(2.5)}D02*`, `X${f(32)}Y${f(2.5)}D01*`, `X${f(32)}Y${f(6)}D01*`, `X${f(12)}Y${f(6)}D01*`, `X${f(12)}Y${f(2.5)}D01*`, 'G37*')
write('demo4-In1_Cu.g1', in1)

// Inner 2: VCC (U1 pin 4 left, U2 pin 4 left) rail at y=26
const vcc = [[U1.l, Y(3)], [U2.l, Y(3)]]
const in2 = [...flash(vcc, 20), ...flash([vias[1]], 21)]
in2.push(...line([U1.l, Y(3)], [U1.l, 26], 11), ...line([U2.l, Y(3)], [U2.l, 26], 11), ...line([U1.l, 26], [U2.l, 26], 11))
write('demo4-In2_Cu.g2', in2)

// Bottom: pads, U1->J1, U2->J2, via pads
const bot = [...allPads(20), ...allPads(22), ...flash(vias, 21)]
for (let i = 0; i < 4; i++) bot.push(...line([U1.l, Y(i)], J1(i), 10), ...line([U2.r, Y(i)], J2(i), 10))
write('demo4-B_Cu.gbl', bot)

fs.writeFileSync(new URL('./demo4-Edge_Cuts.gko', import.meta.url), ['%FSLAX46Y46*%', '%MOMM*%', '%ADD10C,0.1*%', 'D10*', 'G01*',
  'X0Y0D02*', `X${f(42)}Y0D01*`, `X${f(42)}Y${f(32)}D01*`, `X0Y${f(32)}D01*`, 'X0Y0D01*', 'M02*'].join('\n') + '\n')
const d = ['M48', 'METRIC,TZ', 'T1C0.800', 'T2C0.600', '%', 'T1', ...pads.map(p => `X${p[0].toFixed(2)}Y${p[1].toFixed(2)}`), 'T2', ...vias.map(p => `X${p[0].toFixed(2)}Y${p[1].toFixed(2)}`), 'M30']
fs.writeFileSync(new URL('./demo4.drl', import.meta.url), d.join('\n') + '\n')
