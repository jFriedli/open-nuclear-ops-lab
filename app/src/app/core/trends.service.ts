import { Injectable, signal } from '@angular/core';
import type { Snapshot } from '../sim/sim.types';

export interface TrendVar {
  key: string;
  label: string;
  units: string;
  color: string;
  group: string;
}

/** Variables available for trending. Values are pulled from the HMI layer. */
export const TREND_VARS: TrendVar[] = [
  { key: 'neutron_power', label: 'Neutron power', units: '%', color: '#e6b800', group: 'Reactor' },
  { key: 'thermal_power', label: 'Thermal power', units: 'MW', color: '#e67300', group: 'Reactor' },
  { key: 'reactivity_pcm', label: 'Reactivity', units: 'pcm', color: '#b088ff', group: 'Reactor' },
  { key: 'rod_pos', label: 'Rod position', units: '%', color: '#66d9c0', group: 'Reactor' },
  { key: 'xenon', label: 'Xenon', units: '%', color: '#8f8', group: 'Reactor' },
  { key: 't_fuel', label: 'Fuel temperature', units: '°C', color: '#ff5c5c', group: 'Temperatures' },
  { key: 't_avg', label: 'Coolant T-avg', units: '°C', color: '#ff9e5c', group: 'Temperatures' },
  { key: 't_hot', label: 'Hot leg', units: '°C', color: '#ff7a7a', group: 'Temperatures' },
  { key: 't_cold', label: 'Cold leg', units: '°C', color: '#7ab8ff', group: 'Temperatures' },
  { key: 'primary_pressure', label: 'Primary pressure', units: 'MPa', color: '#5ce1ff', group: 'Primary' },
  { key: 'primary_flow', label: 'Primary flow', units: '%', color: '#5cffd8', group: 'Primary' },
  { key: 'pzr_level', label: 'Pressurizer level', units: '%', color: '#c0a0ff', group: 'Primary' },
  { key: 'sg1_level', label: 'SG-1 level', units: '%', color: '#7fdbff', group: 'Secondary' },
  { key: 'sg2_level', label: 'SG-2 level', units: '%', color: '#4fa3d1', group: 'Secondary' },
  { key: 'sg1_pressure', label: 'SG-1 steam pressure', units: 'MPa', color: '#9ad', group: 'Secondary' },
  { key: 'sg1_steam_flow', label: 'SG-1 steam flow', units: '%', color: '#adf', group: 'Secondary' },
  { key: 'sg1_fw_flow', label: 'SG-1 feed flow', units: '%', color: '#7d7', group: 'Secondary' },
  { key: 'turbine_speed', label: 'Turbine speed', units: '%', color: '#ffd24d', group: 'Turbine' },
  { key: 'generator_mw', label: 'Generator output', units: 'MW', color: '#ffe98a', group: 'Turbine' },
  { key: 'condenser_pressure', label: 'Condenser backpressure', units: 'kPa', color: '#d29a9a', group: 'Turbine' },
  { key: 'battery_charge', label: 'Station battery', units: '%', color: '#9affb0', group: 'Electrical' },
  { key: 'boron_ppm', label: 'Coolant boron', units: 'ppm', color: '#b0c4de', group: 'Safeguards' },
  { key: 'cnmt_pressure', label: 'Containment pressure', units: 'kPa', color: '#ff8fa3', group: 'Safeguards' },
  { key: 'cnmt_temp', label: 'Containment temperature', units: '°C', color: '#ffb38f', group: 'Safeguards' },
  { key: 'cnmt_sump', label: 'Containment sump level', units: '%', color: '#8fb3ff', group: 'Safeguards' },
];

const MAX_POINTS = 18000;

@Injectable({ providedIn: 'root' })
export class TrendsService {
  /** Column-oriented ring buffer: time[] plus one array per tracked key. */
  private time: number[] = [];
  private series = new Map<string, number[]>();
  private lastT = -1;

  /** Bumped on every ingest so chart components can react via effect(). */
  readonly revision = signal(0);

  constructor() {
    for (const v of TREND_VARS) this.series.set(v.key, []);
  }

  ingest(s: Snapshot): void {
    // De-dupe if the sim clock has not advanced (paused).
    if (s.sim_time === this.lastT) return;
    this.lastT = s.sim_time;
    this.time.push(s.sim_time);
    for (const v of TREND_VARS) {
      this.series.get(v.key)!.push(s.hmi[v.key] ?? NaN);
    }
    if (this.time.length > MAX_POINTS) {
      // Decimate the oldest half to keep full-scenario history at lower res.
      this.decimateOldest();
    }
    this.revision.update((n) => n + 1);
  }

  private decimateOldest(): void {
    const half = Math.floor(this.time.length / 2);
    const keep = (arr: number[]) => {
      const head: number[] = [];
      for (let i = 0; i < half; i += 2) head.push(arr[i]);
      return head.concat(arr.slice(half));
    };
    this.time = keep(this.time);
    for (const [k, arr] of this.series) this.series.set(k, keep(arr));
  }

  clear(): void {
    this.time = [];
    this.lastT = -1;
    for (const v of TREND_VARS) this.series.set(v.key, []);
    this.revision.update((n) => n + 1);
  }

  /** Returns {t, values} sliced to the last `windowSec` seconds (0 = all). */
  window(keys: string[], windowSec: number): { t: number[]; values: Map<string, number[]> } {
    const n = this.time.length;
    let start = 0;
    if (windowSec > 0 && n > 0) {
      const cutoff = this.time[n - 1] - windowSec;
      start = this.time.findIndex((x) => x >= cutoff);
      if (start < 0) start = n;
    }
    const t = this.time.slice(start);
    const values = new Map<string, number[]>();
    for (const k of keys) values.set(k, (this.series.get(k) ?? []).slice(start));
    return { t, values };
  }
}
