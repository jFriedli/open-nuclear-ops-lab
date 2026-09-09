//! Layer 1: the PHYSICAL PROCESS.
//!
//! A deterministic, simplified, numerically stable lumped-parameter model of a
//! fictional PWR-like plant. Every constant here is a *fictional, normalized*
//! teaching value. See `docs/PHYSICS.md`.
//!
//! Nothing in this file is aware of instrumentation, controllers or the HMI.
//! It exposes only the true physical state and a `step(dt, inputs)` method.

use serde::Serialize;

/// Fixed physics timestep, in seconds. The engine never varies this; simulation
/// time is `ticks * DT`, kept separate from wall-clock time.
pub const DT: f64 = 0.02;

/// Fictional rated core thermal power (MW). Not a real plant value.
pub const P_RATED_MW: f64 = 1000.0;
/// Fraction of rated power produced by prompt+delayed fission at equilibrium;
/// the remainder (`1 - FISSION_FRAC`) is decay heat.
const FISSION_FRAC: f64 = 0.93;
/// Rated primary heat-capacity-rate, W*cp (MW per degC of loop delta-T), all
/// loops combined. Chosen so full-power core delta-T is ~30 degC.
const W_CP_RATED: f64 = 33.0;
/// Fictional rated electrical output (MW).
pub const P_ELEC_RATED_MW: f64 = 330.0;
/// Rated primary->secondary heat-transfer coefficient per steam generator
/// (MW per degC), chosen so each SG passes ~500 MW at full power.
const SG_UA_RATED: f64 = 14.3;

/// Six-group delayed neutron data (fictional, U-235-like fractions).
const BETA_I: [f64; 6] = [2.10e-4, 1.40e-3, 1.26e-3, 2.53e-3, 7.40e-4, 2.70e-4];
const LAMBDA_I: [f64; 6] = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01];
/// Prompt neutron generation time (s).
const GEN_TIME: f64 = 2.0e-4;

/// Reference operating temperatures (deg C).
const T_FUEL_REF: f64 = 605.0;
const T_MOD_REF: f64 = 305.0;

/// Reactivity feedback coefficients (dk/k per deg C), both negative.
const ALPHA_FUEL: f64 = -2.6e-5; // Doppler
const ALPHA_MOD: f64 = -20.0e-5; // moderator temperature coefficient

/// Worth of the controlling rod bank over its travel (dk/k). Shutdown margin
/// after a trip is represented separately by `SCRAM_WORTH`.
const ROD_WORTH: f64 = 0.028;

/// Large negative reactivity held after a reactor trip (scram rods + would-be
/// boration), keeping the core firmly subcritical.
const SCRAM_WORTH: f64 = -0.15;

/// Maximum commanded rod-bank speed (fraction of travel per second).
pub const MAX_ROD_SPEED: f64 = 0.004;

/// Fuel thermal mass (MJ/deg C) and fuel->coolant conductance (MW/deg C).
/// H_FUEL_COOL * (T_FUEL_REF - T_MOD_REF) == P_RATED_MW at full power.
const C_FUEL: f64 = 20.0;
const H_FUEL_COOL: f64 = 3.3333;

/// Primary coolant thermal mass (MJ/deg C).
const C_PRIMARY: f64 = 1100.0;

/// Xenon / iodine (normalized to full-power equilibrium = 1.0).
const LAMBDA_I_XE: f64 = 2.9e-5;
const LAMBDA_XE: f64 = 2.1e-5;
const SIGMA_PHI: f64 = 3.0e-5; // burnup at full power
const XE_WORTH: f64 = 0.028;

/// Decay-heat groups (fraction of rated power). Equilibrium at power = k/lambda.
const DK_LAMBDA: [f64; 3] = [0.1, 0.010, 0.0011];
const DK_GAIN: [f64; 3] = [0.003, 2.5e-4, 1.65e-5];

/// Natural-circulation flow fraction when all RCPs are off (thermosyphon).
const NATCIRC_FLOW: f64 = 0.06;

/// ---- Primary chemistry / CVCS (fictional teaching values) ----
/// Reactivity worth of soluble boron (dk/k per ppm). Negative.
const BORON_WORTH_PPM: f64 = -7.5e-6;
/// Boron concentration the `rho_bias` calibration implicitly assumes (ppm). The
/// explicit boron term is exactly zero here, so the reference states stay
/// critical and existing behaviour is unchanged.
const BORON_REF_PPM: f64 = 900.0;
/// Boron concentration of the borated makeup / SI / accumulator water (ppm).
const BORATED_SOURCE_PPM: f64 = 2400.0;
/// Mixing gain for injected borated water into the lumped primary (per unit of
/// normalized injection flow, per second).
const BORON_MIX_GAIN: f64 = 0.9;

/// ---- Safety injection / accumulators ----
/// Passive accumulator injection setpoint on primary pressure (MPa).
const ACCUM_PRESS: f64 = 4.2;
/// Accumulator discharge flow (fraction-of-rated units) and total deliverable
/// inventory in the same units·seconds.
const ACCUM_FLOW: f64 = 0.05;
const ACCUM_INVENTORY: f64 = 6.0;
/// High-head SI pump delivery when actuated and powered (fraction-of-rated).
const SI_PUMP_FLOW: f64 = 0.012;

