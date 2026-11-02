# Copper-Tape PCB Plate Generator (v0.0.2)

Browser-only tool: Gerber copper layer in, 3D-printable plate out. Stick copper tape on the plate, cut along the V-grooves with a knife, peel the waste.

**v0.0.2:** Gerber + Excellon (or an EasyEDA/KiCad export .zip) in; per-layer plates out with via holes, registration pin holes (+ separate pin part), two plate styles (knife groove, or separate base/tracks/negative), stack-up and exploded 3D view; export STL or one 3MF with all plates laid out on the bed and PrusaSlicer settings embedded (infill, per-object layer height, fine layer-height range around the groove/track zone). The PrusaSlicer metadata is untested in PrusaSlicer itself; see below.

## Use
Open the page, drop your Gerber files (or click *Load test pattern*), pick the copper layer, tweak parameters, *Export STL*. Parameters persist in localStorage. Bottom layers default to mirrored.

The test pattern (`examples/testpattern*`) has 0.2–1.5 mm tracks, pads, an arc, a pour and via pads: print it first and try the cut-and-peel. `examples/demo4*` is a 4-layer demo board (F, In1, In2, B + outline + drill); regenerate with `node examples/make-demo4.mjs`.

## Dev
    npm install
    npm run dev
    npm run build

Stack: Vite, `@tracespace/parser`+`plotter` (Gerber), `manifold-3d` (Clipper2-based 2D ops + watertight CSG), three.js. Pushing to `main` deploys to GitHub Pages via Actions.

## PrusaSlicer notes
The 3MF carries per-object infill and layer height in Metadata/Slic3r_PE_model.config and height ranges in Metadata/Prusa_Slicer_layer_config_ranges.xml. Check after opening that objects show the expected layer-height ranges; report anything it ignores.

## Known limits
Clear polarity (LPC) and step-repeat unsupported (warned); rounded-rect pads drawn square; drill slots (G85) unsupported; V-groove is stepped (~0.1 mm per step).
