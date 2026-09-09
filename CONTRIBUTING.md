# Contributing

Thanks for your interest. This is an educational project; contributions that
make it a better *teaching* tool are very welcome.

## Ground rules

1. **Educational only.** Do not add anything that pushes the project toward
   real-plant fidelity in a way that invites misuse. Keep all setpoints,
   coefficients and configurations fictional and clearly labelled as such.
2. **No proprietary or plant-specific material.** Do not contribute real
   operating procedures, real plant parameters, access details, or copyrighted
   training content. Explanations must be written from public-domain / general
   engineering knowledge.
3. **Keep the layers clean.** Physical process, instrumentation, control, HMI -
   don't shortcut between them. Faults are scenario events, not component code.
4. **Determinism is non-negotiable.** `cd engine && cargo test` must stay
   green, including the determinism and pause/single-step tests.

## Before opening a PR

```bash
cd engine && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cd ../app  && npm run build:wasm && npm test -- --no-watch && npm run build && npx playwright test
```

## Good first contributions

- New scenarios (`scenarios/*.json` + an entry in `engine/tests/scenarios.rs`).
- New educational-mode topics (`app/src/app/views/learn.component.ts`).
- Additional qualitative physics-validation tests.
- Accessibility and responsive-layout improvements.
- A better plant mimic on the Overview screen.

## Bigger pieces (discuss first in an issue)

- A two-region pressuriser model.
- A multi-compartment containment, or a proper break blowdown model.
- RWST inventory and recirculation switchover for safety injection.
- The instrumentation → signal-processing → controller → network → HMI fault
  chain described in `docs/INSTRUMENTATION.md`.

## Style

- Rust: `rustfmt` defaults, `clippy` clean, doc-comment every non-obvious
  constant with *why* that value.
- TypeScript: strict mode, standalone components, signals, `OnPush`. Prettier
  defaults.
- Commit in logical milestones with clear messages.

By contributing you agree your work is licensed under the project's MIT
license.