/// ---- Containment (very simplified single-volume) ----
/// Pressure rise (kPa) per unit of released coolant-energy flow.
const CNMT_RELEASE_GAIN: f64 = 260.0;
/// Passive structural-heat-sink pressure relaxation rate (per second).
const CNMT_PASSIVE_RELAX: f64 = 0.05;
/// Additional relaxation rate with containment spray running.
const CNMT_SPRAY_RELAX: f64 = 0.9;

#[derive(Clone, Debug, Serialize)]
pub struct SteamGenerator {
    /// Secondary-side water inventory (fraction of nominal).
    pub inventory: f64,
    /// Narrow-range level indication basis (%) derived from inventory.
    pub level_pct: f64,
    /// Steam pressure (MPa).
    pub pressure: f64,
    /// Steam mass flow out (fraction of rated).
    pub steam_flow: f64,
    /// Feedwater mass flow in (fraction of rated).
    pub fw_flow: f64,
    /// Primary->secondary heat transfer (MW).
    pub heat_in: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PhysicalState {
    // ---- Reactor / neutronics ----
    /// Normalized fission power (1.0 = rated). Prompt + delayed neutrons.
    pub neutron_power: f64,
    /// Delayed-neutron precursor concentrations (normalized).
    pub precursors: [f64; 6],
    /// Net reactivity (dk/k) and its components.
    pub reactivity: f64,
    pub rho_rods: f64,
    pub rho_fuel: f64,
    pub rho_mod: f64,
    pub rho_xenon: f64,
    pub rho_boron: f64,
    pub rho_external: f64,
    pub rho_scram: f64,
    /// Control-rod bank position, 0.0 = fully inserted, 1.0 = fully withdrawn.
    pub rod_pos: f64,
    /// Iodine-135 and Xenon-135 (normalized to full-power equilibrium).
    pub iodine: f64,
    pub xenon: f64,
    /// Decay-heat groups and total decay-heat fraction of rated power.
    decay_groups: [f64; 3],
    pub decay_heat: f64,

    // ---- Temperatures (deg C) ----
    pub t_fuel: f64,
    pub t_mod: f64,
    pub t_hot: f64,
    pub t_cold: f64,
    /// Heat currently transported fuel -> primary coolant (MW).
    pub core_heat_mw: f64,

    // ---- Primary system ----
    /// Primary pressure at the pressurizer (MPa).
    pub primary_pressure: f64,
    /// Primary flow (fraction of rated).
    pub primary_flow: f64,
    /// Reactor coolant pumps (true = running).
    pub rcp: [bool; 4],
    /// Pressurizer level (%) and whether backup heaters / spray are effective.
    pub pzr_level: f64,
    pub pzr_heater_frac: f64,
    pub pzr_spray_frac: f64,
    /// Power-operated relief valve open fraction (0..1).
    pub porv: f64,

    // ---- Secondary ----
    pub sg: [SteamGenerator; 2],
    /// Main feedwater pumps (true = running).
    pub mfw_pump: [bool; 2],
    /// Auxiliary feedwater actuation (automatic).
    pub afw_on: bool,

    // ---- Turbine / generator ----
    /// Turbine speed (fraction of synchronous; 1.0 = rated).
    pub turbine_speed: f64,
    /// Throttle / governor valve position (0..1).
    pub throttle: f64,
    /// Mechanical power on the shaft (MW).
    pub mech_power: f64,
    /// Generator electrical output (MW).
    pub generator_mw: f64,
    /// Generator breaker closed (synchronized & supplying load).
    pub generator_online: bool,
    /// Operator/loading demand for generator load (fraction).
    pub load_demand: f64,
    /// Steam-dump (condenser bypass) valve fraction.
    pub steam_dump: f64,
    pub turbine_tripped: bool,

    // ---- Condenser ----
    /// Condenser backpressure (kPa abs). ~5 kPa healthy, higher = degraded.
    pub condenser_pressure: f64,
    /// Condenser cooling effectiveness (1.0 = design).
    pub condenser_effectiveness: f64,

    // ---- Primary chemistry / makeup (simplified CVCS) ----
    /// Coolant boron concentration (ppm). Adds negative reactivity.
    pub boron_ppm: f64,
    /// Charging pump flow demand (0..1) and letdown (0..1).
    pub charging: f64,
    pub letdown: f64,
    /// Safety-injection actuation (commanded by the protection layer) and the
    /// accumulator inventory remaining (fraction).
    pub si_active: bool,
    pub accumulator_frac: f64,
    /// Current total SI + accumulator injection flow (fraction-of-rated units).
    pub si_flow: f64,
    /// Primary coolant lost to containment through a break or relief path
    /// (fraction-of-rated units).
    pub primary_leak: f64,

    // ---- Containment (very simplified) ----
    /// Containment pressure (kPa gauge; ~0 normal).
    pub cnmt_pressure: f64,
    /// Containment atmosphere temperature (degC).
    pub cnmt_temp: f64,
    /// Containment sump level (%; rises with released coolant).
    pub cnmt_sump: f64,
    pub cnmt_spray: bool,
    pub cnmt_isolated: bool,

    // ---- Electrical ----
    pub grid_available: bool,
    pub offsite_power: bool,
    pub essential_bus_energized: bool,
    pub edg_a_running: bool,
    pub edg_b_running: bool,
    pub edg_a_available: bool,
    pub edg_b_available: bool,
    /// EDG start timers (s remaining until breaker closes).
    edg_a_timer: f64,
    edg_b_timer: f64,
    pub battery_charge: f64,

    // ---- Bookkeeping ----
    pub reactor_tripped: bool,
    /// True while rods are gravity-dropping after a scram.
    scram_active: bool,
    /// Reactivity bias calibrated at init so the reference state is critical.
    rho_bias: f64,
}

/// External inputs to the physical layer for one step. These come from the
/// CONTROL layer (or, via scenario/operator events, forced overrides).
#[derive(Clone, Debug, Default)]
pub struct PhysicsInputs {
    /// Commanded rod speed (fraction of travel per second; +withdraw / -insert).
    pub rod_speed_cmd: f64,
    /// Pressurizer heater demand (0..1) and spray demand (0..1).
    pub pzr_heater_cmd: f64,
    pub pzr_spray_cmd: f64,
    /// Per-SG feedwater valve demand (0..1).
    pub fw_valve_cmd: [f64; 2],
    /// Turbine throttle demand (0..1) from the load controller.
    pub throttle_cmd: f64,
    /// Steam-dump demand (0..1).
    pub steam_dump_cmd: f64,
    /// Trip requests from the protection layer.
    pub reactor_trip: bool,
    pub turbine_trip: bool,
    /// External reactivity forced by a scenario event (dk/k).
    pub rho_external: f64,
    /// Direct component overrides from scenario / operator events.
    /// `None` = no override this step.
    pub rcp_override: [Option<bool>; 4],
    pub mfw_override: [Option<bool>; 2],
    /// `Some(false)` forces auxiliary feedwater unavailable.
    pub afw_available: Option<bool>,
    pub offsite_override: Option<bool>,
    pub grid_override: Option<bool>,
    pub edg_a_avail_override: Option<bool>,
    pub edg_b_avail_override: Option<bool>,
    /// Stuck-open valve fraction override for a PORV (educational fault).
    pub porv_stuck: Option<f64>,
    /// Condenser effectiveness override (0..1).
    pub condenser_override: Option<f64>,
    /// Manual generator breaker command from the operator.
    pub generator_connect: Option<bool>,
    pub load_demand_cmd: Option<f64>,

