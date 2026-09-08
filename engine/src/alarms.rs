//! Alarm model (Layer 4 / HMI). A real latched-alarm system, not toasts.
//!
//! Each alarm has a stable id, priority, subsystem, active/cleared state and
//! acknowledged/unacknowledged state. Conditions are evaluated every tick from
//! *measured* (HMI) values so that instrument faults raise alarms too.

use crate::control::ControllerState;
use crate::instrumentation::Instrumentation;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Serialize)]
pub struct Alarm {
    pub id: String,
    pub priority: u8, // 1 = high, 2 = medium, 3 = low
    pub subsystem: String,
    pub message: String,
    pub active: bool,
    pub acknowledged: bool,
    pub raised_at: f64,
    pub cleared_at: Option<f64>,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct AlarmEvent {
    pub sim_time: f64,
    pub id: String,
    pub transition: String, // "raised" | "cleared" | "ack"
    pub priority: u8,
    pub subsystem: String,
    pub message: String,
}

pub struct AlarmManager {
    pub alarms: HashMap<String, Alarm>,
    pub history: Vec<AlarmEvent>,
}

struct Cond<'a> {
    id: &'a str,
    priority: u8,
    subsystem: &'a str,
    message: String,
    active: bool,
}

impl Default for AlarmManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AlarmManager {
    pub fn new() -> Self {
        AlarmManager {
            alarms: HashMap::new(),
            history: Vec::new(),
        }
    }

    pub fn reset(&mut self) {
        self.alarms.clear();
        self.history.clear();
    }

