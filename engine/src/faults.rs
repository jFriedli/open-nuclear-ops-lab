//! A small shared fault primitive used by the layers *above* the raw sensor
//! channel: signal processing (`signal.*`) and the HMI (`hmi.*`).
//!
//! Channel-level faults live in `instrumentation.rs`; these operate on an
//! already-voted engineering value.

use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub enum LayerFaultKind {
    /// Freeze at a value (NaN sentinel = latch the value seen when applied).
    Stuck,
    /// Add a constant.
    Bias,
    /// Multiply by a factor.
    Scale,
    /// Force a fixed value.
    Set,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct LayerFault {
    pub kind: LayerFaultKind,
    pub value: f64,
    /// Latched value for `Stuck` faults applied with the NaN sentinel.
    latched: Option<f64>,
}

impl LayerFault {
    pub fn new(kind: LayerFaultKind, value: f64) -> Self {
        LayerFault {
            kind,
            value,
            latched: None,
        }
    }

    /// Apply to `input`; `input` is also the value latched on first use of a
    /// sentinel `Stuck` fault.
    pub fn apply(&mut self, input: f64) -> f64 {
        match self.kind {
            LayerFaultKind::Stuck => {
                if self.value.is_nan() {
                    *self.latched.get_or_insert(input)
                } else {
                    self.value
                }
            }
            LayerFaultKind::Bias => input + self.value,
            LayerFaultKind::Scale => input * self.value,
            LayerFaultKind::Set => self.value,
        }
    }

    /// Non-mutating apply. A sentinel (NaN) `Stuck` fault that was never
    /// latched falls back to passing the input through.
    pub fn apply_ref(&self, input: f64) -> f64 {
        match self.kind {
            LayerFaultKind::Stuck => {
                if self.value.is_nan() {
                    self.latched.unwrap_or(input)
                } else {
                    self.value
                }
            }
            LayerFaultKind::Bias => input + self.value,
            LayerFaultKind::Scale => input * self.value,
            LayerFaultKind::Set => self.value,
        }
    }

    pub fn parse_kind(action: &str) -> Option<LayerFaultKind> {
        Some(match action {
            "stuck" | "freeze" => LayerFaultKind::Stuck,
            "bias" | "offset" => LayerFaultKind::Bias,
            "scale" | "gain" => LayerFaultKind::Scale,
            "set" | "spoof" => LayerFaultKind::Set,
            _ => return None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stuck_latches_once() {
        let mut f = LayerFault::new(LayerFaultKind::Stuck, f64::NAN);
        assert_eq!(f.apply(10.0), 10.0);
        assert_eq!(f.apply(20.0), 10.0);
        assert_eq!(f.apply(99.0), 10.0);
    }

    #[test]
    fn bias_scale_set() {
        let mut b = LayerFault::new(LayerFaultKind::Bias, 5.0);
        assert_eq!(b.apply(10.0), 15.0);
        let mut s = LayerFault::new(LayerFaultKind::Scale, 1.1);
        assert!((s.apply(100.0) - 110.0).abs() < 1e-9);
        let mut v = LayerFault::new(LayerFaultKind::Set, 42.0);
        assert_eq!(v.apply(0.0), 42.0);
    }
}
