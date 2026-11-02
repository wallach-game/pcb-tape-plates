# Agent Manual: Copper-Tape PCB Plate Generator

## Goal

A browser-only JavaScript tool that turns PCB Gerber files into 3D-printable plates for hand-built, multilayer copper-tape prototype PCBs. It is a personal prototyping tool, not a product.

Workflow the tool supports:
1. User exports Gerber + drill files from EasyEDA Pro (KiCad etc. should work too).
2. Tool generates **one printable plate per copper layer**.
3. User prints all plates in one job, sticks a full sheet of copper tape on each plate, cuts along the grooves with a hand knife, and peels the waste tape.
4. User stacks the plates using registration pins and connects layers through the via holes.

Everything is hand-assembled. No cutter plotter, no laser, no toolhead knife, no G-code tricks.

## Plate design (per copper layer)

- **Base plate** with a flat top surface.
- **Raised tracks and pads**: the copper geometry extruded upward by `trackHeight` (default 0.2 mm, roughly the tape thickness plus adhesive; make it configurable).
- **Knife groove**: a V-shaped groove running around the outline of every copper feature (tracks, pads, copper pours).
  - Offset about 0.1 mm *outside* the copper edge, so a slightly off cut still leaves the track intact.
  - Width at the top about 0.5 mm, tapering down, so the blade tip self-centers.
  - Depth deeper than the tape thickness (default 0.4 mm) so the blade never cuts the plate surface much.
  - Must be wider than the nozzle line width, otherwise the slicer skips or bridges it.
- **Registration features**: pins and matching holes at identical XY positions on every plate (at least 2, asymmetric so a layer can't be stacked rotated). Include a clearance parameter.
- **Via and through-hole channels**: holes taken from the drill file, going through the plate, aligned across all layers. Default diameter is the drill size, with a configurable minimum.
- **Layer label**: a small embossed or engraved layer name or number on the plate edge.

## Orientation and mirroring

Bottom-side layers must be mirrored correctly so the stack matches the real board. Make mirroring an explicit per-layer setting with a sensible default, and show it in the preview so the user can verify.

## Output

- One **3MF** file containing all plates laid out side by side on one build plate, so everything prints in one job with one shared profile. Offer a "single layer per file" option and plain STL export too.
- Plate size limit is configurable (default 220 x 220 mm, for example); warn if the board doesn't fit and offer auto-layout.
- No pauses or filament changes. The part geometry is the whole job.

## Input

- Gerber RS-274X files (copper layers, board outline) plus Excellon drill files.
- Parse with the existing library `tracespace` (or a similar maintained one); don't write a Gerber parser from scratch.
- Handle: traces (draws with apertures), pads (flashes), regions/pours, and clear polarity if the parser exposes it. Unsupported features should produce a visible warning, not silent wrong output.
- Auto-detect layer types from file names or extensions, and let the user remap manually.

## Geometry pipeline

1. Parse the Gerber into 2D shapes per layer.
2. Convert to polygons and union them (use `clipper-lib` / `clipper2` for union and offsetting).
3. Raised area = copper polygons.
4. Groove ring = (copper offset out by `grooveOffset + grooveWidth/2`) minus (copper offset out by `grooveOffset`).
5. Extrude: plate, then tracks, then V-groove cut (use a tapered cross-section, not a plain slot), then holes and pins.
6. Mesh output via a robust CSG or manifold library (e.g. `manifold-3d` WASM) so the models stay watertight for slicers.
7. Export 3MF (zip with XML; there are JS libs, or write it by hand) with correct units (mm).

## Tech stack

- Plain JS or TypeScript, Vite, no backend; everything runs client-side so Gerber files never leave the machine.
- three.js for the 3D preview, with a layer toggle and a groove/tracks view.
- UI kept minimal: file drop, layer list with checkboxes, parameter panel, preview, Export button.

## Parameters (all configurable, with defaults)

| Parameter | Default |
|---|---|
| trackHeight | 0.2 mm |
| plateThickness | 1.5 mm |
| grooveOffset | 0.1 mm |
| grooveWidthTop | 0.5 mm |
| grooveDepth | 0.4 mm |
| registrationPinDiameter | 3 mm |
| registrationClearance | 0.2 mm |
| minViaHole | 0.6 mm |
| plateSpacing (on build plate) | 5 mm |
| boardMargin | 5 mm |

Save and load parameter presets (localStorage) so the user can tune them to their printer and tape.

## Milestones

1. **Single-layer proof of concept**: load Gerber, show 2D copper preview, generate plate with raised tracks and V-groove, export STL. Print it and test the cut-and-peel step before building anything else.
2. **Registration and vias**: drill file parsing, holes, pins, aligned across layers.
3. **Multilayer**: multiple plates, mirroring, side-by-side layout, 3MF export.
4. **Polish**: presets, warnings, layer labels, better preview.

## Acceptance criteria

- A 2-layer board exported from EasyEDA Pro produces two plates, and the printed plates stack with aligned vias.
- The exported models are watertight and slice without errors in PrusaSlicer.
- Groove cutting by hand leaves tracks intact for 0.2 mm tracks (test pattern included as a built-in example).

## Non-goals (for now)

- PrusaSlicer plugin (it has no real plugin API; the 3MF is the integration point).
- Machine cutting, laser cutting, automatic tape placement.
- Printed negative-fill inserts. This is a possible later feature: a separate printed piece that fills the gaps around tracks after peeling, to give a flat surface for the next layer. Don't build it in the first versions.

## Open questions to ask the user before or during milestone 1

- Tape width and thickness in use (affects `trackHeight` and `grooveDepth`).
- Printer build volume and nozzle size.
- How layers connect through vias (solder, conductive paste, rivets), as this decides hole diameter and pad treatment.
- What the next layer sits on after the peel, since the gaps around the tracks leave a non-flat surface.

## Working rules for the agent

- Build milestone 1 first and stop for the user to print and test it.
- Keep units in mm throughout and name parameters with units in the code.
- Prefer existing libraries for parsing, polygon operations and mesh CSG.
- Ship an example Gerber set in the repo with a test pattern (varying track widths, pads, a via).
- Keep the UI and code simple; this is a personal tool.