    pub fn evaluate(&mut self, now: f64, m: &Instrumentation, cs: &ControllerState) {
        let g = |k: &str| m.get(k);
        let dev = |k: &str| m.deviation(k);
        let conds: Vec<Cond> = vec![
            Cond {
                id: "RX_TRIP",
                priority: 1,
                subsystem: "Reactor",
                message: "REACTOR TRIP".into(),
                active: cs.reactor_trip_latched,
            },
            Cond {
                id: "TURB_TRIP",
                priority: 1,
                subsystem: "Turbine",
                message: "TURBINE TRIP".into(),
                active: cs.turbine_trip_latched,
            },
            Cond {
                id: "PWR_HI",
                priority: 2,
                subsystem: "Reactor",
                message: format!("High neutron power {:.0}%", g("neutron_power")),
                active: g("neutron_power") > 108.0,
            },
            Cond {
                id: "PRESS_HI",
                priority: 1,
                subsystem: "Primary",
                message: format!("High primary pressure {:.2} MPa", g("primary_pressure")),
                active: g("primary_pressure") > 16.2,
            },
            Cond {
                id: "PRESS_LO",
                priority: 1,
                subsystem: "Primary",
                message: format!("Low primary pressure {:.2} MPa", g("primary_pressure")),
                active: g("primary_pressure") < 14.0,
            },
            Cond {
                id: "PZR_LVL_LO",
                priority: 2,
                subsystem: "Primary",
                message: format!("Low pressurizer level {:.0}%", g("pzr_level")),
                active: g("pzr_level") < 25.0,
            },
            Cond {
                id: "PZR_LVL_HI",
                priority: 2,
                subsystem: "Primary",
                message: format!("High pressurizer level {:.0}%", g("pzr_level")),
                active: g("pzr_level") > 85.0,
            },
            Cond {
                id: "TAVG_HI",
                priority: 2,
                subsystem: "Primary",
                message: format!("High coolant average temp {:.1} C", g("t_avg")),
                active: g("t_avg") > 325.0,
            },
            Cond {
                id: "FLOW_LO",
                priority: 1,
                subsystem: "Primary",
                message: format!("Low reactor coolant flow {:.0}%", g("primary_flow")),
                active: g("primary_flow") < 90.0,
            },
            Cond {
                id: "SG1_LVL_LO",
                priority: 2,
                subsystem: "Secondary",
                message: format!("SG-1 low level {:.0}%", g("sg1_level")),
                active: g("sg1_level") < 35.0,
            },
            Cond {
                id: "SG2_LVL_LO",
                priority: 2,
                subsystem: "Secondary",
                message: format!("SG-2 low level {:.0}%", g("sg2_level")),
                active: g("sg2_level") < 35.0,
            },
            Cond {
                id: "SG1_LVL_HI",
                priority: 2,
                subsystem: "Secondary",
                message: format!("SG-1 high level {:.0}%", g("sg1_level")),
                active: g("sg1_level") > 80.0,
            },
            Cond {
                id: "SG2_LVL_HI",
                priority: 2,
                subsystem: "Secondary",
                message: format!("SG-2 high level {:.0}%", g("sg2_level")),
                active: g("sg2_level") > 80.0,
            },
            Cond {
                id: "COND_VAC_LO",
                priority: 2,
                subsystem: "Secondary",
                message: format!("Low condenser vacuum {:.1} kPa", g("condenser_pressure")),
                active: g("condenser_pressure") > 12.0,
            },
            Cond {
                id: "TURB_OVERSPD",
                priority: 1,
                subsystem: "Turbine",
                message: format!("Turbine overspeed {:.0}%", g("turbine_speed")),
                active: g("turbine_speed") > 103.0,
            },
            Cond {
                id: "BATT_LO",
                priority: 2,
                subsystem: "Electrical",
                message: format!("Station battery low {:.0}%", g("battery_charge")),
                active: g("battery_charge") < 60.0,
            },
            // Instrument channel disagreement (each redundant signal).
            Cond {
                id: "DEV_NPWR",
                priority: 2,
                subsystem: "Instrument",
                message: "Neutron power channel disagreement".into(),
                active: dev("neutron_power") > 6.0,
            },
            Cond {
                id: "DEV_PRESS",
                priority: 2,
                subsystem: "Instrument",
                message: "Primary pressure channel disagreement".into(),
                active: dev("primary_pressure") > 0.4,
            },
            Cond {
                id: "DEV_PZR",
                priority: 2,
                subsystem: "Instrument",
                message: "Pressurizer level channel disagreement".into(),
                active: dev("pzr_level") > 8.0,
            },
            Cond {
                id: "DEV_SG1",
                priority: 2,
                subsystem: "Instrument",
                message: "SG-1 level channel disagreement".into(),
                active: dev("sg1_level") > 10.0,
            },
            Cond {
                id: "DEV_SG2",
                priority: 2,
                subsystem: "Instrument",
                message: "SG-2 level channel disagreement".into(),
                active: dev("sg2_level") > 10.0,
            },
            Cond {
                id: "DEV_TAVG",
                priority: 2,
                subsystem: "Instrument",
                message: "Coolant temperature channel disagreement".into(),
                active: dev("t_avg") > 5.0,
            },
            Cond {
                id: "DEV_ROD",
                priority: 2,
                subsystem: "Instrument",
                message: "Control-rod position disagreement".into(),
                active: dev("rod_pos") > 6.0,
            },
        ];

        for c in conds {
            let entry = self
                .alarms
                .entry(c.id.to_string())
                .or_insert_with(|| Alarm {
                    id: c.id.to_string(),
                    priority: c.priority,
                    subsystem: c.subsystem.to_string(),
                    message: c.message.clone(),
                    active: false,
                    acknowledged: true,
                    raised_at: now,
                    cleared_at: Some(now),
                    count: 0,
                });
            entry.message = c.message.clone();
            entry.priority = c.priority;
            if c.active && !entry.active {
                entry.active = true;
                entry.acknowledged = false;
                entry.raised_at = now;
                entry.cleared_at = None;
                entry.count += 1;
                self.history.push(AlarmEvent {
                    sim_time: now,
                    id: c.id.to_string(),
                    transition: "raised".into(),
                    priority: c.priority,
                    subsystem: c.subsystem.to_string(),
                    message: c.message.clone(),
                });
            } else if !c.active && entry.active {
                entry.active = false;
                entry.cleared_at = Some(now);
                self.history.push(AlarmEvent {
                    sim_time: now,
                    id: c.id.to_string(),
                    transition: "cleared".into(),
                    priority: c.priority,
                    subsystem: c.subsystem.to_string(),
                    message: c.message.clone(),
                });
            }
        }
        // Bound history.
        if self.history.len() > 4000 {
            self.history.drain(0..(self.history.len() - 4000));
        }
    }

    pub fn acknowledge(&mut self, id: &str, now: f64) {
        if let Some(a) = self.alarms.get_mut(id) {
            if !a.acknowledged {
                a.acknowledged = true;
                self.history.push(AlarmEvent {
                    sim_time: now,
                    id: id.to_string(),
                    transition: "ack".into(),
                    priority: a.priority,
                    subsystem: a.subsystem.clone(),
                    message: a.message.clone(),
                });
            }
        }
    }

    pub fn acknowledge_all(&mut self, now: f64) {
        let mut ids: Vec<String> = self
            .alarms
            .values()
            .filter(|a| !a.acknowledged)
            .map(|a| a.id.clone())
            .collect();
        ids.sort(); // deterministic acknowledgement order
        for id in ids {
            self.acknowledge(&id, now);
        }
    }

    pub fn active_list(&self) -> Vec<Alarm> {
        let mut v: Vec<Alarm> = self
            .alarms
            .values()
            .filter(|a| a.active || !a.acknowledged)
            .cloned()
            .collect();
        v.sort_by(|a, b| {
            a.priority
                .cmp(&b.priority)
                .then(
                    b.raised_at
                        .partial_cmp(&a.raised_at)
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
                .then(a.id.cmp(&b.id))
        });
        v
    }

    pub fn unacked_count(&self) -> usize {
        self.alarms.values().filter(|a| !a.acknowledged).count()
    }
}
