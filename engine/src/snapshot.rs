//! Layer 4: HMI VALUES — assembles everything presented to the operator.
//!
//! The operator (and the Angular UI) sees ONLY this snapshot. Physical truth is
//! included only when instructor/debug mode is enabled.

use crate::alarms::{Alarm, AlarmEvent, AlarmManager};
use crate::control::ControllerState;
use crate::instrumentation::Instrumentation;
use crate::physics::PhysicalState;
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub enum CsfStatus {
    Normal,
    Degraded,
    Challenged,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct Csf {
    pub name: String,
    pub status: CsfStatus,
    pub basis: String,
}

/// Educational abstraction — NOT a real emergency operating procedure.
fn critical_safety_functions(m: &Instrumentation, cs: &ControllerState) -> Vec<Csf> {
    let g = |k: &str| m.get(k);
    let dev_high = m.deviation("primary_pressure") > 0.5
        || m.deviation("sg1_level") > 12.0
        || m.deviation("neutron_power") > 8.0;

    // REACTIVITY CONTROL
    let reactivity = if cs.reactor_trip_latched && g("neutron_power") < 5.0 {
        CsfStatus::Normal
    } else if g("neutron_power") > 108.0 || (cs.reactor_trip_latched && g("neutron_power") > 15.0) {
        CsfStatus::Challenged
    } else if g("neutron_power") > 103.0 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    // CORE HEAT REMOVAL — low forced flow is only "challenged" if the coolant
    // is also actually heating up (natural circulation can be adequate for
    // decay heat).
    let flow = g("primary_flow");
    let tavg = g("t_avg");
    let core_heat = if tavg > 335.0 || (flow < 20.0 && tavg > 315.0) {
        CsfStatus::Challenged
    } else if tavg > 322.0 || flow < 88.0 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    // PRIMARY INVENTORY
    let pzr = g("pzr_level");
    let press = g("primary_pressure");
    let inventory = if pzr < 12.0 || press < 12.5 {
        CsfStatus::Challenged
    } else if pzr < 25.0 || pzr > 88.0 || press < 14.0 || press > 16.3 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    // HEAT SINK (steam generators + feedwater)
    let sgmin = g("sg1_level").min(g("sg2_level"));
    let heat_sink = if sgmin < 22.0 {
        CsfStatus::Challenged
    } else if sgmin < 35.0 || sgmin > 82.0 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    // ELECTRICAL POWER
    let batt = g("battery_charge");
    let electrical = if batt < 30.0 {
        CsfStatus::Challenged
    } else if batt < 70.0 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    // CONTAINMENT / BARRIER STATUS (very abstract in v1)
    let barrier = if press < 11.0 || tavg > 345.0 {
        CsfStatus::Challenged
    } else if press < 13.5 {
        CsfStatus::Degraded
    } else {
        CsfStatus::Normal
    };

    let mut out = vec![
        Csf {
            name: "REACTIVITY CONTROL".into(),
            status: reactivity,
            basis: "neutron power, trip status".into(),
        },
        Csf {
            name: "CORE HEAT REMOVAL".into(),
            status: core_heat,
            basis: "coolant flow, average temperature".into(),
        },
        Csf {
            name: "PRIMARY INVENTORY".into(),
            status: inventory,
            basis: "pressurizer level, primary pressure".into(),
        },
        Csf {
            name: "HEAT SINK".into(),
            status: heat_sink,
            basis: "steam generator levels".into(),
        },
        Csf {
            name: "ELECTRICAL POWER".into(),
            status: electrical,
            basis: "essential bus, battery charge".into(),
        },
        Csf {
            name: "CONTAINMENT / BARRIER STATUS".into(),
            status: barrier,
            basis: "primary pressure, coolant temperature (abstract)".into(),
        },
    ];
    if dev_high {
        for c in out.iter_mut() {
            if c.status == CsfStatus::Normal {
                c.status = CsfStatus::Unknown;
                c.basis = format!("{} (instrument disagreement)", c.basis);
            }
        }
    }
    out
}

#[derive(Clone, Debug, Serialize)]
pub struct ElectricalSummary {
    pub offsite_power: bool,
    pub grid_available: bool,
    pub generator_online: bool,
    pub generator_mw: f64,
    pub essential_bus_energized: bool,
    pub edg_a_running: bool,
    pub edg_b_running: bool,
    pub edg_a_available: bool,
    pub edg_b_available: bool,
    pub battery_charge: f64,
    pub rcp_powered: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventLogEntry {
    pub sim_time: f64,
    pub category: String, // operator | auto | alarm | trip | fault | scenario | info
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct Snapshot<'a> {
    pub sim_time: f64,
    pub tick: u64,
    pub running: bool,
    pub speed: f64,
    pub scenario_id: String,
    pub scenario_name: String,

    /// Measured / displayed values keyed by signal, plus `<key>__dev` for the
    /// channel spread. This is the HMI layer.
    pub hmi: BTreeMap<String, f64>,

    pub controllers: &'a ControllerState,
    pub electrical: ElectricalSummary,
    pub csf: Vec<Csf>,

    pub alarms: Vec<Alarm>,
    pub alarm_unacked: usize,
    pub alarm_history: Vec<AlarmEvent>,

    pub event_log: Vec<EventLogEntry>,

    /// Only populated in instructor/debug mode.
    pub physical: Option<PhysicalState>,
    pub channels: Option<serde_json::Value>,
}

#[allow(clippy::too_many_arguments)]
pub fn build_snapshot<'a>(
    sim_time: f64,
    tick: u64,
    running: bool,
    speed: f64,
    scenario_id: &str,
    scenario_name: &str,
    phys: &PhysicalState,
    instr: &Instrumentation,
    controllers: &'a ControllerState,
    alarms: &AlarmManager,
    event_log: &[EventLogEntry],
    debug: bool,
) -> Snapshot<'a> {
    let mut hmi = BTreeMap::new();
    for sig in &instr.signals {
        hmi.insert(sig.key.clone(), round4(sig.value));
        hmi.insert(format!("{}__dev", sig.key), round4(sig.max_deviation));
    }
    // A few derived HMI values.
    hmi.insert(
        "sg_level_min".into(),
        round4(instr.get("sg1_level").min(instr.get("sg2_level"))),
    );
    hmi.insert(
        "delta_t".into(),
        round4(instr.get("t_hot") - instr.get("t_cold")),
    );

    let electrical = ElectricalSummary {
        offsite_power: phys.offsite_power,
        grid_available: phys.grid_available,
        generator_online: phys.generator_online,
        generator_mw: round4(instr.get("generator_mw")),
        essential_bus_energized: phys.essential_bus_energized,
        edg_a_running: phys.edg_a_running,
        edg_b_running: phys.edg_b_running,
        edg_a_available: phys.edg_a_available,
        edg_b_available: phys.edg_b_available,
        battery_charge: round4(instr.get("battery_charge")),
        rcp_powered: phys.rcp.iter().any(|&r| r),
    };

    let recent_log: Vec<EventLogEntry> = event_log
        .iter()
        .rev()
        .take(400)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect();

    Snapshot {
        sim_time: round4(sim_time),
        tick,
        running,
        speed,
        scenario_id: scenario_id.to_string(),
        scenario_name: scenario_name.to_string(),
        hmi,
        controllers,
        electrical,
        csf: critical_safety_functions(instr, controllers),
        alarms: alarms.active_list(),
        alarm_unacked: alarms.unacked_count(),
        alarm_history: alarms
            .history
            .iter()
            .rev()
            .take(200)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect(),
        event_log: recent_log,
        physical: if debug { Some(phys.clone()) } else { None },
        channels: if debug {
            Some(serde_json::to_value(&instr.signals).unwrap_or(serde_json::Value::Null))
        } else {
            None
        },
    }
}

fn round4(v: f64) -> f64 {
    if !v.is_finite() {
        return 0.0;
    }
    (v * 1e4).round() / 1e4
}
