// Shape of the JSON snapshot produced by the Rust engine (`snapshot.rs`).
// The engine is the single source of truth; this mirror is kept in sync by hand.

export type CsfStatus = 'Normal' | 'Degraded' | 'Challenged' | 'Unknown';

export interface Csf {
  name: string;
  status: CsfStatus;
  basis: string;
}

export interface ElectricalSummary {
  offsite_power: boolean;
  grid_available: boolean;
  generator_online: boolean;
  generator_mw: number;
  essential_bus_energized: boolean;
  edg_a_running: boolean;
  edg_b_running: boolean;
  edg_a_available: boolean;
  edg_b_available: boolean;
  battery_charge: number;
  rcp_powered: boolean;
}

export interface EquipmentStatus {
  rcp: [boolean, boolean, boolean, boolean];
  rcp_running: number;
  mfw_pump: [boolean, boolean];
  afw_on: boolean;
}

export interface SafetySystemsSummary {
  si_active: boolean;
  si_flow_pct: number;
  accumulator_pct: number;
  charging_pct: number;
  letdown_pct: number;
  boron_ppm: number;
  boron_pcm: number;
  primary_leak_pct: number;
  sgtr_leak_pct: number;
  sg_ruptured: [boolean, boolean];
  cnmt_pressure: number;
  cnmt_temp: number;
  cnmt_sump: number;
  cnmt_isolated: boolean;
  cnmt_spray: boolean;
}

export interface Alarm {
  id: string;
  priority: number;
  subsystem: string;
  message: string;
  active: boolean;
  acknowledged: boolean;
  raised_at: number;
  cleared_at: number | null;
  count: number;
}

export interface AlarmEvent {
  sim_time: number;
  id: string;
  transition: 'raised' | 'cleared' | 'ack';
  priority: number;
  subsystem: string;
  message: string;
}

export interface EventLogEntry {
  sim_time: number;
  category: 'operator' | 'auto' | 'alarm' | 'trip' | 'fault' | 'scenario' | 'info';
  message: string;
}

export interface ControllerState {
  mode_rod_auto: boolean;
  mode_pzr_auto: boolean;
  mode_fw_auto: boolean;
  mode_turbine_auto: boolean;
  mode_cvcs_auto: boolean;
  rod_error: number;
  pzr_press_error: number;
  fw_error: [number, number];
  target_power: number;
  reactor_trip_latched: boolean;
  turbine_trip_latched: boolean;
  si_latched: boolean;
  cnmt_isolation_latched: boolean;
  cnmt_spray_latched: boolean;
  reactor_trip_blocked: boolean;
  turbine_trip_blocked: boolean;
  trip_age_s: number;
}

export interface SteamGeneratorPhys {
  inventory: number;
  level_pct: number;
  pressure: number;
  steam_flow: number;
  fw_flow: number;
  heat_in: number;
}

export interface PhysicalState {
  neutron_power: number;
  reactivity: number;
  rho_rods: number;
  rho_fuel: number;
  rho_mod: number;
  rho_xenon: number;
  rho_boron: number;
  rho_external: number;
  rho_scram: number;
  rod_pos: number;
  iodine: number;
  xenon: number;
  decay_heat: number;
  t_fuel: number;
  t_mod: number;
  t_hot: number;
  t_cold: number;
  core_heat_mw: number;
  primary_pressure: number;
  primary_flow: number;
  rcp: [boolean, boolean, boolean, boolean];
  pzr_level: number;
  pzr_heater_frac: number;
  pzr_spray_frac: number;
  porv: number;
  sg: SteamGeneratorPhys[];
  mfw_pump: [boolean, boolean];
  afw_on: boolean;
  turbine_speed: number;
  throttle: number;
  mech_power: number;
  generator_mw: number;
  generator_online: boolean;
  load_demand: number;
  steam_dump: number;
  turbine_tripped: boolean;
  condenser_pressure: number;
  condenser_effectiveness: number;
  boron_ppm: number;
  charging: number;
  letdown: number;
  si_active: boolean;
  accumulator_frac: number;
  si_flow: number;
  primary_leak: number;
  sgtr_leak: [number, number];
  sg_ruptured: [boolean, boolean];
  cnmt_pressure: number;
  cnmt_temp: number;
  cnmt_sump: number;
  cnmt_spray: boolean;
  cnmt_isolated: boolean;
  reactor_tripped: boolean;
}

export interface Channel {
  id: string;
  source: string;
  value: number;
  healthy: boolean;
  fault: {
    noise_sd: number;
    bias: number;
    drift_rate: number;
    drift_accum: number;
    stuck_value: number | null;
    failed: number | null;
  };
}

export interface ChannelSignal {
  key: string;
  channels: Channel[];
  value: number;
  max_deviation: number;
  units: string;
}

export interface Snapshot {
  sim_time: number;
  tick: number;
  running: boolean;
  speed: number;
  scenario_id: string;
  scenario_name: string;
  hmi: Record<string, number>;
  /** Signals whose displayed value is altered by an HMI-layer fault. */
  hmi_faulted: string[];
  /** Signals altered by a signal-processing-layer fault (control also affected). */
  signal_faulted: string[];
  /** True un-faulted HMI values - only present in instructor/debug mode. */
  hmi_truth: Record<string, number> | null;
  controllers: ControllerState;
  electrical: ElectricalSummary;
  equipment: EquipmentStatus;
  safety: SafetySystemsSummary;
  csf: Csf[];
  alarms: Alarm[];
  alarm_unacked: number;
  alarm_history: AlarmEvent[];
  event_log: EventLogEntry[];
  physical: PhysicalState | null;
  channels: ChannelSignal[] | null;
}

/** Convenience accessor honouring `noPropertyAccessFromIndexSignature`. */
export function hv(s: Snapshot | null, key: string): number {
  return s ? (s.hmi[key] ?? 0) : 0;
}
