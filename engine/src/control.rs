//! Layer 3: CONTROL / PROTECTION LOGIC.
//!
//! Reads *measured* signals from the instrumentation layer (never the physical
//! truth) and produces:
//!   * `PhysicsInputs` for the next physical step (actuator demands),
//!   * trip / interlock decisions,
//!   * a list of protection events for the event log & alarm system.
//!
//! All setpoints are FICTIONAL, normalized teaching values. They do not
//! correspond to any real reactor.

use crate::instrumentation::Instrumentation;
use crate::physics::PhysicsInputs;
use serde::Serialize;

/// Fictional protection setpoints. Documented in `docs/SCENARIOS.md`.
pub mod sp {
    pub const NEUTRON_HI_TRIP: f64 = 112.0; // % power
    pub const PRESS_HI_TRIP: f64 = 16.8; // MPa
    pub const PRESS_LO_TRIP: f64 = 13.2; // MPa
    pub const PZR_LO_TRIP: f64 = 15.0; // %
    pub const SG_LO_LO_TRIP: f64 = 25.0; // %
    pub const TAVG_HI_TRIP: f64 = 331.0; // degC
    pub const FLOW_LO_TRIP: f64 = 87.0; // % (with low power permissive removed)
    pub const TURB_OVERSPEED_TRIP: f64 = 106.0; // %
    pub const COND_PRESS_HI_TRIP: f64 = 20.0; // kPa
    pub const SG_HI_TURB_TRIP: f64 = 85.0; // %
    /// Safety-injection actuation on low primary pressure (MPa).
    pub const SI_PRESS_LO: f64 = 11.5;
    /// Containment pressure (kPa gauge): high alarm, SI / phase-A isolation,
    /// and containment-spray actuation.
    pub const CNMT_PRESS_HI: f64 = 15.0;
    pub const CNMT_PRESS_SI: f64 = 20.0;
    pub const CNMT_PRESS_SPRAY: f64 = 140.0;
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct ProtectionEvent {
    pub kind: String, // "reactor_trip" | "turbine_trip" | "actuation"
    pub reason: String,
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct ControllerState {
    pub mode_rod_auto: bool,
    pub mode_pzr_auto: bool,
    pub mode_fw_auto: bool,
    pub mode_turbine_auto: bool,
    pub mode_cvcs_auto: bool,
    pub rod_error: f64,
    pub pzr_press_error: f64,
    pub fw_error: [f64; 2],
    pub target_power: f64,
    pub reactor_trip_latched: bool,
    pub turbine_trip_latched: bool,
    /// Safety-injection and containment protection latches.
    pub si_latched: bool,
    pub cnmt_isolation_latched: bool,
    pub cnmt_spray_latched: bool,
    /// True while a real trip demand is being suppressed by a cyber attack.
    pub reactor_trip_blocked: bool,
    pub turbine_trip_blocked: bool,
    /// Seconds since the reactor trip latched (0 while not tripped).
    pub trip_age_s: f64,
    // integrator terms
    i_rod: f64,
    i_fw: [f64; 2],
    // one-shot "blocked trip" log guards
    rx_block_logged: bool,
    tb_block_logged: bool,
}

pub struct Controllers {
    pub state: ControllerState,
}

/// Operator demands that persist between steps (set-and-hold controls).
#[derive(Clone, Debug, Serialize)]
pub struct OperatorDemands {
    pub rod_manual_speed: f64,   // fraction/s when rod control in manual
    pub target_power_pct: f64,   // auto rod control target
    pub target_load_pct: f64,    // turbine load target
    pub pzr_setpoint: f64,       // MPa
    pub sg_level_setpoint: f64,  // %
    pub pzr_level_setpoint: f64, // % — CVCS charging/letdown target
    pub charging_manual: f64,    // 0..1 when CVCS in manual
    pub letdown_manual: f64,     // 0..1 when CVCS in manual
    pub boron_rate: f64,         // ppm/s: + borate, - dilute
    pub generator_connect: bool,
    pub manual_reactor_trip: bool,
    pub manual_turbine_trip: bool,
    pub reset_request: bool,
}

impl Default for OperatorDemands {
    fn default() -> Self {
        OperatorDemands {
            rod_manual_speed: 0.0,
            target_power_pct: 100.0,
            target_load_pct: 100.0,
            pzr_setpoint: 15.5,
            sg_level_setpoint: 65.0,
            pzr_level_setpoint: 55.0,
            charging_manual: 0.30,
            letdown_manual: 0.30,
            boron_rate: 0.0,
            generator_connect: true,
            manual_reactor_trip: false,
            manual_turbine_trip: false,
            reset_request: false,
        }
    }
}

impl Default for Controllers {
    fn default() -> Self {
        Self::new()
    }
}

impl Controllers {
    pub fn new() -> Self {
        Controllers {
            state: ControllerState {
                mode_rod_auto: true,
                mode_pzr_auto: true,
                mode_fw_auto: true,
                mode_turbine_auto: true,
                mode_cvcs_auto: true,
                target_power: 100.0,
                ..Default::default()
            },
        }
    }

    /// Run all controllers + protection for one step.
    pub fn step(
        &mut self,
        m: &Instrumentation,
        op: &OperatorDemands,
        scenario_inputs: &PhysicsInputs,
    ) -> (PhysicsInputs, Vec<ProtectionEvent>) {
        let mut out = scenario_inputs.clone();
        let mut events = Vec::new();
        let st = &mut self.state;
        let dt = crate::physics::DT;

        // ---------------- PROTECTION (evaluated on measured signals) ----------
        let power = m.get("neutron_power");
        let press = m.get("primary_pressure");
        let pzr = m.get("pzr_level");
        let sg1 = m.get("sg1_level");
        let sg2 = m.get("sg2_level");
        let tavg = m.get("t_avg");
        let flow = m.get("primary_flow");
        let turb_speed = m.get("turbine_speed");
        let cond = m.get("condenser_pressure");
        let cnmt_press = m.get("cnmt_pressure");

        // Direct containment-system commands from a scenario / instructor event.
        if let Some(v) = scenario_inputs.cnmt_isolate_cmd {
            st.cnmt_isolation_latched = v;
        }
        if let Some(v) = scenario_inputs.cnmt_spray_cmd {
            st.cnmt_spray_latched = v;
        }

        // ---- SAFETY INJECTION actuation (latching) ----
        let si_reason: Option<String> = if scenario_inputs.si_signal {
            Some("Scenario safety-injection signal".into())
        } else if press < sp::SI_PRESS_LO {
            Some(format!("Low primary pressure {press:.2} MPa"))
        } else if cnmt_press > sp::CNMT_PRESS_SI {
            Some(format!("High containment pressure {cnmt_press:.0} kPa"))
        } else {
            None
        };
        if let Some(reason) = si_reason {
            if !st.si_latched {
                st.si_latched = true;
                events.push(ProtectionEvent {
                    kind: "actuation".into(),
                    reason: format!("Safety injection: {reason}"),
                });
            }
        }
        // Containment phase-A isolation follows the SI signal or high pressure.
        if (st.si_latched || cnmt_press > sp::CNMT_PRESS_SI) && !st.cnmt_isolation_latched {
            st.cnmt_isolation_latched = true;
            events.push(ProtectionEvent {
                kind: "actuation".into(),
                reason: "Containment isolation (phase A)".into(),
            });
        }
        // Containment spray on high-high containment pressure.
        if cnmt_press > sp::CNMT_PRESS_SPRAY && !st.cnmt_spray_latched {
            st.cnmt_spray_latched = true;
            events.push(ProtectionEvent {
                kind: "actuation".into(),
                reason: format!("Containment spray: high pressure {cnmt_press:.0} kPa"),
            });
        }

        let mut rx_trip_reason: Option<String> = None;
        if op.manual_reactor_trip {
            rx_trip_reason = Some("Manual reactor trip".into());
        } else if scenario_inputs.reactor_trip {
            rx_trip_reason = Some("Scenario reactor trip".into());
        } else if st.si_latched {
            rx_trip_reason = Some("Reactor trip on safety injection".into());
        } else if power > sp::NEUTRON_HI_TRIP {
            rx_trip_reason = Some(format!("High neutron power {power:.0}%"));
        } else if press > sp::PRESS_HI_TRIP {
            rx_trip_reason = Some(format!("High primary pressure {press:.2} MPa"));
        } else if press < sp::PRESS_LO_TRIP {
            rx_trip_reason = Some(format!("Low primary pressure {press:.2} MPa"));
        } else if pzr < sp::PZR_LO_TRIP {
            rx_trip_reason = Some(format!("Low pressurizer level {pzr:.0}%"));
        } else if sg1 < sp::SG_LO_LO_TRIP || sg2 < sp::SG_LO_LO_TRIP {
            rx_trip_reason = Some("Low-low steam generator level".into());
        } else if tavg > sp::TAVG_HI_TRIP {
            rx_trip_reason = Some(format!("High coolant average temperature {tavg:.1} C"));
        } else if flow < sp::FLOW_LO_TRIP && power > 10.0 {
            rx_trip_reason = Some(format!("Low reactor coolant flow {flow:.0}%"));
        } else if st.turbine_trip_latched && power > 15.0 {
            // Anticipatory: a turbine trip above ~15% power trips the reactor.
            rx_trip_reason = Some("Reactor trip on turbine trip (anticipatory)".into());
        }

        if let Some(reason) = rx_trip_reason {
            // A manual trip always goes through; an automatic trip can be
            // suppressed by a protection-defeat cyber attack.
            let blocked = scenario_inputs.inhibit_reactor_trip && !op.manual_reactor_trip;
            st.reactor_trip_blocked = blocked && !st.reactor_trip_latched;
            if st.reactor_trip_blocked {
                if !st.rx_block_logged {
                    st.rx_block_logged = true;
                    events.push(ProtectionEvent {
                        kind: "actuation".into(),
                        reason: format!("Reactor trip demand present but SUPPRESSED: {reason}"),
                    });
                }
            } else if !st.reactor_trip_latched {
                st.reactor_trip_latched = true;
                events.push(ProtectionEvent {
                    kind: "reactor_trip".into(),
                    reason,
                });
            }
        } else {
            st.reactor_trip_blocked = false;
            st.rx_block_logged = false;
        }

        // Turbine trip logic.
        let mut turb_trip_reason: Option<String> = None;
        if op.manual_turbine_trip {
            turb_trip_reason = Some("Manual turbine trip".into());
        } else if scenario_inputs.turbine_trip {
            turb_trip_reason = Some("Scenario turbine trip".into());
        } else if st.reactor_trip_latched {
            turb_trip_reason = Some("Turbine trip on reactor trip".into());
        } else if turb_speed > sp::TURB_OVERSPEED_TRIP {
            turb_trip_reason = Some(format!("Turbine overspeed {turb_speed:.0}%"));
        } else if cond > sp::COND_PRESS_HI_TRIP {
            turb_trip_reason = Some(format!("High condenser backpressure {cond:.1} kPa"));
        } else if sg1 > sp::SG_HI_TURB_TRIP || sg2 > sp::SG_HI_TURB_TRIP {
            turb_trip_reason = Some("High steam generator level".into());
        }
        if let Some(reason) = turb_trip_reason {
            let blocked = scenario_inputs.inhibit_turbine_trip && !op.manual_turbine_trip;
            st.turbine_trip_blocked = blocked && !st.turbine_trip_latched;
            if st.turbine_trip_blocked {
                if !st.tb_block_logged {
                    st.tb_block_logged = true;
                    events.push(ProtectionEvent {
                        kind: "actuation".into(),
                        reason: format!("Turbine trip demand present but SUPPRESSED: {reason}"),
                    });
                }
            } else if !st.turbine_trip_latched {
                st.turbine_trip_latched = true;
                events.push(ProtectionEvent {
                    kind: "turbine_trip".into(),
                    reason,
                });
            }
        } else {
            st.turbine_trip_blocked = false;
            st.tb_block_logged = false;
        }

        out.reactor_trip = st.reactor_trip_latched;
        out.turbine_trip = st.turbine_trip_latched;
        out.manual_scram = op.manual_reactor_trip;
        st.trip_age_s = if st.reactor_trip_latched {
            st.trip_age_s + dt
        } else {
            0.0
        };

        // ---------------- ROD CONTROL ----------------------------------------
        if st.reactor_trip_latched {
            out.rod_speed_cmd = 0.0;
        } else if st.mode_rod_auto {
            st.target_power = op.target_power_pct;
            // Program T_avg against power, trim rods to hold power & T_avg.
            let tref = 292.0 + 0.15 * st.target_power; // fictional T_avg program
            let power_err = st.target_power - power;
            let tavg_err = tref - tavg;
            st.rod_error = 0.6 * power_err + 0.4 * tavg_err;
            st.i_rod += st.rod_error * dt;
            st.i_rod = st.i_rod.clamp(-50.0, 50.0);
            let demand = 0.0006 * st.rod_error + 0.000015 * st.i_rod;
            // Deadband to avoid hunting.
            out.rod_speed_cmd = if st.rod_error.abs() < 0.5 {
                0.0
            } else {
                demand.clamp(
                    -crate::physics::MAX_ROD_SPEED,
                    crate::physics::MAX_ROD_SPEED,
                )
            };
        } else {
            out.rod_speed_cmd = op.rod_manual_speed.clamp(
                -crate::physics::MAX_ROD_SPEED,
                crate::physics::MAX_ROD_SPEED,
            );
        }
        // A cyber attack can inject a rod-drive command, overriding the
        // controller (unless the reactor is tripped and the rods are down).
        if let Some(v) = scenario_inputs.rod_speed_override {
            if !st.reactor_trip_latched {
                out.rod_speed_cmd = v.clamp(
                    -crate::physics::MAX_ROD_SPEED,
                    crate::physics::MAX_ROD_SPEED,
                );
            }
        }

        // ---------------- PRESSURIZER CONTROL -------------------------------
        // A cyber attack can silently substitute the setpoint the controller
        // uses; the operator's displayed setpoint is unchanged.
        let pzr_sp = scenario_inputs
            .tamper_pzr_setpoint
            .unwrap_or(op.pzr_setpoint);
        let sg_lvl_sp = scenario_inputs
            .tamper_sg_level_setpoint
            .unwrap_or(op.sg_level_setpoint);
        if st.mode_pzr_auto {
            let err = pzr_sp - press;
            st.pzr_press_error = err;
            // Heaters when low, spray when high.
            out.pzr_heater_cmd = (0.25 + 6.0 * err).clamp(0.0, 1.0);
            out.pzr_spray_cmd = ((-err - 0.15) * 4.0).clamp(0.0, 1.0);
        } else {
            out.pzr_heater_cmd = out.pzr_heater_cmd.clamp(0.0, 1.0);
        }

        // ---------------- FEEDWATER (3-element) -----------------------------
        for k in 0..2 {
            let (lvl, sf, ff) = if k == 0 {
                (sg1, m.get("sg1_steam_flow"), m.get("sg1_fw_flow"))
            } else {
                (sg2, m.get("sg2_steam_flow"), m.get("sg2_fw_flow"))
            };
            if st.mode_fw_auto {
                let level_err = sg_lvl_sp - lvl;
                let flow_mismatch = sf - ff; // want fw to match steam
                st.fw_error[k] = level_err;
                st.i_fw[k] += level_err * dt;
                st.i_fw[k] = st.i_fw[k].clamp(-40.0, 40.0);
                let base = sf / 100.0; // feed-forward from steam flow
                let demand = base + 0.02 * level_err + 0.0008 * st.i_fw[k] + 0.01 * flow_mismatch;
                out.fw_valve_cmd[k] = demand.clamp(0.0, 1.2);
            } else {
                out.fw_valve_cmd[k] = out.fw_valve_cmd[k].clamp(0.0, 1.2);
            }
        }

        // ---------------- TURBINE / LOAD -----------------------------------
        if st.turbine_trip_latched {
            out.throttle_cmd = 0.0;
        } else if st.mode_turbine_auto {
            // Ramp throttle to meet load target.
            out.throttle_cmd = (op.target_load_pct / 100.0).clamp(0.0, 1.0);
            out.load_demand_cmd = Some((op.target_load_pct / 100.0).clamp(0.0, 1.0));
        }
        out.generator_connect = Some(op.generator_connect && !st.turbine_trip_latched);

        // ---------------- STEAM DUMP --------------------------------------
        // Open steam dump to condenser after a trip or on high steam pressure,
        // if the condenser is available.
        let sgp = m.get("sg1_pressure").max(m.get("sg2_pressure"));
        let dump = if st.turbine_trip_latched && cond < sp::COND_PRESS_HI_TRIP {
            ((sgp - 7.2) * 1.5).clamp(0.0, 1.0).max(0.15)
        } else {
            ((sgp - 7.6) * 1.5).clamp(0.0, 1.0)
        };
        out.steam_dump_cmd = dump;

        // ---------------- CVCS / CHEMISTRY / SAFETY INJECTION ---------------
        out.si_signal = st.si_latched;
        out.cnmt_isolate_cmd = Some(st.cnmt_isolation_latched);
        out.cnmt_spray_cmd = Some(st.cnmt_spray_latched);
        // Operator boration/dilution adds to any scenario-driven rate.
        out.boron_rate_ppm_s += op.boron_rate;

        if st.si_latched {
            // Safety injection overrides normal makeup: charge hard, no letdown.
            out.charging_cmd = Some(1.0);
            out.letdown_cmd = Some(0.0);
        } else if st.mode_cvcs_auto {
            let lvl = m.get("pzr_level");
            let err = op.pzr_level_setpoint - lvl;
            out.charging_cmd = Some((0.30 + 0.03 * err).clamp(0.0, 1.0));
            out.letdown_cmd = Some((0.30 - 0.03 * err).clamp(0.0, 1.0));
        } else {
            out.charging_cmd = Some(op.charging_manual.clamp(0.0, 1.0));
            out.letdown_cmd = Some(op.letdown_manual.clamp(0.0, 1.0));
        }

        (out, events)
    }

    pub fn reset(&mut self) {
        *self = Controllers::new();
    }
}
