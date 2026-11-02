# Project notes for agents (read AGENT_MANUAL.md first for the goal)

Copper-tape PCB plate generator: browser-only (Vite + vanilla JS). Gerber/Excellon in, 3D-printable plates out (STL / 3MF with PrusaSlicer per-object settings). Live: GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main`.

## Run
- `npm run dev` (http://localhost:5173, query params: `?demo4`, `?example`, `&3d`, `&exploded`, `&separate`), `npm run build`.
- Local-only scratch folder `.tmp/` is git-ignored (test scripts, sliced G-code).

## Code map
- `src/gerber.js`: tracespace parse+plot -> manifold `CrossSection`. The plotter merges same-aperture draws into one path with disjoint segments, so `flattenContours` splits at gaps. Clear polarity (LPC) is NOT supported (warned).
- `src/excellon.js`: drill parser (round holes; G85 slots skipped with a warning).
- `src/plate.js`: `buildPlate`. Styles: `groove` (one plate, stepped V-groove) and `separate` (base with raised tracks + separate negative filler). Cuts drill holes and registration holes (3 corners, mirrored with the layer). `effectiveGrooveDepth` keeps thin plates from being cut through.
- `src/threemf.js`: 3MF writer (+ `Slic3r_PE_model.config`, optional `Prusa_Slicer_layer_config_ranges.xml`).
- `src/main.js`: UI, stack-up panel, 3D view (explode, negative overlay, via lines), exports, `.ini` tool, EasyEDA design-rules tool.

## Findings from testing with the PrusaSlicer 2.9.4 CLI (do not re-learn these)
- A layer-range entry WITHOUT `layer_height` segfaults PrusaSlicer. Ranges are only emitted when needed; thin plate + uniform layer height exports no ranges.
- `first_layer_height` is a global print setting. Per-object value in the 3MF is ignored; a partial config in the 3MF is ignored or crashes; only a complete config applies (and would replace the user's profile). A one-line `.ini` import breaks the profile in the GUI. Working approach: the user exports their FULL config (File > Export > Export Config), the site changes only `first_layer_height` and appends " pcb mode" to preset names (printer rename optional, it may detach the bed model).
- Stock profiles use a 0.2 mm first layer, which swallows a 0.12 mm plate (grooves then cut through the first layer, tracks detach). The "Preset: stock slicer profile" button uses plate 0.2 / tracks 0.18 / fine layer 0.06 / separate style.
- `first_layer_extrusion_width = 200%` made the first layer ~4x longer on large solid areas (1h41m vs 22-29 min with width 0). Profile issue, not code.
- Per-object keys that work from the 3MF: `layer_height`, `fill_density`, `fill_pattern`, `perimeters`. Free-form box in the UI adds more.
- 0.4 mm nozzle: tracks below ~0.45 mm print as one 0.45 mm line; 0.5 mm is the practical minimum, 0.9 mm = two lines. Gap between tracks needs line (0.45) + 2x negative clearance (0.2) ~ 0.85-0.9 mm for the negative filler to print.
- How to test: generate a 3MF with the same code, slice with `prusa-slicer-console.exe --load <flattened ini> --export-gcode`, then parse G-code (`;Z:`, `;TYPE:`). Vendor profiles in `resources/profiles/*.ini` need their `inherits` chain flattened first.

## EasyEDA Pro notes
- Pro cannot export to KiCad directly (docs: only .zip/.epro). KiCad can import Pro projects.
- Design-rule export JSON: `Physics/Track` (min/default/max), `Physics/Via Size`, `Spacing/Safe Spacing` (13x13 lower-triangular matrix, rows/cols 0-7 are copper objects), `Spacing/Other Spacing` (hole2Hole). The tool changes only these numbers.
- The editor loads its code from `modules.lceda.cn`; on the user's work network that host was unreachable (TCP 443 dropped), so the editor could not start there.
- Fill Region: set its Layer to a non-copper layer for "no copper". Copper Region has only Full Fill / 45 / 90 degree net.

## Working on Windows from the agent shell
- Writing JS through shell heredocs mangles backslashes and `\n`; write patch scripts as files with the Write tool, then run them.
- Never kill `node.exe` by name; stop dev/preview servers by port (`Get-NetTCPConnection -LocalPort N` then `Stop-Process`).

## Open items
- "Assembled" toggle for via lines (mirrored layers make them cross in the printed-orientation view).
- Cut outline cutouts / routed slots (G85) through the plates (currently only round holes).
- EasyEDA zip import untested with a real export; clear polarity unsupported.
- User reported PrusaSlicer crashing when deleting a sliced object; unverified (cannot test GUI from CLI).
