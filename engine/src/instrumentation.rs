//! Layer 2: INSTRUMENTATION.
//!
//! Converts true physical values into *measured* signals. Every channel can be
//! healthy or faulted (noise / bias / drift / stuck / failed). Redundant
//! channels A/B/C are provided for the safety-significant signals so that
//! channel disagreement can be modelled and, later, cyber-physical
//! discrepancies injected here without touching the physical layer.

use crate::physics::PhysicalState;
use crate::rng::Rng;
use serde::Serialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Default, Serialize)]
pub struct ChannelFault {
    pub noise_sd: f64,
    pub bias: f64,
    /// Drift rate in engineering units per second (accumulates).
    pub drift_rate: f64,
    pub drift_accum: f64,
    /// If set, the channel output is frozen at this value.
    pub stuck_value: Option<f64>,
    /// Hard failure: reads a fixed downscale/upscale value.
    pub failed: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Channel {
    pub id: String,
    /// Raw physical quantity key this channel measures.
    pub source: String,
    pub value: f64,
    pub healthy: bool,
    pub fault: ChannelFault,
    base_noise: f64,
}

impl Channel {
    fn new(id: &str, source: &str, base_noise: f64) -> Self {
        Channel {
            id: id.to_string(),
            source: source.to_string(),
            value: 0.0,
            healthy: true,
            fault: ChannelFault::default(),
            base_noise,
        }
    }

    fn update(&mut self, truth: f64, rng: &mut Rng) {
        if let Some(f) = self.fault.failed {
            self.value = f;
            self.healthy = false;
            return;
        }
        if let Some(s) = self.fault.stuck_value {
            self.value = s;
            self.healthy = false;
            return;
        }
        self.fault.drift_accum += self.fault.drift_rate * crate::physics::DT;
        let noise = (self.base_noise + self.fault.noise_sd) * rng.normal();
        self.value = truth + self.fault.bias + self.fault.drift_accum + noise;
        self.healthy = self.fault.bias.abs() < 1e-9
            && self.fault.drift_rate.abs() < 1e-12
            && self.fault.noise_sd.abs() < 1e-9;
    }
}

/// A measured signal, possibly backed by several redundant channels.
#[derive(Clone, Debug, Serialize)]
pub struct MeasuredSignal {
    pub key: String,
    pub channels: Vec<Channel>,
    /// Voted / selected value presented downstream (median of healthy-ish).
    pub value: f64,
    /// Max pairwise deviation between channels (for disagreement alarms).
    pub max_deviation: f64,
    pub units: String,
}

impl MeasuredSignal {
    fn vote(&mut self) {
        let mut vals: Vec<f64> = self.channels.iter().map(|c| c.value).collect();
        vals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let n = vals.len();
        self.value = if n == 0 {
            0.0
        } else if n % 2 == 1 {
            vals[n / 2]
        } else {
            0.5 * (vals[n / 2 - 1] + vals[n / 2])
        };
        let mut maxdev = 0.0f64;
        for i in 0..n {
            for j in (i + 1)..n {
                maxdev = maxdev.max((vals[i] - vals[j]).abs());
            }
        }
        self.max_deviation = maxdev;
    }
}

pub struct Instrumentation {
    pub signals: Vec<MeasuredSignal>,
    index: HashMap<String, usize>,
    rng: Rng,
}

fn truth(state: &PhysicalState, source: &str) -> f64 {
    match source {
        "neutron_power" => state.neutron_power * 100.0, // % power
        "thermal_power" => state.thermal_power_mw(),
        "reactivity_pcm" => state.reactivity * 1e5,
        "rod_pos" => state.rod_pos * 100.0,
        "t_fuel" => state.t_fuel,
        "t_avg" => state.t_mod,
        "t_hot" => state.t_hot,
        "t_cold" => state.t_cold,
        "primary_pressure" => state.primary_pressure,
        "primary_flow" => state.primary_flow * 100.0,
        "pzr_level" => state.pzr_level,
        "sg1_level" => state.sg[0].level_pct,
        "sg2_level" => state.sg[1].level_pct,
        "sg1_pressure" => state.sg[0].pressure,
        "sg2_pressure" => state.sg[1].pressure,
        "sg1_steam_flow" => state.sg[0].steam_flow * 100.0,
        "sg2_steam_flow" => state.sg[1].steam_flow * 100.0,
        "sg1_fw_flow" => state.sg[0].fw_flow * 100.0,
        "sg2_fw_flow" => state.sg[1].fw_flow * 100.0,
        "turbine_speed" => state.turbine_speed * 100.0,
        "generator_mw" => state.generator_mw,
        "condenser_pressure" => state.condenser_pressure,
        "battery_charge" => state.battery_charge,
        "xenon" => state.xenon * 100.0,
        _ => 0.0,
    }
}

impl Instrumentation {
    pub fn new(seed: u64) -> Self {
        let mut signals: Vec<MeasuredSignal> = Vec::new();

        // (key, source, units, [channel ids], base_noise)
        let redundant: &[(&str, &str, &str, f64)] = &[
            ("neutron_power", "neutron_power", "%", 0.15),
            ("primary_pressure", "primary_pressure", "MPa", 0.01),
            ("pzr_level", "pzr_level", "%", 0.3),
            ("t_avg", "t_avg", "degC", 0.2),
            ("sg1_level", "sg1_level", "%", 0.4),
            ("sg2_level", "sg2_level", "%", 0.4),
            ("rod_pos", "rod_pos", "%", 0.1),
        ];
        for (key, src, units, noise) in redundant {
            let channels = ["A", "B", "C"]
                .iter()
                .map(|ch| Channel::new(&format!("{key}.{ch}"), src, *noise))
                .collect();
            signals.push(MeasuredSignal {
                key: key.to_string(),
                channels,
                value: 0.0,
                max_deviation: 0.0,
                units: units.to_string(),
            });
        }

        let single: &[(&str, &str, &str, f64)] = &[
            ("thermal_power", "thermal_power", "MW", 3.0),
            ("reactivity_pcm", "reactivity_pcm", "pcm", 2.0),
            ("t_fuel", "t_fuel", "degC", 1.0),
            ("t_hot", "t_hot", "degC", 0.3),
            ("t_cold", "t_cold", "degC", 0.3),
            ("primary_flow", "primary_flow", "%", 0.5),
            ("sg1_pressure", "sg1_pressure", "MPa", 0.02),
            ("sg2_pressure", "sg2_pressure", "MPa", 0.02),
            ("sg1_steam_flow", "sg1_steam_flow", "%", 0.6),
            ("sg2_steam_flow", "sg2_steam_flow", "%", 0.6),
            ("sg1_fw_flow", "sg1_fw_flow", "%", 0.6),
            ("sg2_fw_flow", "sg2_fw_flow", "%", 0.6),
            ("turbine_speed", "turbine_speed", "%", 0.1),
            ("generator_mw", "generator_mw", "MW", 1.0),
            ("condenser_pressure", "condenser_pressure", "kPa", 0.2),
            ("battery_charge", "battery_charge", "%", 0.2),
            ("xenon", "xenon", "%", 0.5),
        ];
        for (key, src, units, noise) in single {
            signals.push(MeasuredSignal {
                key: key.to_string(),
                channels: vec![Channel::new(&format!("{key}.X"), src, *noise)],
                value: 0.0,
                max_deviation: 0.0,
                units: units.to_string(),
            });
        }

        let mut index = HashMap::new();
        for (i, s) in signals.iter().enumerate() {
            index.insert(s.key.clone(), i);
        }

        Instrumentation {
            signals,
            index,
            rng: Rng::new(seed ^ 0xDEAD_BEEF),
        }
    }

