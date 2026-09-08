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

/// Operator-visible plant equipment status (run/standby indications — not
/// hidden physical truth).
#[derive(Clone, Debug, Serialize)]
pub struct EquipmentStatus {
    pub rcp: [bool; 4],
    pub rcp_running: u8,
    pub mfw_pump: [bool; 2],
    pub afw_on: bool,
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
    /// Signals whose displayed value is currently altered by an HMI-layer fault
    /// (control & protection are unaffected).
    pub hmi_faulted: Vec<String>,
    /// Signals altered by a signal-processing-layer fault (control & HMI both
    /// affected; looks like a real process change).
    pub signal_faulted: Vec<String>,
    /// True (un-faulted) HMI values — instructor/debug mode only.
    pub hmi_truth: Option<BTreeMap<String, f64>>,

    pub controllers: &'a ControllerState,
    pub electrical: ElectricalSummary,
    pub equipment: EquipmentStatus,
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
    hmi_faults: &std::collections::HashMap<String, crate::faults::LayerFault>,
    debug: bool,
) -> Snapshot<'a> {
    // True (un-faulted) HMI values straight from the instrument layer.
    let mut truth_map: BTreeMap<String, f64> = BTreeMap::new();
    for sig in &instr.signals {
        truth_map.insert(sig.key.clone(), sig.value);
    }
    let tg = |k: &str| truth_map.get(k).copied().unwrap_or(0.0);
    let sg_min = tg("sg1_level").min(tg("sg2_level"));
    let dt_val = tg("t_hot") - tg("t_cold");
    truth_map.insert("sg_level_min".into(), sg_min);
    truth_map.insert("delta_t".into(), dt_val);

    // Apply HMI-layer faults to the *displayed* values only.
    let mut hmi_faulted: Vec<String> = Vec::new();
    let mut hmi = BTreeMap::new();
    for (key, &tv) in &truth_map {
        let shown = match hmi_faults.get(key) {
            Some(f) => {
                hmi_faulted.push(key.clone());
                f.apply_ref(tv)
            }
            None => tv,
        };
        hmi.insert(key.clone(), round4(shown));
    }
    for sig in &instr.signals {
        hmi.insert(format!("{}__dev", sig.key), round4(sig.max_deviation));
    }
    hmi_faulted.sort();

    // The electrical summary readouts follow the (possibly HMI-faulted) values.
    let shown = |k: &str| hmi.get(k).copied().unwrap_or(0.0);
    let electrical = ElectricalSummary {
        offsite_power: phys.offsite_power,
        grid_available: phys.grid_available,
        generator_online: phys.generator_online,
        generator_mw: round4(shown("generator_mw")),
        essential_bus_energized: phys.essential_bus_energized,
        edg_a_running: phys.edg_a_running,
        edg_b_running: phys.edg_b_running,
        edg_a_available: phys.edg_a_available,
        edg_b_available: phys.edg_b_available,
        battery_charge: round4(shown("battery_charge")),
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
        hmi_faulted,
        signal_faulted: instr.signal_faulted(),
        hmi_truth: if debug {
            Some(
                truth_map
                    .iter()
                    .map(|(k, v)| (k.clone(), round4(*v)))
                    .collect(),
            )
        } else {
            None
        },
        controllers,
        electrical,
        equipment: EquipmentStatus {
            rcp: phys.rcp,
            rcp_running: phys.rcp.iter().filter(|&&r| r).count() as u8,
            mfw_pump: phys.mfw_pump,
            afw_on: phys.afw_on,
        },
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
