//! Open Nuclear Ops Lab — simulation engine.
//!
//! EDUCATIONAL SOFTWARE ONLY. This is a fictional, heavily-simplified PWR-like
//! model. It is not suitable for reactor operation, safety analysis, licensing,
//! operator certification, or modelling any real plant. See `docs/`.
//!
//! Architecture (kept as distinct layers on purpose):
//!   PHYSICAL PROCESS  -> INSTRUMENTATION -> CONTROL/PROTECTION -> HMI -> OPERATOR
//! Faults can be injected at any layer independently, so a sensor failure and an
//! HMI-display fault can produce different internal states with similar symptoms.

pub mod alarms;
pub mod control;
pub mod faults;
pub mod instrumentation;
pub mod physics;
pub mod rng;
pub mod scenario;
pub mod snapshot;

use alarms::AlarmManager;
use control::{Controllers, OperatorDemands};
use instrumentation::Instrumentation;
use physics::{PhysicalState, PhysicsInputs, DT};
use scenario::{Scenario, ScenarioEvent, ScenarioRunner};
use serde::Deserialize;
use snapshot::{build_snapshot, EventLogEntry};
use wasm_bindgen::prelude::*;

/// Result of an operator command.
#[derive(serde::Serialize)]
pub struct CommandResult {
    pub ok: bool,
    pub reason: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OperatorAction {
    RodMode { mode: String },
    RodSpeed { value: f64 },
    TargetPower { value: f64 },
    TargetLoad { value: f64 },
    TripReactor,
    TripTurbine,
    ResetTrip,
    Rcp { index: usize, on: bool },
    Mfw { index: usize, on: bool },
    Generator { connect: bool },
    PzrMode { mode: String },
    PzrSetpoint { value: f64 },
    PzrHeater { value: f64 },
    PzrSpray { value: f64 },
    FwMode { mode: String },
    SgLevelSetpoint { value: f64 },
    AckAlarm { id: String },
    AckAll,
    Inject(ScenarioEvent),
    ClearInjections,
}

/// One recorded operator command, for deterministic session replay.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TapedAction {
    pub tick: u64,
    pub json: String,
}

pub struct EngineCore {
    phys: PhysicalState,
    instr: Instrumentation,
    controllers: Controllers,
    alarms: AlarmManager,
    runner: ScenarioRunner,
    op: OperatorDemands,
    manual_events: Vec<ScenarioEvent>,
    manual_time_offset: f64,
    event_log: Vec<EventLogEntry>,
    /// HMI-layer faults keyed by signal — alter the displayed value only.
    hmi_faults: std::collections::HashMap<String, faults::LayerFault>,
    /// Operator action tape (tick + raw JSON) for record/replay.
    action_tape: Vec<TapedAction>,
    /// Original scenario JSON, kept so a session export is self-contained.
    scenario_json: String,
    tick: u64,
    seed: u64,
    debug: bool,
}

impl EngineCore {
    pub fn new(scenario: Scenario, seed_override: Option<u64>) -> Self {
        let seed = seed_override.unwrap_or(scenario.seed);
        let phys = scenario.initial_state();
        let mut op = OperatorDemands::default();
        if scenario.initial == "hot_standby" {
            op.target_power_pct = 0.0;
            op.target_load_pct = 0.0;
            op.generator_connect = false;
        }
        let scenario_json =
            serde_json::to_string(&scenario).unwrap_or_else(|_| "\"baseline\"".to_string());
        let mut core = EngineCore {
            phys,
            instr: Instrumentation::new(seed),
            controllers: Controllers::new(),
            alarms: AlarmManager::new(),
            runner: ScenarioRunner::new(scenario),
            op,
            manual_events: Vec::new(),
            manual_time_offset: 0.0,
            event_log: Vec::new(),
            hmi_faults: std::collections::HashMap::new(),
            action_tape: Vec::new(),
            scenario_json,
            tick: 0,
            seed,
            debug: false,
        };
        core.log("info", "Simulation initialised.".into());
        core.instr.update(&core.phys);
        core
    }

    pub fn sim_time(&self) -> f64 {
        self.tick as f64 * DT
    }

    fn log(&mut self, category: &str, message: String) {
        self.event_log.push(EventLogEntry {
            sim_time: self.sim_time(),
            category: category.to_string(),
            message,
        });
        if self.event_log.len() > 5000 {
            let drop = self.event_log.len() - 5000;
            self.event_log.drain(0..drop);
        }
    }

