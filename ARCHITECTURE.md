# Architecture

## Goals

- A browser-based, **local-only** operator-training-style simulator for a
  fictional PWR-like plant.
- No backend, no auth, no database, no server-side anything. Static hosting
  (GitHub Pages).
- A simulation core that is deterministic and cleanly layered, so that future
  versions can inject instrumentation and cyber-physical faults at distinct
  levels without rewriting the model.

## High-level picture

```
┌─────────────────────────── browser tab ───────────────────────────┐
│                                                                   │
│   Angular UI (zoneless, signals)         Web Worker                │
│   ┌───────────────────────┐              ┌──────────────────────┐  │
│   │ views/ (11 screens)   │  actions →   │  sim.worker.ts       │  │
│   │ SimService (signals)  │ ◀ snapshots  │  fixed-step clock    │  │
│   │ TrendsService (ring)  │   ~15 Hz     │  ┌────────────────┐  │  │
│   │ Persistence (IDB/LS)  │              │  │ nol-engine     │  │  │
│   └───────────────────────┘              │  │ (Rust → WASM)  │  │  │
│                                          │  │  50 Hz physics │  │  │
│                                          │  └────────────────┘  │  │
│                                          └──────────────────────┘  │
│   localStorage: preferences        IndexedDB: custom scenarios     │
└───────────────────────────────────────────────────────────────────┘
```

Nothing leaves the browser. Scenario JSON is bundled as a static asset;
imports/exports are copy-paste or file-local.

## The four simulation layers

See [docs/INSTRUMENTATION.md](./docs/INSTRUMENTATION.md) for detail.

| Layer | Module | Responsibility |
|---|---|---|
| Physical process | `engine/src/physics.rs` | true plant state, lumped-parameter ODEs, fixed 0.02 s step |
| Instrumentation | `engine/src/instrumentation.rs` | per-channel noise / bias / drift / stuck / fail; A/B/C voting |
| Signal processing | `engine/src/instrumentation.rs` + `faults.rs` | post-vote conditioning faults (`signal.*`) that feed both control and HMI |
| Control & protection | `engine/src/control.rs` | PI-ish controllers, reactor & turbine trip logic - **reads measured values only** |
| HMI | `engine/src/snapshot.rs` + `faults.rs` | the single snapshot the operator/UI sees; `hmi.*` display-only faults; Critical Safety Functions derived from multiple signals |

Faults can be injected at any of these levels independently - see
[docs/INSTRUMENTATION.md](./docs/INSTRUMENTATION.md). An `hmi.*` fault changes
only what the operator sees; control, protection, alarms and the safety-
function logic keep acting on the true reading.

Alarms (`alarms.rs`) are a real latched model (active/cleared ×
acknowledged/unacknowledged, history, priorities), evaluated on measured
values. The scenario engine (`scenario.rs`) is a standalone subsystem that
mutates the physical layer and the instrumentation layer via declarative
events.

## The clock

- Physics timestep is fixed at **0.02 s** and never varies.
- The worker advances the engine in whole timesteps per publication frame; the
  number of steps depends only on the number of frames and the speed setting,
  not on timestamp jitter. This keeps runs reproducible and keeps the physics
  loop off the main thread.
- Simulation time (`ticks · dt`) is completely separate from wall-clock time.
- Speeds: pause, single-step (0.2 s), 0.25× / 0.5× / 1× / 2× / 5× / 10×.

## Why Angular

The brief preferred it and it fits well: standalone components, the new
zoneless + signals model maps cleanly onto "one immutable snapshot in, OnPush
everywhere", and lazy-loaded routes keep each screen a separate chunk. No
compelling reason to deviate, so we didn't.

## Why Rust → WASM

- Determinism and numerical control are easier to guarantee than in JS.
- The engine is a pure library with its own test suite, decoupled from the UI.
- Runs comfortably at 50 Hz in a worker on a laptop or phone.

## Persistence

- **localStorage** - preferences (debug mode, default speed, trend selection
  and window, last scenario).
- **IndexedDB** - user-imported / custom scenarios (larger, and untrusted, so
  validated on the way in).
- Trend history is an in-memory column-oriented ring buffer (bounded, oldest
  samples decimated) - never persisted.

## Deployment

Static build → `app/dist/app/browser` → GitHub Pages. `index.html` is copied
to `404.html` for SPA deep-link fallback; `.nojekyll` disables Jekyll
processing. Base href is set to the repository name at build time.
