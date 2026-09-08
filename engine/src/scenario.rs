//! Event / scenario engine — a first-class subsystem.
//!
//! Scenarios are declarative JSON (see `docs/SCENARIOS.md`). Each event targets
//! a component or an instrument channel at a given simulation time, with an
//! optional ramp and an optional recovery. The runner is re-evaluated every
//! tick from simulation time, so it stays deterministic under time-scaling,
//! pause and single-step.

use crate::faults::LayerFault;
use crate::instrumentation::Instrumentation;
use crate::physics::{PhysicalState, PhysicsInputs};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ScenarioEvent {
    /// Simulation time (seconds) at which the event begins.
    pub time: f64,
    /// Dotted target path, e.g. `rcp.0`, `electrical.offsite`,
    /// `instrument.sg1_level.B`, `physical.rho_external`.
    pub target: String,
    /// Action verb: `set`, `ramp`, `trip`, `start`, `stuck`, `drift`, `bias`,
    /// `fail_low`, `fail_high`, `degrade`, `restore`, `clear`.
    pub action: String,
    #[serde(default)]
    pub value: f64,
    /// Ramp duration (seconds); 0 = step change.
    #[serde(default)]
    pub duration: f64,
    /// Optional automatic recovery, N seconds after the event begins.
    #[serde(default)]
    pub recover_after: f64,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Scenario {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_initial")]
    pub initial: String,
    #[serde(default = "default_seed")]
    pub seed: u64,
    #[serde(default)]
    pub events: Vec<ScenarioEvent>,
    #[serde(default)]
    pub briefing: String,
    #[serde(default)]
    pub learning_objectives: Vec<String>,
}

fn default_initial() -> String {
    "hot_full_power".to_string()
}
fn default_seed() -> u64 {
    424_242
}

impl Scenario {
    pub fn stable_baseline() -> Self {
        Scenario {
            id: "baseline".into(),
            name: "Stable Full Power (no faults)".into(),
            description: "Plant holds ~100% power. Free-play / familiarisation.".into(),
            initial: "hot_full_power".into(),
            seed: 424_242,
            events: vec![],
            briefing: "Observe stable trends. Use the instructor panel to inject faults.".into(),
            learning_objectives: vec![],
        }
    }

    pub fn parse(json: &str) -> Result<Self, String> {
        let mut s: Scenario = serde_json::from_str(json).map_err(|e| e.to_string())?;
        // ---- validate: imported files are untrusted input ----
        if s.id.trim().is_empty() {
            return Err("scenario id must not be empty".into());
        }
        if s.events.len() > 500 {
            return Err("too many events (max 500)".into());
        }
        for (i, e) in s.events.iter().enumerate() {
            if !e.time.is_finite() || e.time < 0.0 || e.time > 100_000.0 {
                return Err(format!("event {i}: time out of range"));
            }
            if !e.value.is_finite() || !e.duration.is_finite() || e.duration < 0.0 {
                return Err(format!("event {i}: invalid value/duration"));
            }
            if e.target.len() > 64 || e.action.len() > 24 {
                return Err(format!("event {i}: target/action too long"));
            }
        }
        if !matches!(s.initial.as_str(), "hot_full_power" | "hot_standby") {
            s.initial = "hot_full_power".into();
        }
        s.events
            .sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());
        Ok(s)
    }

    pub fn initial_state(&self) -> PhysicalState {
        match self.initial.as_str() {
            "hot_standby" => PhysicalState::hot_standby(),
            _ => PhysicalState::hot_full_power(),
        }
    }
}

/// Applied-event record for the event log.
#[derive(Clone, Debug, Serialize)]
pub struct AppliedEvent {
    pub sim_time: f64,
    pub target: String,
    pub action: String,
    pub value: f64,
    pub label: String,
    pub phase: String, // "start" | "recover"
}

pub struct ScenarioRunner {
    pub scenario: Scenario,
    /// Which events have already been announced (start / recover).
    announced_start: Vec<bool>,
    announced_recover: Vec<bool>,
}