    // ---- CVCS / safety-injection / containment demands (from CONTROL) ----
    /// Charging and letdown valve demands (0..1). `None` = hold last value.
    pub charging_cmd: Option<f64>,
    pub letdown_cmd: Option<f64>,
    /// Commanded change in coolant boron (ppm/s): + borate, - dilute.
    pub boron_rate_ppm_s: f64,
    /// Safety-injection actuation signal (latched by the protection layer).
    pub si_signal: bool,
    /// Containment isolation and spray commands. `None` = leave as-is.
    pub cnmt_isolate_cmd: Option<bool>,
    pub cnmt_spray_cmd: Option<bool>,
    /// Loss-of-coolant break size (0..1) forced by a scenario event.
    pub loca_break: Option<f64>,
}

fn t_sat(pressure_mpa: f64) -> f64 {
    // Simple saturation-temperature fit, anchored at 6.9 MPa -> 285 C,
    // valid roughly 1..9 MPa for teaching purposes.
    let p = pressure_mpa.clamp(0.5, 12.0);
    285.0 + 12.8 * (p - 6.9) - 0.35 * (p - 6.9).powi(2)
}

impl PhysicalState {
    /// Hot full-power reference initial condition.
    pub fn hot_full_power() -> Self {
        let mut s = Self::skeleton();
        s.neutron_power = 1.0;
        for i in 0..6 {
            // Equilibrium precursors for n = 1.
            s.precursors[i] = BETA_I[i] / (GEN_TIME * LAMBDA_I[i]);
        }
        s.rod_pos = 0.72;
        s.iodine = 1.0;
        s.xenon = 1.0;
        for j in 0..3 {
            s.decay_groups[j] = DK_GAIN[j] / DK_LAMBDA[j];
        }
        s.decay_heat = s.decay_groups.iter().sum();
        s.t_fuel = T_FUEL_REF;
        s.t_mod = T_MOD_REF;
        s.t_hot = 320.0;
        s.t_cold = 290.0;
        s.primary_pressure = 15.5;
        s.primary_flow = 1.0;
        s.rcp = [true; 4];
        s.pzr_level = 55.0;
        s.pzr_heater_frac = 0.25;
        s.mfw_pump = [true; 2];
        for k in 0..2 {
            s.sg[k].inventory = 1.0;
            s.sg[k].level_pct = 65.0;
            s.sg[k].pressure = 6.9;
            s.sg[k].steam_flow = 1.0;
            s.sg[k].fw_flow = 1.0;
        }
        s.turbine_speed = 1.0;
        s.throttle = 1.0;
        s.mech_power = P_ELEC_RATED_MW / 0.985;
        s.generator_mw = P_ELEC_RATED_MW;
        s.generator_online = true;
        s.load_demand = 1.0;
        s.condenser_pressure = 5.0;
        s.condenser_effectiveness = 1.0;
        s.boron_ppm = BORON_REF_PPM;
        s.charging = 0.30;
        s.letdown = 0.30;
        s.accumulator_frac = 1.0;
        s.grid_available = true;
        s.offsite_power = true;
        s.essential_bus_energized = true;
        s.edg_a_available = true;
        s.edg_b_available = true;
        s.battery_charge = 100.0;

        // Calibrate the reactivity bias so this state is exactly critical.
        s.update_reactivity(&PhysicsInputs::default());
        s.rho_bias = -(s.reactivity);
        s.update_reactivity(&PhysicsInputs::default());
        s
    }

