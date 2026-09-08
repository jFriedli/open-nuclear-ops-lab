//! Tests for the fault-layer separation (physical / instrument / signal / HMI)
//! and for deterministic session record & replay.

use nol_engine::Engine;
use serde_json::Value;

fn run(e: &mut Engine, seconds: f64) {
    e.step((seconds / e.dt()).round() as u32);
}
fn snap(e: &Engine) -> Value {
    serde_json::from_str(&e.snapshot()).unwrap()
}

#[test]
fn hmi_fault_deceives_the_display_only() {
    // Freeze the *displayed* SG-1 level at 65% while the real level falls.
    let scenario = r#"{
      "id": "t-hmi", "name": "hmi test", "initial": "hot_full_power", "seed": 1,
      "events": [
        { "time": 5, "target": "mfw.0", "action": "trip" },
        { "time": 5, "target": "mfw.1", "action": "trip" },
        { "time": 5, "target": "hmi.sg1_level", "action": "set", "value": 65 }
      ]
    }"#;
    let mut e = Engine::new(scenario, 1.0).unwrap();
    e.set_debug(true);
    run(&mut e, 90.0);
    let s = snap(&e);

    // The operator's gauge still says 65 %…
    assert!(
        (s["hmi"]["sg1_level"].as_f64().unwrap() - 65.0).abs() < 0.5,
        "HMI value not held"
    );
    assert!(s["hmi_faulted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "sg1_level"));

    // …but the true instrument reading (debug) has fallen well below it…
    let truth = s["hmi_truth"]["sg1_level"].as_f64().unwrap();
    assert!(truth < 60.0, "true level did not fall: {truth}");

    // …and the protection system, which uses the true reading, still trips on
    // low-low level, and the alarm system still raises the low-level alarm.
    assert!(
        s["controllers"]["reactor_trip_latched"].as_bool().unwrap(),
        "no trip despite real low level"
    );
    assert!(
        s["alarm_history"]
            .as_array()
            .unwrap()
            .iter()
            .any(|a| a["id"] == "SG1_LVL_LO"),
        "SG-1 low-level alarm never raised"
    );
}

#[test]
fn signal_fault_fools_control_and_hmi_together() {
    // A signal-processing bias of +0.6 MPa on primary pressure feeds BOTH the
    // controller and the HMI — it cannot be caught by channel disagreement.
    let scenario = r#"{
      "id": "t-sig", "name": "sig test", "initial": "hot_full_power", "seed": 2,
      "events": [ { "time": 10, "target": "signal.primary_pressure", "action": "bias", "value": 0.8 } ]
    }"#;
    let mut e = Engine::new(scenario, 2.0).unwrap();
    e.set_debug(true);
    run(&mut e, 60.0);
    let s = snap(&e);

    let shown = s["hmi"]["primary_pressure"].as_f64().unwrap();
    let truth = s["hmi_truth"]["primary_pressure"].as_f64().unwrap();
    // Displayed and processed-truth agree (both biased); channel spread stays small.
    assert!(
        (shown - truth).abs() < 0.05,
        "hmi and signal-truth diverged"
    );
    assert!(
        s["hmi"]["primary_pressure__dev"].as_f64().unwrap() < 0.3,
        "unexpected channel disagreement"
    );
    assert!(s["signal_faulted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "primary_pressure"));

    // The pressuriser controller reacts to the (biased-high) reading by cooling
    // the system down, so the TRUE physical pressure ends up below nominal.
    let real = s["physical"]["primary_pressure"].as_f64().unwrap();
    assert!(
        real < 15.3,
        "controller did not chase the biased signal: real={real}"
    );
}

#[test]
fn session_export_and_replay_is_deterministic() {
    let mut a = Engine::new("baseline", 777.0).unwrap();
    a.set_running(true);
    // A little operating sequence at known ticks.
    run(&mut a, 20.0);
    a.action(r#"{"type":"rod_mode","mode":"manual"}"#);
    a.action(r#"{"type":"rod_speed","value":0.002}"#);
    run(&mut a, 15.0);
    a.action(r#"{"type":"rod_speed","value":0.0}"#);
    a.action(r#"{"type":"target_load","value":92}"#);
    run(&mut a, 40.0);
    a.action(r#"{"type":"trip_turbine"}"#);
    run(&mut a, 30.0);

    let session = a.export_session();
    let parsed: Value = serde_json::from_str(&session).unwrap();
    assert_eq!(parsed["format"], "nol-session-v1");
    assert!(parsed["actions"].as_array().unwrap().len() >= 5);

    let mut b = Engine::new("baseline", 1.0).unwrap();
    let res: Value = serde_json::from_str(&b.load_session(&session)).unwrap();
    assert!(res["ok"].as_bool().unwrap(), "replay failed: {res}");
    b.set_running(true); // match the original clock-state fields in the snapshot

    assert_eq!(
        a.snapshot(),
        b.snapshot(),
        "replay diverged from the original run"
    );
}

#[test]
fn replay_rejects_a_non_session_file() {
    let mut e = Engine::new("baseline", 1.0).unwrap();
    let r: Value = serde_json::from_str(&e.load_session(r#"{"hello":"world"}"#)).unwrap();
    assert!(!r["ok"].as_bool().unwrap());
}

#[test]
fn clearing_manual_injections_removes_hmi_and_signal_faults() {
    let mut e = Engine::new("baseline", 3.0).unwrap();
    e.set_debug(true);
    e.action(
        r#"{"type":"inject","time":0,"target":"hmi.neutron_power","action":"set","value":50}"#,
    );
    e.action(r#"{"type":"inject","time":0,"target":"signal.t_avg","action":"bias","value":8}"#);
    run(&mut e, 10.0);
    let s1 = snap(&e);
    assert!(s1["hmi_faulted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "neutron_power"));
    assert!(s1["signal_faulted"]
        .as_array()
        .unwrap()
        .iter()
        .any(|x| x == "t_avg"));

    e.action(r#"{"type":"clear_injections"}"#);
    run(&mut e, 5.0);
    let s2 = snap(&e);
    assert!(s2["hmi_faulted"].as_array().unwrap().is_empty());
    assert!(s2["signal_faulted"].as_array().unwrap().is_empty());
    assert!((s2["hmi"]["neutron_power"].as_f64().unwrap() - 100.0).abs() < 5.0);
}
