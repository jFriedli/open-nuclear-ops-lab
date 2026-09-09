//! Scenario regression tests: every shipped scenario must load, run for several
//! simulated minutes without numerical blow-up, and be deterministic.

use nol_engine::Engine;
use serde_json::Value;

const SCENARIOS: &[(&str, &str)] = &[
    ("baseline", "baseline"),
    (
        "loop",
        include_str!("../../scenarios/loss-of-offsite-power.json"),
    ),
    (
        "rcp",
        include_str!("../../scenarios/reactor-coolant-pump-trip.json"),
    ),
    (
        "mfw",
        include_str!("../../scenarios/feedwater-pump-trip.json"),
    ),
    ("turbine", include_str!("../../scenarios/turbine-trip.json")),
    (
        "loadrej",
        include_str!("../../scenarios/load-rejection.json"),
    ),
    (
        "sbo",
        include_str!("../../scenarios/station-blackout-partial.json"),
    ),
    (
        "sgdrift",
        include_str!("../../scenarios/sg-level-transmitter-drift.json"),
    ),
    (
        "pstuck",
        include_str!("../../scenarios/pressure-transmitter-stuck.json"),
    ),
    (
        "roddis",
        include_str!("../../scenarios/control-rod-position-disagreement.json"),
    ),
    ("porv", include_str!("../../scenarios/porv-stuck-open.json")),
    (
        "cond",
        include_str!("../../scenarios/degraded-condenser.json"),
    ),
    (
        "edg",
        include_str!("../../scenarios/emergency-diesel-failure.json"),
    ),
    (
        "geninstr",
        include_str!("../../scenarios/generic-instrumentation-failure.json"),
    ),
    (
        "lohs",
        include_str!("../../scenarios/loss-of-heat-sink.json"),
    ),
    (
        "masked",
        include_str!("../../scenarios/instrument-masked-transient.json"),
    ),
    (
        "hmispoof",
        include_str!("../../scenarios/hmi-spoofed-sg-level.json"),
    ),
    (
        "sigbias",
        include_str!("../../scenarios/signal-bias-pressure.json"),
    ),
    ("sloca", include_str!("../../scenarios/small-loca.json")),
    ("sgtr", include_str!("../../scenarios/sg-tube-rupture.json")),
    (
        "atws",
        include_str!("../../scenarios/anticipated-transient-without-scram.json"),
    ),
    (
        "dilution",
        include_str!("../../scenarios/boron-dilution.json"),
    ),
    (
        "cyber-sp",
        include_str!("../../scenarios/cyber-setpoint-manipulation.json"),
    ),
    (
        "cyber-bypass",
        include_str!("../../scenarios/cyber-protection-bypass.json"),
    ),
    (
        "cyber-lov",
        include_str!("../../scenarios/cyber-loss-of-view.json"),
    ),
    (
        "cooldown",
        include_str!("../../scenarios/cooldown-drill.json"),
    ),
];

fn finite(v: &Value) -> bool {
    match v {
        Value::Number(n) => n.as_f64().map(|x| x.is_finite()).unwrap_or(false),
        Value::Array(a) => a.iter().all(finite),
        Value::Object(o) => o.values().all(finite),
        _ => true,
    }
}

#[test]
fn every_scenario_loads_and_runs_stably() {
    for (name, json) in SCENARIOS {
        let mut e = Engine::new(json, 0.0).unwrap_or_else(|err| panic!("{name}: {err}"));
        e.set_debug(true);
        // 10 simulated minutes.
        let steps = (600.0 / e.dt()).round() as u32;
        e.step(steps);
        let s: Value = serde_json::from_str(&e.snapshot()).unwrap();
        assert!(finite(&s), "{name}: non-finite value in snapshot");

        let p = &s["physical"];
        let press = p["primary_pressure"].as_f64().unwrap();
        assert!(
            (1.0..20.0).contains(&press),
            "{name}: primary pressure {press}"
        );
        let tfuel = p["t_fuel"].as_f64().unwrap();
        assert!((40.0..2500.0).contains(&tfuel), "{name}: fuel temp {tfuel}");
        let n = p["neutron_power"].as_f64().unwrap();
        assert!((0.0..2.0).contains(&n), "{name}: neutron power {n}");
        for sg in p["sg"].as_array().unwrap() {
            let lvl = sg["level_pct"].as_f64().unwrap();
            assert!((0.0..=100.0).contains(&lvl), "{name}: SG level {lvl}");
        }
    }
}

