import { describe, it, expect } from 'vitest';
import { coach } from './coach';
import type { Snapshot } from '../sim/sim.types';

type Patch = {
  [K in keyof Snapshot]?: Snapshot[K] extends object ? Partial<Snapshot[K]> : Snapshot[K];
};

/** A healthy full-power snapshot; pass a patch to bend it into a scenario. */
function snap(patch: Patch = {}): Snapshot {
  const base: Snapshot = {
    sim_time: 120,
    tick: 6000,
    running: true,
    speed: 1,
    scenario_id: 'baseline',
    scenario_name: 'baseline',
    hmi: {
      neutron_power: 100,
      primary_pressure: 15.5,
      pzr_level: 55,
      t_avg: 305,
      sg1_level: 65,
      sg2_level: 65,
    },
    hmi_faulted: [],
    signal_faulted: [],
    hmi_truth: null,
    controllers: {
      mode_rod_auto: true,
      mode_pzr_auto: true,
      mode_fw_auto: true,
      mode_turbine_auto: true,
      mode_cvcs_auto: true,
      rod_error: 0,
      pzr_press_error: 0,
      fw_error: [0, 0],
      target_power: 100,
      reactor_trip_latched: false,
      turbine_trip_latched: false,
      si_latched: false,
      cnmt_isolation_latched: false,
      cnmt_spray_latched: false,
      reactor_trip_blocked: false,
      turbine_trip_blocked: false,
      trip_age_s: 0,
    },
    electrical: {
      offsite_power: true,
      grid_available: true,
      generator_online: true,
      generator_mw: 330,
      essential_bus_energized: true,
      edg_a_running: false,
      edg_b_running: false,
      edg_a_available: true,
      edg_b_available: true,
      battery_charge: 100,
      rcp_powered: true,
    },
    equipment: {
      rcp: [true, true, true, true],
      rcp_running: 4,
      mfw_pump: [true, true],
      afw_on: false,
    },
    safety: {
      si_active: false,
      si_flow_pct: 0,
      accumulator_pct: 100,
      charging_pct: 30,
      letdown_pct: 30,
      boron_ppm: 900,
      boron_pcm: 0,
      primary_leak_pct: 0,
      sgtr_leak_pct: 0,
      sg_ruptured: [false, false],
      cnmt_pressure: 0,
      cnmt_temp: 30,
      cnmt_sump: 0,
      cnmt_isolated: false,
      cnmt_spray: false,
    },
    csf: [],
    alarms: [],
    alarm_unacked: 0,
    alarm_history: [],
    event_log: [],
    physical: null,
    channels: null,
  };
  return {
    ...base,
    ...(patch as Partial<Snapshot>),
    hmi: { ...base.hmi, ...(patch.hmi ?? {}) } as Record<string, number>,
    controllers: { ...base.controllers, ...(patch.controllers ?? {}) },
    electrical: { ...base.electrical, ...(patch.electrical ?? {}) },
    safety: { ...base.safety, ...(patch.safety ?? {}) },
  };
}

describe('coach', () => {
  it('reports a healthy plant at power', () => {
    const r = coach(snap());
    expect(r.level).toBe('normal');
    expect(r.headline).toMatch(/Running normally/);
  });

  it('walks a first-timer through starting the clock', () => {
    const r = coach(snap({ running: false, sim_time: 0 }));
    expect(r.phase).toBe('Getting started');
    expect(r.steps.some((st) => /RUN/.test(st.text))).toBe(true);
  });

  it('gives a post-trip checklist with live done-state', () => {
    const r = coach(
      snap({ controllers: { reactor_trip_latched: true }, hmi: { neutron_power: 2 } }),
    );
    expect(r.level).toBe('abnormal');
    expect(r.phase).toBe('Reactor tripped');
    const collapsed = r.steps.find((st) => /collapsed/.test(st.text));
    expect(collapsed?.done).toBe(true);
  });

  it('escalates a loss of coolant', () => {
    const r = coach(snap({ safety: { si_active: true }, controllers: { si_latched: true } }));
    expect(r.level).toBe('emergency');
    expect(r.phase).toBe('Loss of coolant');
  });

  it('flags a defeated automatic trip and tells the operator to trip by hand', () => {
    const r = coach(
      snap({ controllers: { reactor_trip_blocked: true }, hmi: { neutron_power: 118 } }),
    );
    expect(r.level).toBe('emergency');
    expect(r.phase).toBe('Reactor not shut down');
    expect(r.steps.some((st) => /MANUAL REACTOR TRIP/.test(st.text))).toBe(true);
  });

  it('flags an ATWS (trip latched, rods stuck, power up)', () => {
    const r = coach(
      snap({
        controllers: { reactor_trip_latched: true, trip_age_s: 20 },
        hmi: { neutron_power: 80 },
      }),
    );
    expect(r.phase).toBe('Reactor not shut down');
  });

  it('names the ruptured steam generator', () => {
    const r = coach(snap({ safety: { sg_ruptured: [false, true] } }));
    expect(r.level).toBe('emergency');
    expect(r.phase).toBe('Tube rupture');
    expect(r.headline).toMatch(/SG-2/);
  });

  it('treats many frozen displays as a manipulation, not a fault', () => {
    const r = coach(snap({ hmi_faulted: ['primary_pressure', 'pzr_level', 'sg1_level', 't_avg'] }));
    expect(r.phase).toBe('Loss of view');
    expect(r.steps.some((st) => /protection.*true measurements/i.test(st.text))).toBe(true);
  });

  it('handles a single suspect gauge more gently', () => {
    const r = coach(snap({ hmi_faulted: ['primary_pressure'] }));
    expect(r.level).toBe('watch');
    expect(r.phase).toBe('Suspect indication');
  });
});
