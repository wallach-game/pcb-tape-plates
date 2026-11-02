# Copper-Tape PCB Plate Generator (v0.0.1)

Browser-only tool: Gerber copper layer in, 3D-printable plate out. Stick copper tape on the plate, cut along the V-grooves with a knife, peel the waste.

**v0.0.1 = milestone 1 (single-layer proof of concept):** load Gerber → 2D copper preview → plate with raised tracks + stepped V-groove → binary STL. Drill holes, registration pins, multilayer and 3MF come in later milestones. See `AGENT_MANUAL.md`.

## Use
Open the page, drop your Gerber files (or click *Load test pattern*), pick the copper layer, tweak parameters, *Export STL*. Parameters persist in localStorage. Bottom layers default to mirrored.

The test pattern (`examples/testpattern*`) has 0.2–1.5 mm tracks, pads, an arc, a pour and via pads: print it first and try the cut-and-peel. `examples/demo4*` is a 4-layer demo board (F, In1, In2, B + outline + drill); regenerate with `node examples/make-demo4.mjs`.

## Dev
    npm install
    npm run dev
    npm run build

Stack: Vite, `@tracespace/parser`+`plotter` (Gerber), `manifold-3d` (Clipper2-based 2D ops + watertight CSG), three.js. Pushing to `main` deploys to GitHub Pages via Actions.

## Known limits (0.0.1)
Clear polarity (LPC) and step-repeat unsupported (warned); rounded-rect pads drawn square; drill files ignored; V-groove is stepped (~0.1 mm per step).
