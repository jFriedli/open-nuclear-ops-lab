# Cyber-physical scenarios

> **Educational only.** These scenarios are a teaching aid for *recognising and
> responding to* manipulation of an industrial control system from the operator's
> seat. They run entirely inside a fictional, heavily-simplified simulator (see
> [MODEL_LIMITATIONS.md](./MODEL_LIMITATIONS.md)) and contain no exploit code,
> no real protocol details, and nothing specific to any real plant or product.
> The goal is defensive: build the instinct to distrust a single indication, to
> cross-check, and to fall back on independent and diverse safety functions.

## Why this simulator can model it

The engine is built as separate layers, and a fault can be injected into any one
of them without touching the others:

```
PHYSICAL PROCESS → INSTRUMENTATION → SIGNAL PROCESSING → CONTROL / PROTECTION → HMI → OPERATOR
```

That separation is exactly what a cyber-physical attack exploits: the attacker
changes what one layer *reports* or *commands* while the physical plant does
something else. The layer where the manipulation sits determines what the
operator can still trust.

| Manipulation | Scenario target | What still tells the truth |
|---|---|---|
| Spoof one **displayed** value | `hmi.<signal>` | control, protection, alarms, the safety-function strip |
| Bias the **processed** value feeding control *and* display | `signal.<signal>` | redundant raw channels (no disagreement alarm, though) |
| Fail / freeze a **raw channel** | `instrument.<signal>.<A\|B\|C>` | the other two channels; the voter; the disagreement alarm |
| Move a **control setpoint** silently | `control.pzr_setpoint`, `control.sg_level_setpoint` | the process response, the safety-function strip, controller demand |
| Inject an **actuator command** | `control.rods` | the process response, position indication, resulting alarms |
| **Suppress a protection trip** | `protection.reactor_trip`, `protection.turbine_trip` | the *demand-vs-actuation* alarm; the operator's manual trip |
| **Suppress an annunciator** window | `alarm.<ID>` | every other alarm; the safety strip; the process itself |

## The three shipped cyber scenarios

### `cyber-setpoint-manipulation`

The pressurizer pressure setpoint is driven down while the displayed pressure is
frozen near normal and the low-pressure alarm is suppressed. The controller
quietly depressurises the plant toward a setpoint the operator never sees.

**Detection:** the gauge and its alarm are both compromised, but the
`PRIMARY INVENTORY` safety function is derived from the true measurement and goes
off-normal. Pressurizer spray demand sitting wide open with no visible cause is a
second tell. **Response:** take the pressurizer to manual and restore pressure.

### `cyber-protection-bypass`

The automatic reactor trip is suppressed and a rod-withdrawal command is
injected. Power climbs past the high-power trip setpoint with no automatic
response.

**Detection:** one annunciator still fires — `REACTOR TRIP DEMANDED BUT NOT
ACTUATED` — because it reports the *mismatch* between demand and actuation.
Neutron power, fuel temperature and reactivity all confirm a real excursion.
**Response:** the operator's manual scram is on a separate path and still works;
use it.

### `cyber-loss-of-view`

Several unrelated displays are frozen at normal values and then both feedwater
pumps trip.

**Detection:** multiple gauges frozen at once, with alarms and the safety strip
disagreeing with them, is the signature of a manipulation rather than a random
instrument fault. **Response:** work from the alarms, the safety strip, the event
log and the still-live indications. Control, protection and the alarm system all
run on the true measurements, so auxiliary feedwater and the low-low-level
reactor trip still act.

## Defensive takeaways

- **No single indication is trustworthy on its own.** Cross-check against
  independent measurements and against the process physics.
- **The safety-function strip is derived from true instrument values**, not the
  displayed values, so it is a good tie-breaker when a gauge looks wrong.
- **Diversity matters.** A manual scram on a different path defeats a bypassed
  automatic trip; an independent alarm catches a suppressed one.
- **Setpoint and alarm integrity are part of safety.** A plant can be driven to
  an unsafe state entirely through values the operator is never shown.
