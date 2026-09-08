# Development

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Rust | stable (1.98+) | `rustup target add wasm32-unknown-unknown` |
| wasm-pack | 0.15+ | `cargo install wasm-pack` or the install script |
| Node.js | 20+ | |
| npm | 10+ | |

## Layout

```
engine/        Rust simulation engine → compiled to WASM
  src/
    physics.rs         layer 1 - the physical process
    instrumentation.rs layer 2 - sensors & channels
    control.rs         layer 3 - controllers + reactor/turbine protection
    alarms.rs          latched alarm model
    scenario.rs        event / scenario engine
    snapshot.rs        layer 4 - the HMI snapshot + Critical Safety Functions
    rng.rs             deterministic PRNG
    lib.rs             wasm-bindgen `Engine`, operator actions, event log
  tests/               physics-validation, scenario & determinism tests
app/           Angular 20+ front end (standalone, zoneless, signals)
  src/app/
    sim/       Web Worker + SimService (owns the engine, fixed-step clock)
    core/      persistence (localStorage + IndexedDB), scenarios, trends
    ui/        shared widgets, CSF strip, trend canvas
    views/     one component per screen
  scripts/build-wasm.mjs   builds the engine and stages artefacts
  e2e/         Playwright tests against the production build
scenarios/     canonical scenario JSON (copied into app/public at build)
```

## Common tasks

```bash
# from repo root - engine
cd engine
cargo test            # unit + physics-validation + scenario regression tests
cargo clippy --all-targets -- -D warnings
cargo fmt

# from app/
cd app
npm ci
npm run build:wasm    # compile engine → src/wasm + public/nol_engine_bg.wasm
npm start             # dev server on http://localhost:4200
npm test -- --no-watch   # vitest unit tests
npm run build            # production build (runs build:wasm first via prebuild)
npx playwright test      # e2e against the built app (auto-starts a static server)
```

If you change anything in `engine/`, re-run `npm run build:wasm` before the
Angular build or tests.

## Architecture rules (please keep these)

1. **Never read simulation state directly in a component.** Everything comes
   from the `SimService.snapshot()` signal, which is the engine's HMI layer.
2. **Physics runs in the worker only.** The UI publishes snapshots at ~15 Hz
   while physics steps at 50 Hz; Angular change detection never sees a physics
   step.
3. **Faults are events, not component code.** Add a target/action to
   `scenario.rs`, not a special case in a view.
4. **Determinism is a feature.** Any change to the engine must keep
   `engine/tests/` green, including the "identical runs" and "pause/step"
   tests.
5. **All setpoints are fictional.** Keep them in `control.rs`/`alarms.rs`,
   commented, and never claim they match a real plant.

## Adding a scenario

1. Add `scenarios/<name>.json` (see [SCENARIOS.md](./SCENARIOS.md)).
2. Run `node app/scripts/… ` - actually just re-run the small index builder:
   the `scenarios/index.json` used by the app is regenerated from
   `app/public/scenarios/` at build time; during development copy your file
   into `app/public/scenarios/` and add it to `index.json`, or re-run the
   copy snippet in `scripts/`.
3. Add it to the `SCENARIOS` list in `engine/tests/scenarios.rs` so it is
   covered by the "loads and runs stably" and "is deterministic" tests.

## Deployment

`.github/workflows/ci.yml` runs the engine checks, the frontend unit + e2e
tests, then (on `main`) builds with `--base-href /<repo>/`, adds a
`404.html` SPA fallback and `.nojekyll`, and publishes to GitHub Pages via
`actions/deploy-pages`.
