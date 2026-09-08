# Scenarios & the event engine

Scenarios are declarative JSON. They are a first-class subsystem
(`engine/src/scenario.rs`), not logic baked into UI components. The same event
format is used for instructor scripting and for the operator/instructor manual
fault-injection panel.

## File format

```jsonc
{
  "id": "loss-of-offsite-power",        // required, unique, non-empty
  "name": "Loss of Off-Site Power",     // required
  "description": "…",                   // shown in the picker
  "initial": "hot_full_power",          // "hot_full_power" | "hot_standby"
  "seed": 20260908,                     // PRNG seed for instrument noise
  "briefing": "…",                      // operator briefing text
  "learning_objectives": ["…", "…"],
  "events": [
    {
      "time": 20,                       // simulation seconds, 0..100000
      "target": "electrical.offsite",   // dotted path, see below
      "action": "trip",                 // verb, see below
      "value": 0,                       // optional number
      "duration": 0,                    // optional ramp length (s)
      "recover_after": 0,               // optional auto-recovery delay (s)
      "label": "Loss of off-site power" // optional log label
    }
  ]
}
```

The engine re-evaluates every event every tick from the current simulation
time, so scenarios behave identically under pause, single-step and any time
scale, and remain deterministic.

### Ramps and recovery

- `duration > 0` linearly ramps the effect over that many seconds
  (`physical.rho_external`, `condenser`, instrument `bias`).
- `recover_after > 0` automatically clears the event that many seconds after it
  starts and logs a recovery entry.

## Target vocabulary

| Target | Meaning | Typical actions |
|---|---|---|
| `physical.rho_external` | external reactivity (Δk/k) | `set`, `ramp` |
| `rcp.0` … `rcp.3` | reactor coolant pump | `trip`, `start` |
| `mfw.0`, `mfw.1` | main feedwater pump | `trip`, `start` |
| `electrical.offsite` | off-site power supply | `trip`, `restore` |
| `electrical.grid` | grid availability (load path) | `trip`, `restore` |
| `edg.a`, `edg.b` | emergency diesel availability | `fail` (value 0), `restore` |
| `valve.porv` | pressuriser relief valve | `stuck` (value = open fraction) |
| `condenser` | condenser cooling effectiveness | `degrade` (value = target 0..1) |
| `turbine` | main turbine | `trip` |
| `reactor` | reactor protection | `trip` |
| `instrument.<signal>[.<A\|B\|C>]` | one raw sensor channel | `stuck`, `drift`, `bias`, `noise`, `fail_low`, `fail_high` |
| `signal.<signal>` | the voted / processed value feeding **control *and* HMI** | `stuck`, `bias`, `scale`, `set` |
| `hmi.<signal>` | the **displayed** value only — control, protection, alarms and CSF unaffected | `stuck`, `bias`, `scale`, `set` |

`<signal>` is any key from the HMI list (`neutron_power`, `primary_pressure`,
`pzr_level`, `t_avg`, `sg1_level`, `sg2_level`, `rod_pos`, …). Omitting the
channel letter targets the first/only channel.

### Instrument fault semantics

| Action | Effect |
|---|---|
| `stuck` (value 0) | freezes the channel at its current indicated value |
| `stuck` (value N) | freezes the channel at N |
| `drift` (value R) | adds R engineering-units per second, accumulating |
| `bias` (value B) | adds a constant B (ramped over `duration` if set) |
| `noise` (value S) | adds Gaussian noise with standard deviation S |
| `fail_low` / `fail_high` | pins the channel to a downscale / upscale value |

All setpoints referenced by scenarios (trips, alarms) are **fictional
normalised teaching values** and are listed in `engine/src/control.rs`
(`mod sp`) and `engine/src/alarms.rs`.

## Shipped scenarios

Single-fault (one per required initial event type):

| File | Focus |
|---|---|
| `reactor-coolant-pump-trip.json` | flow ↔ ΔT; low-flow trip permissive |
| `feedwater-pump-trip.json` | SG mass balance; auxiliary feedwater; low-low level trip |
| `turbine-trip.json` | turbine/reactor coupling; steam dump |
| `load-rejection.json` | turbine overspeed on loss of electrical load |
| `loss-of-offsite-power.json` | trip cascade, natural circulation, diesel start |
| `emergency-diesel-failure.json` | tech-spec availability + a subsequent LOOP |
| `sg-level-transmitter-drift.json` | drifting channel skews feedwater control |
| `pressure-transmitter-stuck.json` | frozen channel + a later real transient |
| `control-rod-position-disagreement.json` | position indication vs. core power |
| `porv-stuck-open.json` | small loss-of-inventory event |
| `degraded-condenser.json` | slow BOP degradation → high-backpressure trip |
| `generic-instrumentation-failure.json` | multiple unrelated instrument faults, **no** process fault |

Combined:

| File | Focus |
|---|---|
| `station-blackout-partial.json` | LOOP + one diesel fails to start |
| `loss-of-heat-sink.json` | turbine trip → condenser loss → feed loss |
| `instrument-masked-transient.json` | failed-high level channel + stuck-open relief valve |

Fault-layer demonstrations (see [INSTRUMENTATION.md](./INSTRUMENTATION.md)):

| File | Focus |
|---|---|
| `hmi-spoofed-sg-level.json` | HMI-layer fault: frozen gauge while feedwater is lost — automation still acts |
| `signal-bias-pressure.json` | signal-processing fault: biased value fools controller + display, no channel disagreement |

## Session record & replay

Every operator command is recorded with its simulation tick. From the
Scenario / Instructor panel you can **Export current session** — a
self-contained JSON (`nol-session-v1`) with the scenario, seed, and the timed
action tape — and later **Load & replay** it. Because the engine is
deterministic and fixed-step, the replay reproduces the run exactly
(`engine/tests/layers.rs::session_export_and_replay_is_deterministic`).

## Importing your own

The Scenario / Instructor panel accepts pasted JSON. Imported files are
**untrusted input** and are validated (structure, numeric ranges, and a
whitelisted target/action vocabulary via a strict regex) both in the UI
(`scenarios.service.ts::validateScenario`) and again in the engine
(`Scenario::parse`) before anything runs.