    pub fn tick_once(&mut self) {
        let now = self.sim_time();

        // 1. Instrumentation reflects the current physical state.
        self.instr.update(&self.phys);

        // 2. Scenario + manual fault injection.
        let mut sinputs = PhysicsInputs::default();
        let applied = self.runner.evaluate(
            now,
            &self.phys,
            &mut self.instr,
            &mut sinputs,
            &mut self.hmi_faults,
        );
        for a in applied {
            self.event_log.push(EventLogEntry {
                sim_time: a.sim_time,
                category: "scenario".into(),
                message: format!("[{}] {}", a.phase, a.label),
            });
        }
        // Manual injections use their own local clock from when they were added.
        if !self.manual_events.is_empty() {
            let mut tmp_runner = ScenarioRunner::new(Scenario {
                id: "manual".into(),
                name: "manual".into(),
                description: String::new(),
                initial: "hot_full_power".into(),
                seed: 0,
                events: self.manual_events.clone(),
                briefing: String::new(),
                learning_objectives: vec![],
            });
            let local = now - self.manual_time_offset;
            let applied_m = tmp_runner.evaluate(
                local,
                &self.phys,
                &mut self.instr,
                &mut sinputs,
                &mut self.hmi_faults,
            );
            for a in applied_m {
                self.event_log.push(EventLogEntry {
                    sim_time: now,
                    category: "fault".into(),
                    message: format!("[instructor] {}", a.label),
                });
            }
        }

        // 3. Controllers + protection (operate on measured values only).
        let (inputs, prot) = self.controllers.step(&self.instr, &self.op, &sinputs);
        for p in prot {
            let cat = if p.kind.contains("trip") {
                "trip"
            } else {
                "auto"
            };
            self.log(cat, format!("{}: {}", p.kind.to_uppercase(), p.reason));
        }

        // 4. Alarms (measured values + latched trip state).
        self.alarms
            .evaluate(now, &self.instr, &self.controllers.state);

        // 5. Advance the physical process.
        self.phys.step(&inputs);

        // Clear one-shot operator manual-trip pulses.
        self.op.manual_reactor_trip = false;
        self.op.manual_turbine_trip = false;

        self.tick += 1;
    }

    pub fn step_many(&mut self, n: u32) {
        for _ in 0..n {
            self.tick_once();
        }
    }

