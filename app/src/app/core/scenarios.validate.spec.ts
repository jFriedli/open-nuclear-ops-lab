import { describe, it, expect } from 'vitest';
import { validateScenario } from './scenarios.service';

describe('validateScenario (untrusted import validation)', () => {
  it('accepts a well-formed scenario', () => {
    const r = validateScenario(
      JSON.stringify({
        id: 'x',
        name: 'X',
        initial: 'hot_full_power',
        events: [{ time: 10, target: 'rcp.0', action: 'trip' }],
      }),
    );
    expect(r.ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    expect(validateScenario('{not json').ok).toBe(false);
  });

  it('rejects a missing id', () => {
    const r = validateScenario(JSON.stringify({ name: 'X', events: [] }));
    expect(r).toEqual({ ok: false, error: 'Missing "id".' });
  });

  it('rejects an unknown action verb', () => {
    const r = validateScenario(
      JSON.stringify({ id: 'x', name: 'X', events: [{ time: 1, target: 'rcp.0', action: 'explode' }] }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range event time', () => {
    const r = validateScenario(
      JSON.stringify({ id: 'x', name: 'X', events: [{ time: -5, target: 'rcp.0', action: 'trip' }] }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a target with shell-ish characters', () => {
    const r = validateScenario(
      JSON.stringify({ id: 'x', name: 'X', events: [{ time: 1, target: 'rcp.0; rm -rf', action: 'trip' }] }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects a non-finite value', () => {
    const r = validateScenario(
      '{"id":"x","name":"X","events":[{"time":1,"target":"physical.rho_external","action":"ramp","value":1e999}]}',
    );
    expect(r.ok).toBe(false);
  });

  it('caps the number of events', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({ time: i, target: 'rcp.0', action: 'trip' }));
    expect(validateScenario(JSON.stringify({ id: 'x', name: 'X', events })).ok).toBe(false);
  });
});