    /// Hot standby / zero-power: subcritical, turbine offline, decay heat only.
    pub fn hot_standby() -> Self {
        let mut s = Self::hot_full_power();
        s.neutron_power = 1e-6;
        for i in 0..6 {
            s.precursors[i] = BETA_I[i] / (GEN_TIME * LAMBDA_I[i]) * 1e-6;
        }
        s.rod_pos = 0.30;
        s.iodine = 0.0;
        s.xenon = 0.0;
        s.decay_groups = [0.0; 3];
        s.decay_heat = 0.0;
        s.t_fuel = 292.0;
        s.t_mod = 291.0;
        s.t_hot = 291.5;
        s.t_cold = 290.5;
        s.turbine_speed = 0.0;
        s.throttle = 0.0;
        s.mech_power = 0.0;
        s.generator_mw = 0.0;
        s.generator_online = false;
        s.load_demand = 0.0;
        for k in 0..2 {
            s.sg[k].steam_flow = 0.02;
            s.sg[k].fw_flow = 0.02;
        }
        s
    }

    fn skeleton() -> Self {
        let sg = SteamGenerator {
            inventory: 1.0,
            level_pct: 65.0,
            pressure: 6.9,
            steam_flow: 0.0,
            fw_flow: 0.0,
            heat_in: 0.0,
        };
        PhysicalState {
            neutron_power: 1.0,
            precursors: [0.0; 6],
            reactivity: 0.0,
            rho_rods: 0.0,
            rho_fuel: 0.0,
            rho_mod: 0.0,
            rho_xenon: 0.0,
            rho_boron: 0.0,
            rho_external: 0.0,
            rho_scram: 0.0,
            rod_pos: 0.72,
            iodine: 1.0,
            xenon: 1.0,
            decay_groups: [0.0; 3],
            decay_heat: 0.0,
            t_fuel: T_FUEL_REF,
            t_mod: T_MOD_REF,
            t_hot: 320.0,
            t_cold: 290.0,
            core_heat_mw: P_RATED_MW,
            primary_pressure: 15.5,
            primary_flow: 1.0,
            rcp: [true; 4],
            pzr_level: 55.0,
            pzr_heater_frac: 0.25,
            pzr_spray_frac: 0.0,
            porv: 0.0,
            sg: [sg.clone(), sg],
            mfw_pump: [true; 2],
            afw_on: false,
            turbine_speed: 1.0,
            throttle: 1.0,
            mech_power: 0.0,
            generator_mw: 0.0,
            generator_online: true,
            load_demand: 1.0,
            steam_dump: 0.0,
            turbine_tripped: false,
            condenser_pressure: 5.0,
            condenser_effectiveness: 1.0,
            boron_ppm: BORON_REF_PPM,
            charging: 0.30,
            letdown: 0.30,
            si_active: false,
            accumulator_frac: 1.0,
            si_flow: 0.0,
            primary_leak: 0.0,
            cnmt_pressure: 0.0,
            cnmt_temp: 30.0,
            cnmt_sump: 0.0,
            cnmt_spray: false,
            cnmt_isolated: false,
            grid_available: true,
            offsite_power: true,
            essential_bus_energized: true,
            edg_a_running: false,
            edg_b_running: false,
            edg_a_available: true,
            edg_b_available: true,
            edg_a_timer: 0.0,
            edg_b_timer: 0.0,
            battery_charge: 100.0,
            reactor_tripped: false,
            scram_active: false,
            rho_bias: 0.0,
        }
    }

    fn update_reactivity(&mut self, inp: &PhysicsInputs) {
        // Integral rod worth: mild S-curve, 0 at bottom, ROD_WORTH at top.
        let x = self.rod_pos.clamp(0.0, 1.0);
        let s_curve = x - (std::f64::consts::TAU * x).sin() / std::f64::consts::TAU;
        self.rho_rods = ROD_WORTH * s_curve + self.rho_bias;
        self.rho_fuel = ALPHA_FUEL * (self.t_fuel - T_FUEL_REF);
        self.rho_mod = ALPHA_MOD * (self.t_mod - T_MOD_REF);
        self.rho_xenon = -XE_WORTH * (self.xenon - 1.0);
        self.rho_boron = BORON_WORTH_PPM * (self.boron_ppm - BORON_REF_PPM);
        self.rho_external = inp.rho_external;
        // Scram worth is held for as long as the reactor is tripped, not just
        // while the rods are physically dropping.
        self.rho_scram = if self.reactor_tripped {
            SCRAM_WORTH
        } else {
            0.0
        };
        self.reactivity = self.rho_rods
            + self.rho_fuel
            + self.rho_mod
            + self.rho_xenon
            + self.rho_boron
            + self.rho_external
            + self.rho_scram;
    }

