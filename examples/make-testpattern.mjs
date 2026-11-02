// Generates a test-pattern Gerber set: node examples/make-testpattern.mjs
import fs from 'node:fs'
const f = v => Math.round(v * 1e6)
const out = ['G04 Copper tape test pattern*', '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%']
const widths = [0.2, 0.3, 0.4, 0.5, 0.8, 1.0, 1.5]
widths.forEach((w, i) => out.push(`%ADD${10 + i}C,${w}*%`))
out.push('%ADD30C,2.0*%', '%ADD31R,2.0X2.0*%', '%ADD32C,1.2*%', '%ADD33R,1.0X3.0*%')
out.push('G01*')
// parallel horizontal tracks of varying width, 2 mm pitch
widths.forEach((w, i) => {
  const y = 5 + i * 3
  out.push(`D${10 + i}*`, `X${f(5)}Y${f(y)}D02*`, `X${f(35)}Y${f(y)}D01*`)
})
// pads + a via pad at each end
out.push('D30*', `X${f(40)}Y${f(8)}D03*`, `X${f(40)}Y${f(14)}D03*`)
out.push('D31*', `X${f(45)}Y${f(8)}D03*`, `X${f(45)}Y${f(14)}D03*`)
out.push('D32*', `X${f(42.5)}Y${f(20)}D03*`)
out.push('D33*', `X${f(42.5)}Y${f(26)}D03*`)
// 0.2 mm 90 degree and diagonal traces, plus an arc
out.push('D10*', `X${f(5)}Y${f(28)}D02*`, `X${f(20)}Y${f(28)}D01*`, `X${f(20)}Y${f(36)}D01*`, `X${f(30)}Y${f(36)}D01*`)
out.push(`X${f(5)}Y${f(33)}D02*`, `X${f(12)}Y${f(40)}D01*`)
out.push('D11*', `X${f(35)}Y${f(44)}D02*`, 'G75*', 'G02*', `X${f(45)}Y${f(44)}I${f(5)}J0D01*`)
// small copper pour (region)
out.push('G01*', 'G36*', `X${f(5)}Y${f(42)}D02*`, `X${f(30)}Y${f(42)}D01*`, `X${f(30)}Y${f(48)}D01*`, `X${f(5)}Y${f(48)}D01*`, `X${f(5)}Y${f(42)}D01*`, 'G37*')
out.push('M02*')
fs.writeFileSync(new URL('./testpattern-F_Cu.gtl', import.meta.url), out.join('\n') + '\n')
const o = ['%FSLAX46Y46*%', '%MOMM*%', '%ADD10C,0.1*%', 'D10*', 'G01*',
  `X0Y0D02*`, `X${f(55)}Y0D01*`, `X${f(55)}Y${f(52)}D01*`, `X0Y${f(52)}D01*`, `X0Y0D01*`, 'M02*']
fs.writeFileSync(new URL('./testpattern-Edge_Cuts.gko', import.meta.url), o.join('\n') + '\n')
const d = ['M48', 'METRIC,TZ', 'T1C0.800', '%', 'T1', `X40.00Y8.00`, `X40.00Y14.00`, `X45.00Y8.00`, `X45.00Y14.00`, `X42.50Y20.00`, 'M30']
fs.writeFileSync(new URL('./testpattern.drl', import.meta.url), d.join('\n') + '\n')
