# Physics model

> **Educational only.** Every equation and constant below is a *simplified,
> fictional teaching value*. Nothing here is validated for engineering,
> safety, or licensing use, and none of it corresponds to a real plant.
> See [MODEL_LIMITATIONS.md](./MODEL_LIMITATIONS.md).

The engine (`engine/src/`) is a deterministic, fixed-timestep,
lumped-parameter model. The physics timestep is **DT = 0.02 s** (50 Hz) and is
never varied; simulation time is `ticks * DT` and is kept entirely separate
from wall-clock time.

All state lives in `physics.rs::PhysicalState`. One `step()` call advances,
in order: rod motion → CVCS / safety-injection / boron → reactivity → point
kinetics → decay heat → xenon → thermal-hydraulics → secondary →
turbine/generator → electrical → containment.

---

## 1. Neutronics - point kinetics with six delayed groups

Normalised so that `n = 1` is rated fission power. Precursor concentrations
`Cᵢ` are also normalised.

```
dn/dt   = ((ρ − β)/Λ)·n + Σᵢ λᵢ·Cᵢ
dCᵢ/dt  = (βᵢ/Λ)·n − λᵢ·Cᵢ
```

| Symbol | Meaning | Value used |
|---|---|---|
| Λ | prompt neutron generation time | 2.0 × 10⁻⁴ s |
| βᵢ | delayed fractions (6 groups) | 2.10e-4, 1.40e-3, 1.26e-3, 2.53e-3, 7.40e-4, 2.70e-4 |
| λᵢ | precursor decay constants (s⁻¹) | 0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01 |
| β | Σβᵢ | ≈ 6.50 × 10⁻³ |

**Integration.** A semi-implicit (backward-Euler-flavoured) update is used so
the stiff prompt term stays stable at DT = 0.02 s:

```
n⁺  = (n + DT·ΣλᵢCᵢ) / (1 − DT·(ρ−β)/Λ)
Cᵢ⁺ = (Cᵢ + DT·(βᵢ/Λ)·n⁺) / (1 + DT·λᵢ)
```

Reactivity is clamped to `ρ < β` before this step (prompt-critical excursions
are outside the scope of this teaching model), and `n` is floored at 1e-9 and
capped at 50 for numerical safety.

Equilibrium precursors used for the initial condition: `Cᵢ = βᵢ / (Λ·λᵢ)`.

## 2. Reactivity balance

```
ρ = ρ_rods + ρ_fuel + ρ_mod + ρ_xenon + ρ_boron + ρ_external + ρ_scram + ρ_bias
```

* **Rods** - integral worth over the bank travel `x ∈ [0,1]` (1 = withdrawn):
  `ρ_rods = ROD_WORTH · (x − sin(2πx)/2π)`, a mild S-curve.
  `ROD_WORTH = 0.028` (2 800 pcm).
* **`ρ_bias`** is computed once at initialisation so that the hot-full-power
  reference state is exactly critical (ρ = 0).
* **Doppler (fuel):** `ρ_fuel = α_f·(T_fuel − 605)`, `α_f = −2.6 × 10⁻⁵ /°C`.
* **Moderator temperature:** `ρ_mod = α_m·(T_mod − 305)`,
  `α_m = −2.0 × 10⁻⁴ /°C`.
* **Xenon:** `ρ_xenon = −XE_WORTH·(Xe − 1)`, `XE_WORTH = 0.028`.
* **Boron:** `ρ_boron = α_b·(C_B − C_B,ref)`, `α_b = −7.5 × 10⁻⁶ /ppm`,
  `C_B,ref = 900 ppm`. The term is exactly zero at the reference concentration,
  so `ρ_bias` (and every existing initial condition) is unaffected. See §5a.
* **External:** injected by scenario events (`physical.rho_external`).
* **Scram:** `−0.15` (15 000 pcm) held for as long as the reactor is tripped.

Both temperature coefficients are negative, giving the model its inherent
stability: a power rise heats the fuel and coolant, which pushes power back
down.