    fn step_neutronics(&mut self) {
        let beta: f64 = BETA_I.iter().sum();
        // Semi-implicit (backward-Euler-ish) update: unconditionally stable for
        // rho < beta, which is enforced by clamping below.
        let rho = self.reactivity.min(beta - 1e-5);
        let sum_lc: f64 = (0..6).map(|i| LAMBDA_I[i] * self.precursors[i]).sum();
        let a = (rho - beta) / GEN_TIME;
        let n_new = (self.neutron_power + DT * sum_lc) / (1.0 - DT * a);
        let n_new = n_new.max(1e-9);
        for i in 0..6 {
            self.precursors[i] = (self.precursors[i] + DT * (BETA_I[i] / GEN_TIME) * n_new)
                / (1.0 + DT * LAMBDA_I[i]);
        }
        self.neutron_power = n_new.min(50.0);
    }

    fn step_decay_heat(&mut self) {
        let p = self.neutron_power.max(0.0);
        let mut total = 0.0;
        for j in 0..3 {
            self.decay_groups[j] += DT * (DK_GAIN[j] * p - DK_LAMBDA[j] * self.decay_groups[j]);
            self.decay_groups[j] = self.decay_groups[j].max(0.0);
            total += self.decay_groups[j];
        }
        self.decay_heat = total;
    }

    fn step_xenon(&mut self) {
        let n = self.neutron_power.max(0.0);
        let di = LAMBDA_I_XE * n - LAMBDA_I_XE * self.iodine;
        let dxe = (LAMBDA_XE + SIGMA_PHI - LAMBDA_I_XE) + LAMBDA_I_XE * self.iodine
            - (LAMBDA_XE + SIGMA_PHI * n) * self.xenon;
        // Note: production terms scaled so equilibrium at n=1 gives I=Xe=1.
        self.iodine = (self.iodine + DT * di).max(0.0);
        self.xenon = (self.xenon + DT * dxe).max(0.0);
    }

    fn step_thermal(&mut self, inp: &PhysicsInputs) {
        // ---- Primary flow from pump state ----
        let running = self.rcp.iter().filter(|&&r| r).count();
        let target_flow = match running {
            4 => 1.0,
            3 => 0.78,
            2 => 0.55,
            1 => 0.30,
            _ => NATCIRC_FLOW,
        };
        // First-order lag toward target (coastdown / runup).
        let tau = if target_flow < self.primary_flow {
            8.0
        } else {
            3.0
        };
        self.primary_flow += DT * (target_flow - self.primary_flow) / tau;
        self.primary_flow = self.primary_flow.clamp(NATCIRC_FLOW * 0.5, 1.05);

        // ---- Fuel node ----
        let p_fission = FISSION_FRAC * self.neutron_power * P_RATED_MW;
        let p_decay = self.decay_heat * P_RATED_MW;
        let q_fuel_cool = H_FUEL_COOL * (self.t_fuel - self.t_mod);
        self.t_fuel += DT * (p_fission + p_decay - q_fuel_cool) / C_FUEL;
        self.t_fuel = self.t_fuel.clamp(50.0, 2500.0);
        self.core_heat_mw = q_fuel_cool;

        // ---- SG heat removal (uses hot-leg temperature) ----
        let mut q_sg_total = 0.0;
        for k in 0..2 {
            let tsat = t_sat(self.sg[k].pressure);
            // UA scales with primary flow (convective coefficient) and with SG
            // water inventory: uncovered tubes transfer very little heat, so a
            // steam generator that has boiled dry is not a heat sink.
            let inv = self.sg[k].inventory.clamp(0.0, 1.1);
            let ua = SG_UA_RATED * (0.25 + 0.75 * self.primary_flow) * (0.04 + 0.96 * inv);
            let q = (ua * (self.t_hot - tsat)).max(0.0);
            self.sg[k].heat_in = q;
            q_sg_total += q;
        }

        // ---- Primary coolant lumped node (T_mod ~ T_avg) ----
        let dt_mod = (q_fuel_cool - q_sg_total) / C_PRIMARY;
        self.t_mod += DT * dt_mod;
        self.t_mod = self.t_mod.clamp(60.0, 400.0);

        // ---- Hot / cold leg from flow & power split (algebraic + lag) ----
        let w_cp = (self.primary_flow * W_CP_RATED).max(1.5);
        let half_core = (q_fuel_cool / (2.0 * w_cp)).clamp(0.0, 60.0);
        let half_sg = (q_sg_total / (2.0 * w_cp)).clamp(0.0, 60.0);
        let t_hot_target = self.t_mod + half_core;
        let t_cold_target = self.t_mod - half_sg;
        self.t_hot += DT * (t_hot_target - self.t_hot) / 3.0;
        self.t_cold += DT * (t_cold_target - self.t_cold) / 3.0;

        // ---- Pressurizer / primary pressure ----
        self.pzr_heater_frac += DT * (inp.pzr_heater_cmd - self.pzr_heater_frac) / 2.0;
        self.pzr_spray_frac += DT * (inp.pzr_spray_cmd - self.pzr_spray_frac) / 2.0;
        if let Some(f) = inp.porv_stuck {
            self.porv = f.clamp(0.0, 1.0);
        } else {
            // Auto PORV: modulates open above 16.4 MPa.
            let want = ((self.primary_pressure - 16.4) / 0.5).clamp(0.0, 1.0);
            self.porv += DT * (want - self.porv) / 0.5;
        }
        // Insurge from coolant thermal expansion raises level & compresses bubble.
        let insurge = dt_mod.clamp(-3.0, 3.0); // degC/s of average-temp change
        self.pzr_level += DT * (12.0 * insurge + 0.02 * (55.0 - self.pzr_level));
        // Relief-valve outsurge also lowers level.
        self.pzr_level -= DT * 6.0 * self.porv;
        // CVCS makeup, safety injection and any loss of coolant.
        self.pzr_level += DT
            * (2.5 * (self.charging - self.letdown) + 18.0 * self.si_flow
                - 55.0 * self.primary_leak);
        self.pzr_level = self.pzr_level.clamp(0.0, 100.0);
        let dp = 1.6 * (self.pzr_heater_frac - 0.25)     // heaters push up
            - 4.0 * self.pzr_spray_frac                  // spray pulls down
            - 9.0 * self.porv                            // relief pulls down
            + 3.5 * self.si_flow                         // injection repressurises
            - 45.0 * self.primary_leak                   // break depressurises
            + 6.0 * insurge                              // insurge compresses steam bubble
            - 0.30 * (self.primary_pressure - 15.5); // self-restoring bubble
        self.primary_pressure += DT * dp.clamp(-2.5, 2.5);
        self.primary_pressure = self.primary_pressure.clamp(1.0, 20.0);
    }