impl ScenarioRunner {
    pub fn new(scenario: Scenario) -> Self {
        let n = scenario.events.len();
        ScenarioRunner {
            scenario,
            announced_start: vec![false; n],
            announced_recover: vec![false; n],
        }
    }

    fn ramp_progress(ev: &ScenarioEvent, now: f64) -> f64 {
        if now < ev.time {
            return 0.0;
        }
        if ev.duration <= 0.0 {
            return 1.0;
        }
        ((now - ev.time) / ev.duration).clamp(0.0, 1.0)
    }

    fn active(ev: &ScenarioEvent, now: f64) -> bool {
        if now < ev.time {
            return false;
        }
        if ev.recover_after > 0.0 && now >= ev.time + ev.recover_after {
            return false;
        }
        true
    }

    /// Re-evaluate all events for the current simulation time. Mutates
    /// `inputs` (physical overrides) and `instr` (channel faults), and returns
    /// any newly-applied events for the log.
    #[allow(clippy::too_many_arguments)]
    pub fn evaluate(
        &mut self,
        now: f64,
        state: &PhysicalState,
        instr: &mut Instrumentation,
        inputs: &mut PhysicsInputs,
        hmi_faults: &mut HashMap<String, LayerFault>,
    ) -> Vec<AppliedEvent> {
        let mut applied = Vec::new();
        let events = self.scenario.events.clone();
        for (i, ev) in events.iter().enumerate() {
            let is_active = Self::active(ev, now);

            if now >= ev.time && !self.announced_start[i] {
                self.announced_start[i] = true;
                applied.push(AppliedEvent {
                    sim_time: ev.time,
                    target: ev.target.clone(),
                    action: ev.action.clone(),
                    value: ev.value,
                    label: if ev.label.is_empty() {
                        describe(ev)
                    } else {
                        ev.label.clone()
                    },
                    phase: "start".into(),
                });
            }
            if ev.recover_after > 0.0
                && now >= ev.time + ev.recover_after
                && !self.announced_recover[i]
            {
                self.announced_recover[i] = true;
                applied.push(AppliedEvent {
                    sim_time: ev.time + ev.recover_after,
                    target: ev.target.clone(),
                    action: "restore".into(),
                    value: 0.0,
                    label: format!(
                        "Recovery: {}",
                        if ev.label.is_empty() {
                            describe(ev)
                        } else {
                            ev.label.clone()
                        }
                    ),
                    phase: "recover".into(),
                });
            }

            let prog = Self::ramp_progress(ev, now);
            apply_event(ev, is_active, prog, state, instr, inputs, hmi_faults);
        }
        applied
    }

    pub fn reset(&mut self) {
        let n = self.scenario.events.len();
        self.announced_start = vec![false; n];
        self.announced_recover = vec![false; n];
    }
}

fn describe(ev: &ScenarioEvent) -> String {
    format!("{} {} {}", ev.action, ev.target, ev.value)
}

fn bool_action(ev: &ScenarioEvent) -> bool {
    match ev.action.as_str() {
        "restore" | "start" => true,
        "trip" | "loss" | "stop" => false,
        _ => ev.value != 0.0,
    }
}

fn parse_idx(s: &str) -> Option<usize> {
    s.parse::<usize>().ok()
}

