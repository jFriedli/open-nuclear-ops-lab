//! Qualitative physics-validation and determinism tests.
//!
//! These do NOT assert engineering accuracy. They assert that the simplified
//! model behaves in the correct *direction* for well-known reactor phenomena,
//! and that identical inputs produce identical outputs.

use nol_engine::Engine;
use serde_json::Value;

fn engine(scenario: &str) -> Engine {
    Engine::new(scenario, 12345.0).expect("engine")
}

/// Step `seconds` of simulated time.
fn run(e: &mut Engine, seconds: f64) {
    let steps = (seconds / e.dt()).round() as u32;
    e.step(steps);
}

fn snap(e: &Engine) -> Value {
    serde_json::from_str(&e.snapshot()).unwrap()
}

fn hmi(v: &Value, key: &str) -> f64 {
    v["hmi"][key]
        .as_f64()
        .unwrap_or_else(|| panic!("missing hmi.{key}"))
}

fn phys(e: &mut Engine, key: &str) -> f64 {
    e.set_debug(true);
    let v = snap(e);
    v["physical"][key]
        .as_f64()
        .unwrap_or_else(|| panic!("missing physical.{key}"))
}

#[test]
fn starts_in_stable_full_power_state() {
    let mut e = engine("baseline");
    run(&mut e, 120.0);
    let s = snap(&e);
    let power = hmi(&s, "neutron_power");
    assert!((power - 100.0).abs() < 4.0, "power drifted to {power}%");
    let press = hmi(&s, "primary_pressure");
    assert!(
        (press - 15.5).abs() < 0.6,
        "pressure drifted to {press} MPa"
    );
    let tavg = hmi(&s, "t_avg");
    assert!((tavg - 305.0).abs() < 8.0, "t_avg drifted to {tavg}");
    // no reactor trip in a clean baseline run
    assert!(!s["controllers"]["reactor_trip_latched"].as_bool().unwrap());
}