    fn step_secondary(&mut self, inp: &PhysicsInputs) {
        // Feedwater capacity from running MFW pumps (+AFW if actuated).
        let mfw_running = self.mfw_pump.iter().filter(|&&p| p).count() as f64;
        // Per-pump capacity 0.55 of rated feed; two pumps just cover full load.
        let mfw_cap = (mfw_running * 0.55).min(1.05);
        let afw_cap = if self.afw_on { 0.09 } else { 0.0 };

        for k in 0..2 {
            let sg = &mut self.sg[k];
            // Steam production (fraction of rated) from primary heat input:
            // ~500 MW per SG at full power.
            let steam_prod = (sg.heat_in / 500.0).max(0.0);
            // Steam flow out: turbine throttle demand + steam dump, pressure-biased.
            let demand = self.throttle * self.load_demand + self.steam_dump;
            let flow_out = (demand * (0.6 + 0.4 * (sg.pressure / 6.9))).clamp(0.0, 2.5);
            sg.steam_flow += DT * (flow_out - sg.steam_flow) / 1.5;

            // Feedwater flow follows valve demand, capped by available pumps.
            let fw_target =
                (inp.fw_valve_cmd[k].clamp(0.0, 1.2).min(mfw_cap) + afw_cap).clamp(0.0, 1.2);
            sg.fw_flow += DT * (fw_target - sg.fw_flow) / 2.0;

            // Inventory balance (normalized): in - out.
            sg.inventory += DT * (sg.fw_flow - sg.steam_flow) * 0.02;
            sg.inventory = sg.inventory.clamp(0.0, 1.5);
            // Level (%) with mild shrink/swell on pressure change.
            let swell = (6.9 - sg.pressure) * 1.2;
            sg.level_pct = (20.0 + 45.0 * sg.inventory + swell).clamp(0.0, 100.0);

            // Steam pressure from production vs. removal.
            let dp = 1.1 * (steam_prod - sg.steam_flow);
            sg.pressure += DT * dp.clamp(-1.5, 1.5);
            sg.pressure = sg.pressure.clamp(0.5, 9.5);
        }
    }