    pub fn apply_action(&mut self, action: OperatorAction) -> CommandResult {
        let now = self.sim_time();
        let ok = |r: &str| CommandResult {
            ok: true,
            reason: r.to_string(),
        };
        let no = |r: &str| CommandResult {
            ok: false,
            reason: r.to_string(),
        };
        match action {
            OperatorAction::RodMode { mode } => {
                let auto = mode == "auto";
                if auto && self.controllers.state.reactor_trip_latched {
                    return no("Rod control cannot be placed in AUTO after a reactor trip.");
                }
                self.controllers.state.mode_rod_auto = auto;
                self.log(
                    "operator",
                    format!("Rod control mode -> {}", mode.to_uppercase()),
                );
                ok("Rod control mode changed.")
            }
            OperatorAction::RodSpeed { value } => {
                if self.controllers.state.mode_rod_auto {
                    return no("Rod control is in AUTO. Switch to MANUAL first.");
                }
                if self.controllers.state.reactor_trip_latched {
                    return no("Reactor is tripped — rods are on the bottom.");
                }
                self.op.rod_manual_speed =
                    value.clamp(-physics::MAX_ROD_SPEED, physics::MAX_ROD_SPEED);
                self.log(
                    "operator",
                    format!("Manual rod demand {:+.3}/s", self.op.rod_manual_speed),
                );
                ok("Rod demand set.")
            }
            OperatorAction::TargetPower { value } => {
                let v = value.clamp(0.0, 100.0);
                self.op.target_power_pct = v;
                self.log("operator", format!("Reactor power target -> {v:.0}%"));
                ok("Power target set.")
            }
            OperatorAction::TargetLoad { value } => {
                let v = value.clamp(0.0, 100.0);
                self.op.target_load_pct = v;
                self.log("operator", format!("Turbine load target -> {v:.0}%"));
                ok("Load target set.")
            }
            OperatorAction::TripReactor => {
                self.op.manual_reactor_trip = true;
                self.log("operator", "MANUAL REACTOR TRIP initiated.".into());
                ok("Reactor trip initiated.")
            }
            OperatorAction::TripTurbine => {
                self.op.manual_turbine_trip = true;
                self.log("operator", "MANUAL TURBINE TRIP initiated.".into());
                ok("Turbine trip initiated.")
            }
            OperatorAction::ResetTrip => {
                // Only allow reset once measured conditions are back in band.
                let m = &self.instr;
                let safe = m.get("neutron_power") < 5.0
                    && m.get("primary_pressure") > 13.5
                    && m.get("primary_pressure") < 16.3
                    && m.get("pzr_level") > 18.0
                    && m.get("sg1_level") > 27.0
                    && m.get("sg2_level") > 27.0;
                if !safe {
                    return no(
                        "Trip reset blocked: one or more parameters still outside the reset band.",
                    );
                }
                self.controllers.state.reactor_trip_latched = false;
                self.controllers.state.turbine_trip_latched = false;
                self.phys.reactor_tripped = false;
                self.phys.turbine_tripped = false;
                self.log("operator", "Reactor/turbine trip latches RESET.".into());
                ok("Trip reset. Rods remain inserted — withdraw manually to restart.")
            }
            OperatorAction::Rcp { index, on } => {
                if index >= 4 {
                    return no("Invalid RCP index.");
                }
                if on {
                    let powered = self.phys.offsite_power
                        || (self.phys.generator_online && self.phys.generator_mw > 5.0);
                    if !powered {
                        return no(
                            "Cannot start RCP: no offsite power and generator not supplying.",
                        );
                    }
                }
                self.phys.rcp[index] = on;
                self.log(
                    "operator",
                    format!(
                        "RCP-{} {}",
                        index + 1,
                        if on { "STARTED" } else { "STOPPED" }
                    ),
                );
                ok("RCP command accepted.")
            }
            OperatorAction::Mfw { index, on } => {
                if index >= 2 {
                    return no("Invalid feedwater pump index.");
                }
                if on {
                    let powered = self.phys.offsite_power
                        || (self.phys.generator_online && self.phys.generator_mw > 5.0);
                    if !powered {
                        return no("Cannot start main feedwater pump: no main AC power.");
                    }
                }
                self.phys.mfw_pump[index] = on;
                self.log(
                    "operator",
                    format!(
                        "MFW pump {} {}",
                        index + 1,
                        if on { "STARTED" } else { "STOPPED" }
                    ),
                );
                ok("Feedwater pump command accepted.")
            }
            OperatorAction::Generator { connect } => {
                if connect {
                    if self.controllers.state.turbine_trip_latched {
                        return no("Cannot synchronise: turbine is tripped.");
                    }
                    if !self.phys.grid_available {
                        return no("Cannot synchronise: grid not available.");
                    }
                    if self.instr.get("turbine_speed") < 97.0 {
                        return no("Cannot synchronise: turbine not at rated speed.");
                    }
                }
                self.op.generator_connect = connect;
                self.log(
                    "operator",
                    format!(
                        "Generator breaker {}",
                        if connect { "CLOSE" } else { "OPEN" }
                    ),
                );
                ok("Generator breaker command accepted.")
            }
            OperatorAction::PzrMode { mode } => {
                self.controllers.state.mode_pzr_auto = mode == "auto";
                self.log(
                    "operator",
                    format!("Pressurizer control -> {}", mode.to_uppercase()),
                );
                ok("Pressurizer mode changed.")
            }
            OperatorAction::PzrSetpoint { value } => {
                self.op.pzr_setpoint = value.clamp(13.0, 16.0);
                self.log(
                    "operator",
                    format!(
                        "Pressurizer pressure setpoint -> {:.2} MPa",
                        self.op.pzr_setpoint
                    ),
                );
                ok("Setpoint set.")
            }
            OperatorAction::PzrHeater { value } => {
                if self.controllers.state.mode_pzr_auto {
                    return no("Pressurizer is in AUTO.");
                }
                self.phys.pzr_heater_frac = value.clamp(0.0, 1.0);
                ok("Heater demand set.")
            }
            OperatorAction::PzrSpray { value } => {
                if self.controllers.state.mode_pzr_auto {
                    return no("Pressurizer is in AUTO.");
                }
                self.phys.pzr_spray_frac = value.clamp(0.0, 1.0);
                ok("Spray demand set.")
            }
            OperatorAction::FwMode { mode } => {
                self.controllers.state.mode_fw_auto = mode == "auto";
                self.log(
                    "operator",
                    format!("Feedwater control -> {}", mode.to_uppercase()),
                );
                ok("Feedwater mode changed.")
            }
            OperatorAction::SgLevelSetpoint { value } => {
                self.op.sg_level_setpoint = value.clamp(30.0, 80.0);
                self.log(
                    "operator",
                    format!("SG level setpoint -> {:.0}%", self.op.sg_level_setpoint),
                );
                ok("Setpoint set.")
            }
            OperatorAction::AckAlarm { id } => {
                self.alarms.acknowledge(&id, now);
                ok("Alarm acknowledged.")
            }
            OperatorAction::AckAll => {
                self.alarms.acknowledge_all(now);
                self.log("operator", "Acknowledged all visible alarms.".into());
                ok("All visible alarms acknowledged.")
            }
            OperatorAction::Inject(mut ev) => {
                if self.manual_events.is_empty() {
                    self.manual_time_offset = now;
                }
                // Manual events are relative to injection time.
                ev.time = (self.sim_time() - self.manual_time_offset).max(0.0);
                let label = if ev.label.is_empty() {
                    format!("{} {} {}", ev.action, ev.target, ev.value)
                } else {
                    ev.label.clone()
                };
                self.manual_events.push(ev);
                self.log("fault", format!("[instructor] injected: {label}"));
                ok("Fault injected.")
            }
            OperatorAction::ClearInjections => {
                // Undo the effect of each manual injection, then drop them.
                let events = std::mem::take(&mut self.manual_events);
                for ev in &events {
                    let parts: Vec<&str> = ev.target.split('.').collect();
                    match parts.as_slice() {
                        ["instrument", rest @ ..] => {
                            self.instr.apply_fault(&rest.join("."), "clear", 0.0, 0.0)
                        }
                        ["signal", key] => self.instr.apply_signal_fault(key, "clear", 0.0),
                        ["hmi", key] => {
                            self.hmi_faults.remove(*key);
                        }
                        _ => {}
                    }
                }
                self.log(
                    "fault",
                    "[instructor] cleared all manual injections.".into(),
                );
                ok("Manual injections cleared.")
            }
        }
    }

