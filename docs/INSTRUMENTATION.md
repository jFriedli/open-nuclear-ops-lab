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

## Fault injection points

Faults can be injected at four distinct levels, each with different downstream
visibility:

```
physical.sg1_level     the actual water level  ── changes the plant itself
   │
   ▼ transmitter A/B/C   instrument.sg1_level.B  ── one channel: noise / bias /
   │                                                drift / stuck / fail.
   │                                                Voting + a disagreement
   │                                                alarm can expose it.
   ▼ voted / conditioned value
   │   signal.sg1_level   ── signal-processing fault: bias / scale / stuck /
   │                         set on the value that feeds BOTH control and the
   │                         HMI. Channels still agree — redundancy does NOT
   │                         catch it; it looks like a real process change.
   ├─────────────► control / protection / alarms / CSF  (use this value)
   │
   ▼ hmi.sg1_level       ── HMI-layer fault: bias / scale / stuck / set on the
       displayed value ONLY. Control, protection, alarms and the safety-
       function logic keep working on the true reading. The operator's gauge
       lies; an instrument technician finds nothing wrong at the sensor.
```

When an `hmi.*` or `signal.*` fault is active the UI shows a red
**INDICATION INTEGRITY** banner and marks the affected readouts
(`⚠ DISP` / `⚠ SIG`). In instructor/debug mode the snapshot also carries
`hmi_truth` — the un-faulted values — so the discrepancy is visible directly.

Try it: `hmi-spoofed-sg-level.json` freezes the SG-1 level gauge while
feedwater is lost — the reactor still trips on the true low-low level.
`signal-bias-pressure.json` biases the processed primary-pressure value high,
so the pressuriser controller cools the plant down chasing a number that all
three channels agree on.

**v1 is not a hacking simulator.** The educational objective is first to be
fluent in telling apart:

- a **process** failure (the plant really changed),
- an **instrument** failure (one or more sensors lie),
- a **control-system** failure (the automation misbehaves),
- an **operator** error (a wrong or mistimed command),

before later versions add **cyber-induced** failure as a fifth category that
can imitate any of the others.