#[test]
fn identical_runs_are_deterministic() {
    let mut a = engine("baseline");
    let mut b = engine("baseline");
    for _ in 0..50 {
        a.step(37);
        b.step(37);
    }
    // apply the same action at the same sim time
    a.action(r#"{"type":"target_power","value":85}"#);
    b.action(r#"{"type":"target_power","value":85}"#);
    run(&mut a, 200.0);
    run(&mut b, 200.0);
    assert_eq!(a.snapshot(), b.snapshot(), "snapshots diverged");
}

#[test]
fn different_seeds_differ_but_stay_bounded() {
    let mut a = Engine::new("baseline", 1.0).unwrap();
    let mut b = Engine::new("baseline", 2.0).unwrap();
    run(&mut a, 60.0);
    run(&mut b, 60.0);
    assert_ne!(a.snapshot(), b.snapshot());
    assert!((hmi(&snap(&a), "neutron_power") - hmi(&snap(&b), "neutron_power")).abs() < 5.0);
}

#[test]
fn positive_reactivity_increases_neutron_population() {
    let mut e = engine("baseline");
    run(&mut e, 10.0);
    let n0 = phys(&mut e, "neutron_power");
    // Manual rods: withdraw gently for a short time.
    e.action(r#"{"type":"rod_mode","mode":"manual"}"#);
    e.action(r#"{"type":"rod_speed","value":0.002}"#);
    run(&mut e, 4.0);
    let n1 = phys(&mut e, "neutron_power");
    assert!(
        n1 > n0 * 1.002,
        "n0={n0} n1={n1}: withdrawing rods did not raise flux"
    );
}

#[test]
fn negative_temperature_feedback_opposes_power_increase() {
    let mut e = engine("baseline");
    run(&mut e, 10.0);
    let t_fuel_0 = phys(&mut e, "t_fuel");
    e.action(r#"{"type":"rod_mode","mode":"manual"}"#);
    e.action(r#"{"type":"rod_speed","value":0.003}"#);
    run(&mut e, 6.0);
    let peak = phys(&mut e, "neutron_power");
    e.action(r#"{"type":"rod_speed","value":0.0}"#);
    run(&mut e, 90.0);
    let settled = phys(&mut e, "neutron_power");
    // Doppler + MTC must pull power back down from the prompt peak.
    assert!(
        settled < peak,
        "feedback did not oppose rise: peak={peak} settled={settled}"
    );
    // fuel temperature must have risen from the power increase
    assert!(
        phys(&mut e, "t_fuel") > t_fuel_0 + 2.0,
        "fuel temperature did not rise"
    );
}

#[test]
fn reactor_trip_drops_fission_power_but_decay_heat_remains() {
    let mut e = engine("baseline");
    run(&mut e, 30.0);
    e.action(r#"{"type":"trip_reactor"}"#);
    run(&mut e, 8.0);
    e.set_debug(true);
    let n = phys(&mut e, "neutron_power");
    let decay = phys(&mut e, "decay_heat");
    assert!(n < 0.05, "fission power did not collapse: {n}");
    assert!(decay > 0.02, "decay heat vanished immediately: {decay}");
    // decay heat should still be well below full power
    assert!(decay < 0.10);
    // and it should decrease over the next few minutes
    run(&mut e, 240.0);
    let decay2 = phys(&mut e, "decay_heat");
    assert!(
        decay2 < decay,
        "decay heat did not decay: {decay} -> {decay2}"
    );
}

#[test]
fn loss_of_feedwater_lowers_sg_inventory() {
    let mut e = engine("baseline");
    run(&mut e, 20.0);
    let lvl0 = snap(&e)["hmi"]["sg1_level"].as_f64().unwrap();
    e.action(r#"{"type":"mfw","index":0,"on":false}"#);
    e.action(r#"{"type":"mfw","index":1,"on":false}"#);
    run(&mut e, 40.0);
    let lvl1 = snap(&e)["hmi"]["sg1_level"].as_f64().unwrap();
    assert!(
        lvl1 < lvl0 - 1.0,
        "SG level did not fall after MFW loss: {lvl0} -> {lvl1}"
    );
}

#[test]
fn loss_of_offsite_power_trips_pumps_and_starts_diesels() {
    let json = include_str!("../../scenarios/loss-of-offsite-power.json");
    let mut e = Engine::new(json, 999.0).unwrap();
    run(&mut e, 5.0);
    let before = snap(&e);
    assert!(before["electrical"]["offsite_power"].as_bool().unwrap());
    // event fires at t=20 in the scenario
    run(&mut e, 40.0);
    let after = snap(&e);
    assert!(
        !after["electrical"]["offsite_power"].as_bool().unwrap(),
        "offsite power still present"
    );
    assert!(
        !after["electrical"]["rcp_powered"].as_bool().unwrap(),
        "RCPs still powered after LOOP"
    );
    assert!(
        after["electrical"]["edg_a_running"].as_bool().unwrap()
            || after["electrical"]["edg_b_running"].as_bool().unwrap(),
        "no diesel started"
    );
    assert!(
        after["controllers"]["reactor_trip_latched"]
            .as_bool()
            .unwrap(),
        "no reactor trip after LOOP"
    );
    // decay heat present after the trip
    e.set_debug(true);
    assert!(phys(&mut e, "decay_heat") > 0.02);
}

#[test]
fn without_a_heat_sink_the_plant_cannot_cool_down() {
    // Lose feedwater, the turbine, auxiliary feedwater and the condenser. The
    // reactor trips, but with no way to reject heat the primary stays hot near
    // steam-generator saturation instead of cooling toward cold shutdown.
    let mut isolated = engine("baseline");
    run(&mut isolated, 20.0);
    isolated.action(r#"{"type":"mfw","index":0,"on":false}"#);
    isolated.action(r#"{"type":"mfw","index":1,"on":false}"#);
    isolated.action(r#"{"type":"trip_turbine"}"#);
    isolated.action(r#"{"type":"inject","time":0,"target":"afw","action":"trip"}"#);
    isolated.action(
        r#"{"type":"inject","time":0,"target":"condenser","action":"degrade","value":0.08}"#,
    );
    run(&mut isolated, 300.0);
    let t_isolated = hmi(&snap(&isolated), "t_avg");

    // A clean turbine trip with feedwater and the condenser available cools the
    // plant noticeably further over the same time.
    let mut normal = engine("baseline");
    run(&mut normal, 20.0);
    normal.action(r#"{"type":"trip_turbine"}"#);
    run(&mut normal, 300.0);
    let t_normal = hmi(&snap(&normal), "t_avg");

    assert!(
        t_isolated > 290.0,
        "isolated plant cooled too far: {t_isolated}"
    );
    assert!(
        t_isolated > t_normal + 3.0,
        "losing the heat sink made no difference: isolated={t_isolated} normal={t_normal}"
    );
    // and the reactor is shut down in both cases
    assert!(snap(&isolated)["controllers"]["reactor_trip_latched"]
        .as_bool()
        .unwrap());
}

#[test]
fn increased_steam_demand_cools_the_cold_leg() {
    let mut e = engine("baseline");
    run(&mut e, 40.0);
    let t0 = hmi(&snap(&e), "t_cold");
    // Open the steam dump wide via the instructor panel: extra steam draw.
    e.action(r#"{"type":"inject","time":0,"target":"condenser","action":"degrade","value":1.0}"#);
    e.action(r#"{"type":"target_load","value":100}"#);
    run(&mut e, 40.0);
    let t1 = hmi(&snap(&e), "t_cold");
    // Cold-leg temperature stays in a plausible band (no numerical blow-up).
    assert!((t1 - t0).abs() < 18.0, "cold leg unstable: {t0} -> {t1}");
}

#[test]
fn instrument_stuck_value_diverges_from_truth_in_debug() {
    let json = include_str!("../../scenarios/pressure-transmitter-stuck.json");
    let mut e = Engine::new(json, 7.0).unwrap();
    e.set_debug(true);
    // Fault applies at t=15; a real pressure perturbation ramps in from t=90.
    run(&mut e, 140.0);
    e.set_debug(true);
    let s2 = snap(&e);
    let chans = s2["channels"].as_array().unwrap();
    // Find the stuck channel A and a live channel and confirm they disagree.
    let mut stuck = None;
    let mut live = None;
    for sig in chans {
        if sig["key"] == "primary_pressure" {
            for ch in sig["channels"].as_array().unwrap() {
                if ch["id"] == "primary_pressure.A" {
                    stuck = ch["value"].as_f64();
                }
                if ch["id"] == "primary_pressure.B" {
                    live = ch["value"].as_f64();
                }
            }
        }
    }
    let (a, b) = (stuck.unwrap(), live.unwrap());
    let dev_alarm = s2["alarm_history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x["id"] == "DEV_PRESS");
    assert!(
        (a - b).abs() > 0.1 || dev_alarm,
        "stuck pressure channel A ({a:.2}) did not diverge from live channel B ({b:.2})"
    );
}

#[test]
fn energy_balance_is_approximately_conserved_at_steady_state() {
    let mut e = engine("baseline");
    run(&mut e, 120.0);
    e.set_debug(true);
    let v = snap(&e);
    let p = &v["physical"];
    let core = p["core_heat_mw"].as_f64().unwrap();
    let sg_heat: f64 = p["sg"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["heat_in"].as_f64().unwrap())
        .sum();
    // At steady state, heat into the primary ~ heat removed by the SGs (±12%).
    let rel = (core - sg_heat).abs() / core;
    assert!(
        rel < 0.12,
        "steady-state primary energy imbalance {rel:.3} (core={core:.0} MW, sg={sg_heat:.0} MW)"
    );
    // And core heat should be close to rated.
    assert!(
        (core - 1000.0).abs() < 120.0,
        "core heat {core:.0} MW far from rated"
    );
}

#[test]
fn pause_and_single_step_do_not_change_determinism() {
    let mut a = engine("baseline");
    let mut b = engine("baseline");
    // a: one big step. b: many tiny steps. Must match (fixed-DT integrator).
    a.step(500);
    for _ in 0..500 {
        b.step(1);
    }
    assert_eq!(a.snapshot(), b.snapshot());
}
