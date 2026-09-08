import { describe, it, expect } from 'vitest';
import { TrendsService } from './trends.service';
import type { Snapshot } from '../sim/sim.types';

function snap(t: number, power: number): Snapshot {
  return {
    sim_time: t,
    tick: t * 50,
    running: true,
    speed: 1,
    scenario_id: 'baseline',
    scenario_name: 'baseline',
    hmi: { neutron_power: power, t_avg: 305, primary_pressure: 15.5 },
    controllers: {} as Snapshot['controllers'],
    electrical: {} as Snapshot['electrical'],
    csf: [],
    alarms: [],
    alarm_unacked: 0,
    alarm_history: [],
    event_log: [],
    physical: null,
    channels: null,
  };
}

describe('TrendsService', () => {
  it('ingests samples and returns a time-windowed slice', () => {
    const s = new TrendsService();
    for (let t = 0; t <= 100; t++) s.ingest(snap(t, 100 - t));
    const all = s.window(['neutron_power'], 0);
    expect(all.t.length).toBe(101);
    const last10 = s.window(['neutron_power'], 10);
    expect(last10.t[0]).toBeGreaterThanOrEqual(90);
    expect(last10.values.get('neutron_power')!.at(-1)).toBeCloseTo(0);
  });

  it('ignores duplicate timestamps (paused clock)', () => {
    const s = new TrendsService();
    s.ingest(snap(5, 100));
    s.ingest(snap(5, 100));
    s.ingest(snap(5, 100));
    expect(s.window(['neutron_power'], 0).t.length).toBe(1);
  });

  it('clears history on scenario change', () => {
    const s = new TrendsService();
    for (let t = 0; t < 20; t++) s.ingest(snap(t, 100));
    s.clear();
    expect(s.window(['neutron_power'], 0).t.length).toBe(0);
  });

  it('stays bounded and keeps the newest sample after decimation', () => {
    const s = new TrendsService();
    for (let t = 0; t < 40000; t++) s.ingest(snap(t, t));
    const w = s.window(['neutron_power'], 0);
    expect(w.t.length).toBeLessThanOrEqual(18000);
    expect(w.t.at(-1)).toBe(39999);
  });
});
