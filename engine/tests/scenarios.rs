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
