# Model limitations

**Read this before drawing any conclusion from the simulator.**

Open Nuclear Ops Lab is a teaching toy. It exists to build intuition about how
the *concepts* in a PWR-like plant fit together and to practice distinguishing
process faults from instrument faults. It is deliberately not accurate.

## What this is not

- Not a tool for operating, designing, analysing, or licensing any reactor.
- Not a source of training credit or operator qualification.
- Not a model of any specific real plant. Every setpoint, coefficient,
  capacity, and topology is invented for teaching.
- Not validated against experiment, benchmark, or reference code.

## Known simplifications

### Neutronics
- Point kinetics only — **no spatial effects**: no flux tilt, no rod-shadowing,
  no axial offset, no local peaking, no reflector.
- Single fuel temperature node; no gap conductance or clad model.
- Prompt-critical excursions are clamped away, not modelled.
- Xenon and iodine are a two-state normalised approximation; samarium,
  burn-up, and boron let-down/dilution dynamics are not modelled (boron is a
  fixed background baked into `ρ_bias`).

### Thermal-hydraulics
- Single-phase primary only. **No boiling, no CHF/DNB, no two-phase natural
  circulation, no reflux condensation, no voiding.**
- One lumped primary coolant node; hot/cold legs are algebraic splits with a
  transport lag, not a flow network.
- Pressuriser is a lumped level+pressure heuristic, not a two-region
  (steam/water) thermodynamic model. No surge-line, no rapid
  depressurisation / flashing physics.
- No real steam tables; saturation temperature is a low-order polynomial fit.
- Steam-generator inventory and level are normalised heuristics with a crude
  shrink/swell term; no downcomer/riser, no tube-bundle model.
- No primary or secondary chemistry, no radiological model, no containment
  thermodynamics. "Containment / barrier status" is a placeholder derived only
  from primary pressure and temperature.

### Balance of plant
- Turbine is a single lumped stage: no extraction, no moisture separator
  reheater, no governor-valve detail, no thrust/vibration.
- Condenser is a single backpressure state driven by an "effectiveness"
  number; no circulating-water system, no air ejectors, no hotwell level.
- Feedwater is a capacity limit plus a valve demand; no heater string, no
  feed pump curves, no condensate system.

### Electrical
- A conceptual model of five or six nodes, **not a one-line diagram**. No
  voltage, frequency, real/reactive power flow, protective relaying,
  load sequencing, bus transfer schemes, or breaker coordination.
- Battery endurance is a single time constant.

### Protection & control
- All trip and control setpoints are fictional, normalised values. There is no
  attempt to reproduce any real reactor protection system, its channels,
  coincidence logic, bypasses, or response times.
- Controllers are simple PI/lead heuristics, not the real plant's control
  system.

### Instrumentation
- Faults available: added noise, fixed bias, linear drift, stuck-at-value,
  fail low/high. No non-linearity, hysteresis, calibration-shift-with-
  temperature, EMI, common-cause failure modelling, or sensor time constants
  beyond a first-order lag.

### Numerics
- Fixed 0.02 s explicit/semi-implicit stepping. Very fast transients (large
  break LOCA, prompt excursions, fast bus faults) are out of scope and will
  simply be clamped or damped.

## What it does do reasonably

Within its scope, the model shows the correct *direction* and rough *time
scale* of: rod-driven power changes, negative temperature feedback, the
prompt-drop / decay-heat tail after a trip, loss of heat sink raising primary
temperature, feedwater loss draining the steam generators, loss of off-site
power forcing natural circulation and diesel start, and instrument faults
producing HMI symptoms that differ from the true plant state.

Treat every number as illustrative.