    fn step_turbine(&mut self, inp: &PhysicsInputs) {
        if inp.turbine_trip {
            self.turbine_tripped = true;
        }
        // Throttle demand -> valve (fast close on trip).
        let throttle_target = if self.turbine_tripped {
            0.0
        } else {
            inp.throttle_cmd.clamp(0.0, 1.0)
        };
        let tau = if throttle_target < self.throttle {
            0.3
        } else {
            2.0
        };
        self.throttle += DT * (throttle_target - self.throttle) / tau;
        self.throttle = self.throttle.clamp(0.0, 1.0);

        // Steam-dump valve.
        self.steam_dump += DT * (inp.steam_dump_cmd.clamp(0.0, 1.0) - self.steam_dump) / 1.0;

        // Condenser.
        if let Some(e) = inp.condenser_override {
            self.condenser_effectiveness = e.clamp(0.05, 1.0);
        }
        let cond_target = 5.0 / self.condenser_effectiveness.max(0.05)
            + 12.0 * self.steam_dump * (1.0 - self.condenser_effectiveness);
        self.condenser_pressure += DT * (cond_target - self.condenser_pressure) / 5.0;

        // Mechanical power from steam flow through the throttle.
        let total_steam: f64 = self.sg.iter().map(|s| s.steam_flow).sum::<f64>() / 2.0;
        let admitted = total_steam * self.throttle;
        // Backpressure penalty.
        let bp_factor = (1.0 - (self.condenser_pressure - 5.0) / 40.0).clamp(0.3, 1.0);
        let mech_target = if self.turbine_tripped {
            0.0
        } else {
            admitted * P_ELEC_RATED_MW / 0.985 * bp_factor
        };
        self.mech_power += DT * (mech_target - self.mech_power) / 1.5;
        self.mech_power = self.mech_power.max(0.0);

        // Generator breaker / load demand from operator overrides.
        if let Some(c) = inp.generator_connect {
            self.generator_online = c && self.grid_available && !self.turbine_tripped;
        }
        if let Some(l) = inp.load_demand_cmd {
            self.load_demand = l.clamp(0.0, 1.0);
        }

        if self.generator_online && self.grid_available && !self.turbine_tripped {
            // Synchronized: speed locked to grid; electrical load follows shaft.
            self.turbine_speed += DT * (1.0 - self.turbine_speed) / 0.5;
            self.generator_mw = (self.mech_power * 0.985).max(0.0);
            self.load_demand +=
                DT * (inp.load_demand_cmd.unwrap_or(self.load_demand) - self.load_demand) / 3.0;
        } else {
            // Islanded / tripped: shaft accelerates or coasts down.
            if self.generator_online && !self.grid_available {
                // Load rejection: breaker effectively open.
                self.generator_online = false;
            }
            self.generator_mw = 0.0;
            let inertia = 6.0;
            let accel = (self.mech_power - 0.0) / (inertia * P_ELEC_RATED_MW.max(1.0));
            self.turbine_speed += DT
                * (accel
                    - 0.15
                        * (self.turbine_speed - 0.0).max(0.0)
                        * (self.turbine_speed - 1.0).max(0.0));
            if self.turbine_speed < 0.0 {
                self.turbine_speed = 0.0;
            }
            // Overspeed protection.
            if self.turbine_speed > 1.11 {
                self.turbine_tripped = true;
            }
            // Coast down when tripped & no steam.
            if self.turbine_tripped {
                self.turbine_speed -= DT * self.turbine_speed / 30.0;
            }
        }
    }

    fn step_electrical(&mut self, inp: &PhysicsInputs) {
        if let Some(v) = inp.offsite_override {
            self.offsite_power = v;
        }
        if let Some(v) = inp.grid_override {
            self.grid_available = v;
        }
        if let Some(v) = inp.edg_a_avail_override {
            self.edg_a_available = v;
        }
        if let Some(v) = inp.edg_b_avail_override {
            self.edg_b_available = v;
        }
        if !self.grid_available {
            self.generator_online = false;
        }

        let gen_supplying = self.generator_online && self.generator_mw > 5.0;
        let ac_source = gen_supplying || self.offsite_power;

        // EDG auto-start on loss of all AC to the essential bus.
        let need_edg = !ac_source;
        if need_edg {
            if self.edg_a_available && !self.edg_a_running {
                if self.edg_a_timer <= 0.0 {
                    self.edg_a_timer = 3.0;
                }
                self.edg_a_timer -= DT;
                if self.edg_a_timer <= 0.0 {
                    self.edg_a_running = true;
                }
            }
            if self.edg_b_available && !self.edg_b_running {
                if self.edg_b_timer <= 0.0 {
                    self.edg_b_timer = 5.0;
                }
                self.edg_b_timer -= DT;
                if self.edg_b_timer <= 0.0 {
                    self.edg_b_running = true;
                }
            }
        } else {
            // AC restored: shed diesels after a delay (simplified: immediate).
            self.edg_a_running = false;
            self.edg_b_running = false;
            self.edg_a_timer = 0.0;
            self.edg_b_timer = 0.0;
        }
        if !self.edg_a_available {
            self.edg_a_running = false;
        }
        if !self.edg_b_available {
            self.edg_b_running = false;
        }

        let edg_power = self.edg_a_running || self.edg_b_running;
        self.essential_bus_energized = ac_source || edg_power;

        // Battery: charges when the essential bus is up, discharges otherwise.
        if self.essential_bus_energized {
            self.battery_charge += DT * (100.0 - self.battery_charge) / 600.0;
        } else {
            self.battery_charge -= DT * (100.0 / (4.0 * 3600.0)); // ~4 h endurance
        }
        self.battery_charge = self.battery_charge.clamp(0.0, 100.0);

        // RCPs need offsite power or the main generator (not the EDGs).
        let rcp_power = self.offsite_power || gen_supplying;
        if !rcp_power {
            self.rcp = [false; 4];
        }

        // MFW pumps also lost without main AC; AFW runs on the essential bus.
        if !rcp_power {
            self.mfw_pump = [false; 2];
        }
    }

    fn apply_overrides(&mut self, inp: &PhysicsInputs) {
        for i in 0..4 {
            if let Some(v) = inp.rcp_override[i] {
                self.rcp[i] = v;
            }
        }
        for i in 0..2 {
            if let Some(v) = inp.mfw_override[i] {
                self.mfw_pump[i] = v;
            }
        }
    }