#[allow(clippy::too_many_arguments)]
fn apply_event(
    ev: &ScenarioEvent,
    active: bool,
    prog: f64,
    state: &PhysicalState,
    instr: &mut Instrumentation,
    inputs: &mut PhysicsInputs,
    hmi_faults: &mut HashMap<String, LayerFault>,
) {
    let parts: Vec<&str> = ev.target.split('.').collect();
    match parts.as_slice() {
        ["physical", "rho_external"] => {
            if active {
                inputs.rho_external += ev.value * prog;
            }
        }
        ["rcp", idx] => {
            if let Some(i) = parse_idx(idx).filter(|&i| i < 4) {
                if active {
                    match ev.action.as_str() {
                        "trip" | "stop" => inputs.rcp_override[i] = Some(false),
                        "start" => inputs.rcp_override[i] = Some(true),
                        _ => {}
                    }
                }
            }
        }
        ["mfw", idx] => {
            if let Some(i) = parse_idx(idx).filter(|&i| i < 2) {
                match ev.action.as_str() {
                    "trip" | "stop" => {
                        if active {
                            inputs.mfw_override[i] = Some(false);
                        }
                    }
                    "start" if active => {
                        inputs.mfw_override[i] = Some(true);
                    }
                    _ => {}
                }
            }
        }
        ["electrical", "offsite"] => {
            if active {
                inputs.offsite_override = Some(bool_action(ev));
            }
        }
        ["electrical", "grid"] => {
            if active {
                inputs.grid_override = Some(bool_action(ev));
            }
        }
        ["edg", which] => {
            let avail = ev.action == "restore" || ev.value != 0.0;
            if active {
                match *which {
                    "a" | "A" => inputs.edg_a_avail_override = Some(avail),
                    "b" | "B" => inputs.edg_b_avail_override = Some(avail),
                    _ => {}
                }
            }
        }
        ["valve", "porv"] => {
            if active {
                inputs.porv_stuck = Some(ev.value.clamp(0.0, 1.0));
            }
        }
        ["condenser"] => {
            if active {
                // ramp effectiveness from 1.0 down to `value`.
                let e = 1.0 + (ev.value - 1.0) * prog;
                inputs.condenser_override = Some(e.clamp(0.05, 1.0));
            }
        }
        ["turbine"] => {
            if active && (ev.action == "trip") {
                inputs.turbine_trip = true;
            }
        }
        ["afw"] => {
            if active {
                inputs.afw_available =
                    Some(!matches!(ev.action.as_str(), "trip" | "fail" | "stop"));
            }
        }
        ["reactor"] => {
            if active && (ev.action == "trip") {
                inputs.reactor_trip = true;
            }
        }
        ["instrument", rest @ ..] => {
            let target = rest.join(".");
            let sigkey = rest.first().copied().unwrap_or("");
            if active {
                let ct = instr.source_truth(state, sigkey);
                let kind = ev.action.as_str();
                let v = match kind {
                    "stuck" if ev.value == 0.0 => f64::NAN,
                    "drift" => ev.value, // rate in units/s, applied continuously
                    "bias" => ev.value * prog,
                    _ => ev.value,
                };
                instr.apply_fault(&target, kind, v, ct);
            } else {
                instr.apply_fault(&target, "clear", 0.0, 0.0);
            }
        }
        // Signal-processing-layer fault: alters the voted value feeding BOTH
        // control and the HMI. Cannot be caught by cross-channel checks.
        ["signal", key] => {
            if active {
                let v = if ev.action == "bias" {
                    ev.value * prog
                } else {
                    ev.value
                };
                instr.apply_signal_fault(key, &ev.action, v);
            } else {
                instr.apply_signal_fault(key, "clear", 0.0);
            }
        }
        // HMI-layer fault: alters ONLY the displayed value. Control, protection,
        // alarms and the safety-function logic keep working on the true reading.
        ["hmi", key] => {
            let entry = key.to_string();
            if active {
                if let Some(kind) = LayerFault::parse_kind(&ev.action) {
                    let v = if kind == crate::faults::LayerFaultKind::Stuck && ev.value == 0.0 {
                        // Latch the current displayed value now (build_snapshot
                        // applies HMI faults without mutating them).
                        instr.get(key)
                    } else if ev.action == "bias" {
                        ev.value * prog
                    } else {
                        ev.value
                    };
                    hmi_faults
                        .entry(entry)
                        .and_modify(|f| {
                            if f.kind == crate::faults::LayerFaultKind::Bias {
                                *f = LayerFault::new(kind, v); // keep ramps live
                            }
                        })
                        .or_insert_with(|| LayerFault::new(kind, v));
                }
            } else {
                hmi_faults.remove(&entry);
            }
        }
        _ => {}
    }
}
