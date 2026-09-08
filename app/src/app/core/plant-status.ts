import type { Snapshot } from '../sim/sim.types';

export type PlantLevel = 'normal' | 'watch' | 'abnormal' | 'emergency';

export interface PlantStatus {
  level: PlantLevel;
  headline: string;
  detail: string;
  /** Plain-language next step, shown in beginner mode. */
  advice: string;
}

/**
 * A plain-language summary of what the plant is doing, derived from the HMI
 * snapshot. Written for someone who has never seen a reactor before.
 */
export function plantStatus(s: Snapshot | null): PlantStatus {
  if (!s) {
    return { level: 'watch', headline: 'Starting up', detail: 'Loading the simulation.', advice: 'Wait a moment.' };
  }
  const h = (k: string) => s.hmi[k] ?? 0;
  const c = s.controllers;
  const e = s.electrical;
  const power = h('neutron_power');
  const sgMin = Math.min(h('sg1_level'), h('sg2_level'));
  const press = h('primary_pressure');
  const tavg = h('t_avg');
  const highPrio = s.alarms.filter((a) => a.active && a.priority === 1).length;

  // Emergency conditions first.
  if (!e.essential_bus_energized) {
    return {
      level: 'emergency',
      headline: 'No electrical power to safety equipment',
      detail: 'The essential bus is dead. Safety pumps and instruments run on the battery only.',
      advice: 'Check the Electrical page. An emergency diesel generator should start automatically.',
    };
  }
  if (c.reactor_trip_latched && sgMin < 22) {
    return {
      level: 'emergency',
      headline: 'Losing the way to remove heat',
      detail: 'The reactor is shut down but the steam generators are nearly empty, so decay heat has nowhere to go.',
      advice: 'Get water into a steam generator: check feedwater and auxiliary feedwater on the Secondary page.',
    };
  }
  if (press < 12.5 || press > 16.8) {
    return {
      level: 'emergency',
      headline: 'Reactor pressure is far outside normal',
      detail: `Primary pressure is ${press.toFixed(1)} MPa (normal is about 15.5).`,
      advice: 'Check the Primary page. Look at the pressurizer heaters, spray and relief valve.',
    };
  }

  if (c.reactor_trip_latched) {
    return {
      level: 'abnormal',
      headline: 'Reactor is shut down (tripped)',
      detail:
        'The control rods dropped in and fission has stopped. The fuel still makes decay heat, ' +
        'so cooling must continue.',
      advice: 'Make sure a steam generator has water and a heat sink. Then work out why it tripped in the Event Log.',
    };
  }
  if (c.turbine_trip_latched) {
    return {
      level: 'abnormal',
      headline: 'Turbine is tripped',
      detail: 'The turbine stopped taking steam. The reactor usually trips straight after this.',
      advice: 'Expect a reactor trip. Watch steam pressure and the steam dump on the Secondary page.',
    };
  }
  if (highPrio > 0) {
    return {
      level: 'abnormal',
      headline: 'A high-priority alarm is active',
      detail: `${highPrio} high-priority alarm(s). Something is outside its safe band.`,
      advice: 'Open the Alarm console, read the message, then go to that system’s page.',
    };
  }
  if (sgMin < 35 || press < 14.5 || press > 16.2 || tavg > 322 || power > 105) {
    return {
      level: 'watch',
      headline: 'A parameter is drifting',
      detail: 'One value is heading toward a limit but no alarm yet.',
      advice: 'Find the drifting value on the pages and decide whether to act now.',
    };
  }
  if (s.hmi_faulted.length || s.signal_faulted.length) {
    return {
      level: 'watch',
      headline: 'An instrument may be lying',
      detail: 'A displayed value has been flagged as possibly wrong.',
      advice: 'Do not trust the flagged gauge. Cross-check it against other indications.',
    };
  }

  return {
    level: 'normal',
    headline: `Running normally at ${power.toFixed(0)}% power`,
    detail: 'All systems are in their normal bands. The plant is making electricity.',
    advice: 'Watch the trends. Use the Scenario page to start a training exercise.',
  };
}