    /// Export a self-contained, replayable session: scenario + seed + the
    /// timed operator-action tape.
    pub fn export_session(&self) -> String {
        let session = serde_json::json!({
            "format": "nol-session-v1",
            "scenario": serde_json::from_str::<serde_json::Value>(&self.scenario_json)
                .unwrap_or(serde_json::Value::String("baseline".into())),
            "seed": self.seed,
            "dt": DT,
            "final_tick": self.tick,
            "actions": self.action_tape,
        });
        serde_json::to_string_pretty(&session).unwrap_or_else(|_| "{}".to_string())
    }

    /// Rebuild an engine from a session export and deterministically replay the
    /// recorded actions up to `final_tick`.
    pub fn replay_session(json: &str) -> Result<EngineCore, String> {
        let v: serde_json::Value = serde_json::from_str(json).map_err(|e| e.to_string())?;
        if v.get("format").and_then(|f| f.as_str()) != Some("nol-session-v1") {
            return Err("not a nol-session-v1 file".into());
        }
        let scenario_json = v
            .get("scenario")
            .map(|s| s.to_string())
            .unwrap_or_else(|| "\"baseline\"".into());
        let scenario = if scenario_json.trim() == "\"baseline\"" {
            Scenario::stable_baseline()
        } else {
            Scenario::parse(&scenario_json)?
        };
        let seed = v.get("seed").and_then(|s| s.as_u64());
        let final_tick = v.get("final_tick").and_then(|t| t.as_u64()).unwrap_or(0);
        let actions: Vec<TapedAction> = serde_json::from_value(
            v.get("actions")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![])),
        )
        .map_err(|e| e.to_string())?;
        if actions.len() > 100_000 || final_tick > 200_000_000 {
            return Err("session too large".into());
        }

        let mut core = EngineCore::new(scenario, seed);
        let mut idx = 0usize;
        while core.tick < final_tick {
            while idx < actions.len() && actions[idx].tick <= core.tick {
                if let Ok(a) = serde_json::from_str::<OperatorAction>(&actions[idx].json) {
                    core.apply_action(a);
                }
                idx += 1;
            }
            core.tick_once();
        }
        Ok(core)
    }

    pub fn load_scenario(&mut self, scenario: Scenario) {
        let seed = scenario.seed;
        *self = EngineCore::new(scenario, Some(seed));
    }

    pub fn reset(&mut self) {
        let scen = self.runner.scenario.clone();
        let seed = self.seed;
        *self = EngineCore::new(scen, Some(seed));
    }

    pub fn set_debug(&mut self, on: bool) {
        self.debug = on;
    }

    pub fn snapshot_json(&self, running: bool, speed: f64) -> String {
        let scen_id = self.runner.scenario.id.clone();
        let scen_name = self.runner.scenario.name.clone();
        let snap = build_snapshot(
            self.sim_time(),
            self.tick,
            running,
            speed,
            &scen_id,
            &scen_name,
            &self.phys,
            &self.instr,
            &self.controllers.state,
            &self.alarms,
            &self.event_log,
            &self.hmi_faults,
            self.debug,
        );
        serde_json::to_string(&snap).unwrap_or_else(|_| "{}".to_string())
    }
}