    pub fn update(&mut self, state: &PhysicalState) {
        for sig in &mut self.signals {
            for ch in &mut sig.channels {
                let t = truth(state, &ch.source);
                ch.update(t, &mut self.rng);
            }
            sig.vote();
        }
    }

    pub fn get(&self, key: &str) -> f64 {
        self.index
            .get(key)
            .map(|&i| self.signals[i].value)
            .unwrap_or(0.0)
    }

    pub fn deviation(&self, key: &str) -> f64 {
        self.index
            .get(key)
            .map(|&i| self.signals[i].max_deviation)
            .unwrap_or(0.0)
    }

    /// Apply a channel fault from a scenario / operator event.
    /// `target` is `signal_key.channel` (e.g. `sg1_level.B`) or `signal_key`
    /// (applies to the first channel).
    pub fn apply_fault(&mut self, target: &str, kind: &str, value: f64, current_truth: f64) {
        let (key, chsel) = match target.split_once('.') {
            Some((k, c)) => (k, Some(c)),
            None => (target, None),
        };
        let Some(&idx) = self.index.get(key) else {
            return;
        };
        let sig = &mut self.signals[idx];
        for ch in &mut sig.channels {
            let matches = match chsel {
                Some(c) => ch.id.ends_with(&format!(".{c}")),
                None => true,
            };
            if !matches {
                continue;
            }
            match kind {
                "noise" => ch.fault.noise_sd = value,
                "bias" => ch.fault.bias = value,
                "drift" => ch.fault.drift_rate = value,
                "stuck" => {
                    if value.is_nan() {
                        // Latch to the present indicated value exactly once.
                        if ch.fault.stuck_value.is_none() {
                            ch.fault.stuck_value = Some(current_truth);
                        }
                    } else {
                        ch.fault.stuck_value = Some(value);
                    }
                }
                "fail_low" => ch.fault.failed = Some(if value == 0.0 { -1.0e3 } else { value }),
                "fail_high" => ch.fault.failed = Some(if value == 0.0 { 1.0e6 } else { value }),
                "fail" => ch.fault.failed = Some(value),
                "clear" => ch.fault = ChannelFault::default(),
                _ => {}
            }
            if chsel.is_none() {
                break;
            }
        }
    }

    pub fn source_truth(&self, state: &PhysicalState, key: &str) -> f64 {
        let src = self
            .index
            .get(key)
            .map(|&i| self.signals[i].channels[0].source.clone())
            .unwrap_or_default();
        truth(state, &src)
    }
}