    /// CVCS makeup, boron, safety injection / accumulators and the
    /// loss-of-coolant path. Runs before the thermal step so the pressurizer
    /// and pressure model can see the makeup / injection / leak flows, and
    /// before `update_reactivity` so the boron term is current.
    fn step_safety(&mut self, inp: &PhysicsInputs) {
        // Containment isolation / spray commands from the protection layer.
        if let Some(v) = inp.cnmt_isolate_cmd {
            self.cnmt_isolated = v;
        }
        if let Some(v) = inp.cnmt_spray_cmd {
            self.cnmt_spray = v;
        }

        // Safety injection is commanded by CONTROL; accumulators are passive.
        self.si_active = inp.si_signal;
        let si_pump = if self.si_active && self.essential_bus_energized {
            SI_PUMP_FLOW
        } else {
            0.0
        };
        let accum = if self.primary_pressure < ACCUM_PRESS && self.accumulator_frac > 1e-4 {
            ACCUM_FLOW
        } else {
            0.0
        };
        self.accumulator_frac = (self.accumulator_frac - DT * accum / ACCUM_INVENTORY).max(0.0);
        self.si_flow = si_pump + accum;

        // CVCS charging / letdown demands.
        self.charging = inp.charging_cmd.unwrap_or(self.charging).clamp(0.0, 1.0);
        self.letdown = inp.letdown_cmd.unwrap_or(self.letdown).clamp(0.0, 1.0);
        if self.cnmt_isolated {
            self.letdown = 0.0; // letdown line isolates on a containment phase-A signal
        }
        if self.si_active {
            self.charging = 1.0; // charging aligns to the SI header on actuation
        }

        // Loss-of-coolant path: a scenario break plus pressurizer relief flow,
        // both discharging into containment.
        let brk = inp.loca_break.unwrap_or(0.0).clamp(0.0, 1.0);
        let break_flow = brk * 0.085 * (self.primary_pressure / 15.5).max(0.05).sqrt();
        self.primary_leak = break_flow + 0.02 * self.porv;

        // Boron mixing: injected borated water pulls concentration toward the
        // source value; the operator can also borate / dilute directly. Normal
        // charging is blended at the current concentration (no net change).
        self.boron_ppm += DT
            * (inp.boron_rate_ppm_s
                + self.si_flow * BORON_MIX_GAIN * (BORATED_SOURCE_PPM - self.boron_ppm));
        self.boron_ppm = self.boron_ppm.clamp(0.0, 4000.0);
    }

    /// Single-volume containment: pressure and temperature rise with any
    /// coolant released from the primary, and relax through passive heat sinks
    /// and (if running and powered) containment spray.
    fn step_containment(&mut self) {
        let spray_effective = self.cnmt_spray && self.essential_bus_energized;
        let relax = CNMT_PASSIVE_RELAX
            + if spray_effective {
                CNMT_SPRAY_RELAX
            } else {
                0.0
            };
        let dp = CNMT_RELEASE_GAIN * self.primary_leak - relax * self.cnmt_pressure;
        self.cnmt_pressure = (self.cnmt_pressure + DT * dp).clamp(0.0, 800.0);

        let t_target = 30.0 + 0.35 * self.cnmt_pressure;
        let t_tau = if spray_effective { 20.0 } else { 70.0 };
        self.cnmt_temp += DT * (t_target - self.cnmt_temp) / t_tau;

        self.cnmt_sump += DT * (self.primary_leak * 9.0 + self.si_flow * 3.0);
        self.cnmt_sump = self.cnmt_sump.clamp(0.0, 100.0);
    }

    fn step_rods(&mut self, inp: &PhysicsInputs) {
        if inp.reactor_trip && !self.reactor_tripped {
            self.reactor_tripped = true;
            self.scram_active = true;
        }
        if self.scram_active {
            // Gravity drop: fast, ~2.5 s to bottom.
            self.rod_pos -= DT / 2.5;
            if self.rod_pos <= 0.0 {
                self.rod_pos = 0.0;
                self.scram_active = false; // fully inserted; scram worth stays via rho_rods
            }
        } else if !self.reactor_tripped {
            self.rod_pos += DT * inp.rod_speed_cmd;
            self.rod_pos = self.rod_pos.clamp(0.0, 1.0);
        }
    }

    /// Advance the physical state by one fixed timestep.
    pub fn step(&mut self, inp: &PhysicsInputs) {
        self.apply_overrides(inp);
        self.step_rods(inp);
        self.step_safety(inp);
        self.update_reactivity(inp);
        self.step_neutronics();
        self.step_decay_heat();
        self.step_xenon();
        self.step_thermal(inp);
        self.step_secondary(inp);
        self.step_turbine(inp);
        self.step_electrical(inp);
        self.step_containment();

        // AFW auto-actuation on low SG level (physical actuation logic lives in
        // the protection layer, but the pump response is physical).
        let min_level = self.sg.iter().map(|s| s.level_pct).fold(f64::MAX, f64::min);
        if min_level < 30.0 {
            self.afw_on = true;
        } else if min_level > 55.0 {
            self.afw_on = false;
        }
        // A scenario / operator can force auxiliary feedwater unavailable.
        if inp.afw_available == Some(false) {
            self.afw_on = false;
        }
    }

    /// Total core thermal power (MW) — fission + decay.
    pub fn thermal_power_mw(&self) -> f64 {
        (self.neutron_power + self.decay_heat) * P_RATED_MW
    }
}