// ---------------------------------------------------------------------------
// WASM binding
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub struct Engine {
    core: EngineCore,
    running: bool,
    speed: f64,
}

#[wasm_bindgen]
impl Engine {
    /// Create an engine from a scenario JSON string. Pass `"baseline"` (or an
    /// empty string) for the default stable full-power scenario.
    #[wasm_bindgen(constructor)]
    pub fn new(scenario_json: &str, seed: f64) -> Result<Engine, String> {
        let scenario = if scenario_json.trim().is_empty() || scenario_json.trim() == "baseline" {
            Scenario::stable_baseline()
        } else {
            Scenario::parse(scenario_json)?
        };
        let seed_override = if seed > 0.0 { Some(seed as u64) } else { None };
        Ok(Engine {
            core: EngineCore::new(scenario, seed_override),
            running: false,
            speed: 1.0,
        })
    }

    /// Advance the simulation by `n` fixed physics timesteps (DT seconds each).
    pub fn step(&mut self, n: u32) {
        self.core.step_many(n.min(100_000));
    }

    /// Physics timestep in seconds.
    #[wasm_bindgen(getter)]
    pub fn dt(&self) -> f64 {
        DT
    }

    #[wasm_bindgen(getter, js_name = simTime)]
    pub fn sim_time(&self) -> f64 {
        self.core.sim_time()
    }

    pub fn set_running(&mut self, running: bool) {
        self.running = running;
    }

    pub fn set_speed(&mut self, speed: f64) {
        self.speed = speed.clamp(0.0, 20.0);
    }

    pub fn set_debug(&mut self, on: bool) {
        self.core.set_debug(on);
    }

    /// Apply an operator action (JSON). Returns a JSON `{ok, reason}`.
    pub fn action(&mut self, json: &str) -> String {
        match serde_json::from_str::<OperatorAction>(json) {
            Ok(a) => {
                // Record on the action tape for deterministic session replay.
                self.core.action_tape.push(TapedAction {
                    tick: self.core.tick,
                    json: json.to_string(),
                });
                if self.core.action_tape.len() > 100_000 {
                    self.core.action_tape.remove(0);
                }
                let r = self.core.apply_action(a);
                serde_json::to_string(&r).unwrap()
            }
            Err(e) => serde_json::to_string(&CommandResult {
                ok: false,
                reason: format!("Bad action: {e}"),
            })
            .unwrap(),
        }
    }

    /// Export the current run as a self-contained replayable session (JSON).
    pub fn export_session(&self) -> String {
        self.core.export_session()
    }

    /// Load a session export and deterministically replay it. Returns
    /// `{ok, reason}` JSON.
    pub fn load_session(&mut self, json: &str) -> String {
        match EngineCore::replay_session(json) {
            Ok(core) => {
                let t = core.sim_time();
                self.core = core;
                self.running = false;
                serde_json::to_string(&CommandResult {
                    ok: true,
                    reason: format!("Replayed session to {t:.0} s."),
                })
                .unwrap()
            }
            Err(e) => serde_json::to_string(&CommandResult {
                ok: false,
                reason: e,
            })
            .unwrap(),
        }
    }

    /// Replace the running scenario. Returns a JSON `{ok, reason}`.
    pub fn load_scenario(&mut self, json: &str) -> String {
        let scenario = if json.trim().is_empty() || json.trim() == "baseline" {
            Ok(Scenario::stable_baseline())
        } else {
            Scenario::parse(json)
        };
        match scenario {
            Ok(s) => {
                let name = s.name.clone();
                self.core.load_scenario(s);
                self.running = false;
                serde_json::to_string(&CommandResult {
                    ok: true,
                    reason: format!("Loaded '{name}'."),
                })
                .unwrap()
            }
            Err(e) => serde_json::to_string(&CommandResult {
                ok: false,
                reason: e,
            })
            .unwrap(),
        }
    }

    pub fn reset(&mut self) {
        self.core.reset();
        self.running = false;
    }

    /// Full HMI snapshot as JSON.
    pub fn snapshot(&self) -> String {
        self.core.snapshot_json(self.running, self.speed)
    }
}
