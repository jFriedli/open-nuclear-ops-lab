//! Deterministic, dependency-free PRNG (SplitMix64 + a normal-variate helper).
//!
//! We deliberately avoid `rand`/`getrandom` so the simulation is fully
//! deterministic and reproducible across platforms and WASM.

#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
    /// Cached second value from the Box-Muller transform.
    spare: Option<f64>,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        // Avoid the all-zero state.
        Rng {
            state: seed ^ 0x9E37_79B9_7F4A_7C15,
            spare: None,
        }
    }

    #[inline]
    fn next_u64(&mut self) -> u64 {
        // SplitMix64
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn uniform(&mut self) -> f64 {
        // 53-bit mantissa
        (self.next_u64() >> 11) as f64 * (1.0 / 9_007_199_254_740_992.0)
    }

    /// Standard normal variate (mean 0, sd 1) via Box-Muller.
    pub fn normal(&mut self) -> f64 {
        if let Some(v) = self.spare.take() {
            return v;
        }
        // Guard against log(0).
        let mut u1 = self.uniform();
        if u1 < 1e-12 {
            u1 = 1e-12;
        }
        let u2 = self.uniform();
        let mag = (-2.0 * u1.ln()).sqrt();
        let z0 = mag * (std::f64::consts::TAU * u2).cos();
        let z1 = mag * (std::f64::consts::TAU * u2).sin();
        self.spare = Some(z1);
        z0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn normal_is_roughly_standard() {
        let mut r = Rng::new(7);
        let n = 20_000;
        let mut sum = 0.0;
        let mut sq = 0.0;
        for _ in 0..n {
            let v = r.normal();
            sum += v;
            sq += v * v;
        }
        let mean = sum / n as f64;
        let var = sq / n as f64 - mean * mean;
        assert!(mean.abs() < 0.05, "mean was {mean}");
        assert!((var - 1.0).abs() < 0.1, "var was {var}");
    }
}