## 3. Decay heat - three-group

```
dδⱼ/dt = kⱼ·n − λ_δⱼ·δⱼ        decay_heat = Σ δⱼ
```

| Group | λ_δ (s⁻¹) | k | Equilibrium share (k/λ) |
|---|---|---|---|
| 1 | 0.10 | 3.0e-3 | 0.030 |
| 2 | 0.010 | 2.5e-4 | 0.025 |
| 3 | 0.0011 | 1.65e-5 | 0.015 |

Total ≈ **7 %** of rated power at equilibrium. After a trip the fast group
decays in ~10 s, the slow group over ~15 min - the qualitative shape of a real
decay-heat curve, but a coarse fit, not the ANS standard.

## 4. Xenon / iodine

Normalised so `I = Xe = 1` at full-power equilibrium:

```
dI/dt  = λ_I·n − λ_I·I
dXe/dt = (λ_Xe + σφ − λ_I) + λ_I·I − (λ_Xe + σφ·n)·Xe
```

with `λ_I = 2.9e-5`, `λ_Xe = 2.1e-5`, `σφ = 3.0e-5` (all s⁻¹). This reproduces
the post-trip xenon peak qualitatively.

## 5. Thermal-hydraulics

### Fuel node
```
C_f·dT_fuel/dt = P_fission + P_decay − Q_fuel→cool
P_fission = 0.93·n·P_rated      P_decay = decay_heat·P_rated
Q_fuel→cool = h_fc·(T_fuel − T_mod)
```
`P_rated = 1000 MW` (fictional), `C_f = 20 MJ/°C`, `h_fc = 3.333 MW/°C`, chosen
so `h_fc·(605 − 305) = 1000 MW` at full power. The 0.93 factor splits rated
power into 93 % prompt/delayed fission + 7 % decay heat at equilibrium.

### Primary coolant (single lump, T_mod ≈ T_avg)
```
C_p·dT_mod/dt = Q_fuel→cool − Σ Q_SGk
C_p = 1100 MJ/°C
```

### Loop temperatures (algebraic split by flow, then first-order transport lag)
```
w·cp = flow · 33 MW/°C          (rated ΔT ≈ 30 °C)
T_hot  ← T_mod + Q_fuel→cool /(2·w·cp)
T_cold ← T_mod − Σ Q_SG        /(2·w·cp)
```

### Primary flow
Target flow is a step function of running RCPs (4→1.0, 3→0.78, 2→0.55,
1→0.30, 0→0.06 natural circulation), approached with a first-order lag
(τ = 8 s coastdown, 3 s runup).

### Pressuriser / primary pressure
Level responds to coolant thermal expansion (insurge/outsurge), to relief
flow, and to the CVCS / SI / leak flows of §5a; pressure is driven by heaters
(+), spray (−), the relief valve (−), safety-injection makeup (+), a
loss-of-coolant break (−), insurge compression of the steam bubble (+) and a
self-restoring bubble term. `dP/dt` is clamped to ±2.5 MPa/s. An automatic
PORV modulates above 16.4 MPa.

## 5a. Primary chemistry, safety injection & containment

All fictional teaching values; see [MODEL_LIMITATIONS.md](./MODEL_LIMITATIONS.md).

**CVCS (charging / letdown).** Two demands `∈ [0,1]`. The net makeup
`charging − letdown` adds to pressuriser level (gain 2.5 %/s at full swing). A
containment phase-A isolation forces `letdown = 0`; a safety-injection signal
forces `charging = 1`.

**Boron.** One lumped concentration `C_B` (ppm):

```
dC_B/dt = boron_rate + f_inj·MIX·(C_B,src − C_B)
```

`boron_rate` is the operator borate (+) / dilute (−) command (ppm/s),
`C_B,src = 2400 ppm` is the borated-source concentration, `f_inj` is the SI +
accumulator flow and `MIX = 0.9`. Normal charging is blended at the current
concentration and has no net effect.

