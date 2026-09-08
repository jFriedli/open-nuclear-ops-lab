# Instrumentation & the layered architecture

The core design rule of this project: **simulation state is never wired
directly to UI values.** Every displayed number passes through explicit
layers, so that a physical fault and a display fault can produce different
internal states while looking similar to the operator.

```
PHYSICAL PROCESS        physics.rs        the true plant state
      │
      ▼
INSTRUMENTATION         instrumentation.rs   channels: noise, bias, drift,
      │                                       stuck, failed; A/B/C redundancy
      ▼
CONTROL / PROTECTION    control.rs         reads MEASURED values only;
      │                                     controllers + trip logic
      ▼
HMI VALUES             snapshot.rs        the only thing the operator sees
      │
      ▼
OPERATOR              Angular UI          actions go back in as events
```

## The instrumentation layer

Each measured signal (`instrumentation.rs::MeasuredSignal`) has one or more
**channels**. Safety-significant signals have three (A/B/C):

- `neutron_power`, `primary_pressure`, `pzr_level`, `t_avg`,
  `sg1_level`, `sg2_level`, `rod_pos`

Everything else has a single channel.

### Per-channel model

```
if failed:      value = failure_value            (down/upscale)
elif stuck:     value = frozen_value
else:           value = truth + bias + drift_accum + noise·N(0,1)
drift_accum += drift_rate · DT
```

Noise is drawn from a **seeded** SplitMix64 → Box–Muller generator
(`rng.rs`), so a scenario with a fixed seed is fully reproducible.

### Voting

The value presented downstream is the **median** of the channels (for a
3-channel signal, the middle reading; for 2, the mean). The maximum pairwise
deviation is also computed and drives a *channel-disagreement* alarm
(`DEV_*` alarms in `alarms.rs`). This is what lets the "generic instrumentation
failure" scenario raise alarms while the plant itself stays perfectly stable.

### Hidden truth

During normal operation the operator sees **only** the voted HMI value. The
true physical state and the raw per-channel readings are exposed **only** when
instructor / debug mode (the `INSTR` button) is enabled — this sets
`Engine::set_debug(true)` and the snapshot then includes `physical` and
`channels`.

## Fault injection points (current and future)

v1 injects at two layers:

- **`physical.*`** — changes the real plant (pump trip, stuck valve, external
  reactivity, condenser degradation, loss of power).
- **`instrument.<signal>.<channel>`** — changes one channel's reading without
  touching the plant.

The layering is deliberately built so future releases can inject at *any*
level independently:

```
physical.sg1_level     the actual water level
   → transmitter        (sensor fault: noise/bias/drift/stuck/fail)
   → signal processing   (future: scaling / filtering fault)
   → controller          (future: setpoint / logic tampering)
   → network             (future: dropped / replayed / spoofed values)
   → hmi.sg1_level        (future: display-only fault)
```

A future event could modify **`hmi.sg1_level`** while leaving
**`physical.sg1_level`** and every transmitter untouched — the operator sees a
wrong number that no instrument technician can find at the sensor. The
snapshot already separates `physical`, `channels` (instrument) and `hmi`
(voted/displayed) precisely so this can be added without reworking the model.

**v1 is not a hacking simulator.** The educational objective is first to be
fluent in telling apart:

- a **process** failure (the plant really changed),
- an **instrument** failure (one or more sensors lie),
- a **control-system** failure (the automation misbehaves),
- an **operator** error (a wrong or mistimed command),

before later versions add **cyber-induced** failure as a fifth category that
can imitate any of the others.