#[test]
fn every_scenario_is_deterministic() {
    for (name, json) in SCENARIOS {
        let mut a = Engine::new(json, 12345.0).unwrap();
        let mut b = Engine::new(json, 12345.0).unwrap();
        let steps = (300.0 / a.dt()).round() as u32;
        a.step(steps);
        b.step(steps);
        assert_eq!(a.snapshot(), b.snapshot(), "{name}: non-deterministic");
    }
}

#[test]
fn loop_scenario_meets_acceptance_criteria() {
    // Mirrors the project's "final acceptance scenario".
    let json = include_str!("../../scenarios/loss-of-offsite-power.json");
    let mut e = Engine::new(json, 20260908.0).unwrap();
    e.set_debug(true);

    // 1-3: starts stable
    let steps = (15.0 / e.dt()).round() as u32;
    e.step(steps);
    let s0: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!((s0["hmi"]["neutron_power"].as_f64().unwrap() - 100.0).abs() < 5.0);
    assert!(!s0["controllers"]["reactor_trip_latched"].as_bool().unwrap());

    // 4-8: run through the event
    e.step((60.0 / e.dt()).round() as u32);
    let s1: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(
        !s1["electrical"]["offsite_power"].as_bool().unwrap(),
        "offsite still on"
    );
    assert!(
        s1["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "no reactor trip"
    );
    assert!(
        s1["controllers"]["turbine_trip_latched"].as_bool().unwrap(),
        "no turbine trip"
    );
    assert!(
        s1["electrical"]["edg_a_running"].as_bool().unwrap()
            || s1["electrical"]["edg_b_running"].as_bool().unwrap(),
        "no diesel running"
    );
    assert!(
        s1["physical"]["decay_heat"].as_f64().unwrap() > 0.02,
        "decay heat gone"
    );

    // 9: acknowledge alarms
    let r = e.action(r#"{"type":"ack_all"}"#);
    assert!(serde_json::from_str::<Value>(&r).unwrap()["ok"]
        .as_bool()
        .unwrap());
    let s2: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert_eq!(
        s2["alarm_unacked"].as_u64().unwrap(),
        0,
        "alarms still unacked"
    );

    // 10: event log recorded the trips
    let log = s2["event_log"].as_array().unwrap();
    assert!(
        log.iter().any(|x| x["category"] == "trip"),
        "no trip in event log"
    );
    assert!(
        log.iter().any(|x| x["category"] == "scenario"),
        "no scenario event in log"
    );

    // 13: determinism on replay with the same action timing
    let mut c = Engine::new(json, 20260908.0).unwrap();
    c.set_debug(true);
    c.step((75.0 / c.dt()).round() as u32);
    c.action(r#"{"type":"ack_all"}"#);
    assert_eq!(c.snapshot(), e.snapshot(), "replay diverged");
}

#[test]
fn small_loca_trips_the_reactor_and_actuates_safety_injection() {
    let json = include_str!("../../scenarios/small-loca.json");
    let mut e = Engine::new(json, 4242.0).unwrap();
    e.set_debug(true);

    // Before the break: stable, no safeguards.
    e.step((25.0 / e.dt()).round() as u32);
    let s0: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(!s0["controllers"]["reactor_trip_latched"].as_bool().unwrap());
    assert!(!s0["controllers"]["si_latched"].as_bool().unwrap());
    assert!(s0["safety"]["cnmt_pressure"].as_f64().unwrap() < 1.0);

    // Ride out the transient.
    e.step((240.0 / e.dt()).round() as u32);
    let s1: Value = serde_json::from_str(&e.snapshot()).unwrap();

    assert!(
        s1["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "reactor did not trip on the LOCA"
    );
    assert!(
        s1["controllers"]["si_latched"].as_bool().unwrap(),
        "safety injection never actuated"
    );
    assert!(
        s1["controllers"]["cnmt_isolation_latched"]
            .as_bool()
            .unwrap(),
        "containment did not isolate"
    );
    let cnmt = s1["safety"]["cnmt_pressure"].as_f64().unwrap();
    assert!(
        cnmt > 5.0 && cnmt < 400.0,
        "containment pressure implausible: {cnmt} kPa"
    );
    assert!(
        s1["safety"]["boron_ppm"].as_f64().unwrap() > 905.0,
        "boron did not rise with borated injection"
    );
    assert!(
        s1["safety"]["cnmt_sump"].as_f64().unwrap() > 1.0,
        "no coolant collected in the containment sump"
    );
    // Fission is shut down; decay heat remains.
    assert!(s1["physical"]["neutron_power"].as_f64().unwrap() < 0.05);
    assert!(s1["physical"]["decay_heat"].as_f64().unwrap() > 0.012);
}

fn run_secs(json: &str, seed: f64, secs: f64) -> (Engine, Value) {
    let mut e = Engine::new(json, seed).unwrap();
    e.set_debug(true);
    e.step((secs / e.dt()).round() as u32);
    let s = serde_json::from_str(&e.snapshot()).unwrap();
    (e, s)
}

fn raised(s: &Value, id: &str) -> bool {
    s["alarm_history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a["id"] == id && a["transition"] == "raised")
}

#[test]
fn sg_tube_rupture_fills_the_affected_sg_and_trips() {
    let json = include_str!("../../scenarios/sg-tube-rupture.json");
    let (_e, s) = run_secs(json, 4242.0, 200.0);
    assert!(
        s["safety"]["sg_ruptured"][0].as_bool().unwrap(),
        "SG-1 not flagged ruptured"
    );
    assert!(
        !s["safety"]["sg_ruptured"][1].as_bool().unwrap(),
        "SG-2 wrongly flagged"
    );
    assert!(raised(&s, "SGTR"), "no tube-rupture alarm");
    assert!(
        s["physical"]["sg"][0]["level_pct"].as_f64().unwrap()
            > s["physical"]["sg"][1]["level_pct"].as_f64().unwrap() + 10.0,
        "ruptured SG did not fill relative to the intact one"
    );
    assert!(
        s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "reactor never tripped"
    );
    assert!(
        s["physical"]["cnmt_pressure"].as_f64().unwrap() < 2.0,
        "leak wrongly reached containment"
    );
}

#[test]
fn atws_leaves_the_reactor_at_power_until_a_manual_scram() {
    let json = include_str!("../../scenarios/anticipated-transient-without-scram.json");
    let mut e = Engine::new(json, 99.0).unwrap();
    e.set_debug(true);
    // Automatic trip is demanded (turbine trip) but rods do not insert.
    e.step((60.0 / e.dt()).round() as u32);
    let s: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(
        s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "no trip demand"
    );
    assert!(
        s["physical"]["rod_pos"].as_f64().unwrap() > 0.5,
        "rods dropped despite ATWS"
    );
    assert!(
        s["hmi"]["neutron_power"].as_f64().unwrap() > 40.0,
        "power collapsed without a scram"
    );
    assert!(raised(&s, "SCRAM_INCOMPLETE"), "no scram-incomplete alarm");

    // The diverse manual scram still works.
    e.action(r#"{"type":"trip_reactor"}"#);
    e.step((15.0 / e.dt()).round() as u32);
    let s2: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(
        s2["physical"]["rod_pos"].as_f64().unwrap() < 0.05,
        "manual scram did not insert the rods"
    );
    assert!(
        s2["hmi"]["neutron_power"].as_f64().unwrap() < 5.0,
        "power did not collapse after manual scram"
    );
}

#[test]
fn boron_dilution_is_masked_by_rod_control() {
    let json = include_str!("../../scenarios/boron-dilution.json");
    let (_e, s) = run_secs(json, 7.0, 240.0);
    assert!(
        s["safety"]["boron_ppm"].as_f64().unwrap() < 830.0,
        "boron did not fall from dilution"
    );
    // Automatic rod control holds power roughly constant by inserting rods.
    assert!(
        (s["hmi"]["neutron_power"].as_f64().unwrap() - 100.0).abs() < 8.0,
        "power not held by rod control"
    );
    assert!(
        s["physical"]["rod_pos"].as_f64().unwrap() < 0.71,
        "rods did not insert to compensate the dilution"
    );
    assert!(!s["controllers"]["reactor_trip_latched"].as_bool().unwrap());
}

#[test]
fn cyber_setpoint_manipulation_depressurises_behind_a_spoofed_gauge() {
    let json = include_str!("../../scenarios/cyber-setpoint-manipulation.json");
    let (_e, s) = run_secs(json, 13.0, 150.0);
    let shown = s["hmi"]["primary_pressure"].as_f64().unwrap();
    let truth = s["physical"]["primary_pressure"].as_f64().unwrap();
    assert!(
        (shown - 15.5).abs() < 0.2,
        "displayed pressure not spoofed to normal"
    );
    assert!(truth < 14.2, "real pressure did not fall: {truth}");
    // The suppressed alarm never shows...
    assert!(
        s["alarms"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["id"] != "PRESS_LO" || !a["active"].as_bool().unwrap()),
        "low-pressure alarm was not suppressed"
    );
    // ...but the safety-function strip still tells the truth.
    let inv = s["csf"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["name"] == "PRIMARY INVENTORY")
        .unwrap()["status"]
        .as_str()
        .unwrap();
    assert_ne!(inv, "Normal", "CSF should flag the real depressurisation");
    assert!(s["hmi_faulted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "primary_pressure"));
}

#[test]
fn cyber_protection_bypass_allows_overpower_with_no_trip() {
    let json = include_str!("../../scenarios/cyber-protection-bypass.json");
    let (mut e, s) = run_secs(json, 14.0, 60.0);
    assert!(
        s["hmi"]["neutron_power"].as_f64().unwrap() > 112.0,
        "power did not exceed the trip setpoint"
    );
    assert!(
        !s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "reactor tripped even though protection was bypassed"
    );
    assert!(
        s["controllers"]["reactor_trip_blocked"].as_bool().unwrap(),
        "block flag not set"
    );
    assert!(raised(&s, "RX_TRIP_BLOCKED"), "no trip-suppressed alarm");
    // The manual scram is not on the bypassed path.
    e.action(r#"{"type":"trip_reactor"}"#);
    e.step((10.0 / e.dt()).round() as u32);
    let s2: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(s2["controllers"]["reactor_trip_latched"].as_bool().unwrap());
    assert!(
        s2["hmi"]["neutron_power"].as_f64().unwrap() < 10.0,
        "manual scram did not work"
    );
}

#[test]
fn cyber_loss_of_view_freezes_gauges_but_not_protection() {
    let json = include_str!("../../scenarios/cyber-loss-of-view.json");
    let (_e, s) = run_secs(json, 15.0, 150.0);
    // Frozen displays still read ~normal...
    assert!(
        (s["hmi"]["sg1_level"].as_f64().unwrap() - 65.0).abs() < 6.0,
        "SG-1 display not frozen"
    );
    // ...while the true level has fallen and protection has acted on it.
    assert!(
        s["physical"]["sg"][0]["level_pct"].as_f64().unwrap() < 40.0,
        "true SG level did not fall"
    );
    assert!(
        s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "protection did not act on the true value"
    );
    assert!(
        s["hmi_faulted"].as_array().unwrap().len() >= 3,
        "multiple displays should be flagged"
    );
}

#[test]
fn scripted_turbine_and_reactor_trips_actually_fire() {
    let mut e = Engine::new(include_str!("../../scenarios/turbine-trip.json"), 5.0).unwrap();
    e.step((70.0 / e.dt()).round() as u32);
    let s: Value = serde_json::from_str(&e.snapshot()).unwrap();
    assert!(
        s["controllers"]["turbine_trip_latched"].as_bool().unwrap(),
        "scripted turbine trip did not fire"
    );
    assert!(
        s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "reactor did not follow the turbine trip"
    );

    let mut e2 = Engine::new(include_str!("../../scenarios/load-rejection.json"), 5.0).unwrap();
    e2.step((90.0 / e2.dt()).round() as u32);
    let s2: Value = serde_json::from_str(&e2.snapshot()).unwrap();
    assert!(
        s2["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "load rejection did not trip the plant"
    );
}