**Safety injection.** The protection layer (`control.rs`) latches the SI signal
on low measured primary pressure (< 11.5 MPa) or high containment pressure
(> 20 kPa); it also trips the reactor. Physics then delivers:

* **High-head SI pumps** — fixed `0.012` (fraction-of-rated) while actuated
  *and* the essential bus is energised.
* **Accumulators** — passive `0.05` flow whenever primary pressure < 4.2 MPa,
  drawn from a finite inventory (`accumulator_frac`, 1 → 0).

**Loss of coolant.** A scenario `loca` / `valve.break` event sets a break
fraction `b ∈ [0,1]`; the leak to containment is
`b·0.085·√(P/15.5) + 0.02·PORV` in fraction-of-rated units. It drains
pressuriser level (gain 55 %/s) and depressurises the primary (45 MPa·s⁻¹ per
unit).

**Containment (single volume).**

```
dp_c/dt   = 260·leak − (0.05 + spray·0.9)·p_c        [kPa]
dT_c/dt   = (30 + 0.35·p_c − T_c) / τ                 τ = 70 s, 20 s with spray
dsump/dt  = 9·leak + 3·f_inj                          [%]
```

Spray latches on high-high containment pressure (140 kPa) and needs the
essential bus. Phase-A isolation latches with the SI signal or at 20 kPa.

## 6. Secondary / steam generators (×2)

Per SG, normalised inventory and pressure:
```
steam_prod   = Q_SG / 500 MW              (fraction of rated)
steam_flow   ← demand·(0.6 + 0.4·P_SG/6.9)   demand = throttle·load + dump
d(inventory) = (fw_flow − steam_flow)·0.02
dP_SG/dt     = 1.1·(steam_prod − steam_flow)   (clamped ±1.5 MPa/s)
level%       = 20 + 45·inventory + shrink/swell
```
Saturation temperature is a quadratic fit anchored at 6.9 MPa → 285 °C.
Feedwater flow follows the controller valve demand capped by running-pump
capacity (0.55 rated per main pump); auxiliary feedwater adds ~0.09 when
actuated automatically on low level.

## 7. Turbine / generator

* Throttle valve tracks the load controller (fast-closes on trip).
* Mechanical power ≈ admitted steam × rated electrical power × backpressure
  penalty.
* **Synchronised** (breaker closed, grid available): shaft locked to
  synchronous speed; generator MW follows shaft power.
* **Islanded / load rejection:** breaker opens, shaft accelerates on a lumped
  inertia; overspeed > 111 % forces a turbine trip; tripped shaft coasts down.
* Condenser backpressure rises as effectiveness degrades and penalises turbine
  output; a high-backpressure turbine trip is modelled.

## 8. Electrical (heavily simplified - not a real topology)

Boolean/first-order model of: off-site grid, main generator, one essential
bus, two emergency diesel generators (EDG A/B with 3 s / 5 s start timers),
and a 125 VDC station battery (~4 h endurance, recharges when AC present).

* Essential bus energised if `generator` OR `off-site` OR `an EDG running`.
* EDGs auto-start when the bus loses all AC; shed when AC returns.
* RCPs and main feedwater pumps are powered **only** from off-site power or the
  main generator - never the diesels. This is what makes "loss of off-site
  power" force natural circulation.

## 9. Conservation checks

At steady full power the automated tests assert that heat into the primary
(`core_heat_mw`) matches heat removed by the two steam generators to within
12 %, and that core heat stays within 120 MW of rated. These are coarse
qualitative checks, not an energy-balance proof.

## Determinism

Given the same scenario JSON, seed and sequence of operator actions at the
same tick counts, the engine produces bit-identical snapshots. The only
stochastic element is instrument noise, driven by a seeded SplitMix64 PRNG
(`rng.rs`). Integration is fixed-step, so `step(500)` ≡ `500 × step(1)`.
Regression tests in `engine/tests/` enforce this.
