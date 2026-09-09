import type { Snapshot } from '../sim/sim.types';

export type CoachLevel = 'normal' | 'watch' | 'abnormal' | 'emergency';

export interface CoachStep {
  text: string;
  /** Route this step points at, e.g. 'alarms'. */
  page?: string;
  /**
   * Tri-state: `true` renders a green tick (already satisfied), `false` an open
   * circle (still to do), `undefined` a neutral bullet (just guidance).
   */
  done?: boolean;
}

export interface CoachReport {
  level: CoachLevel;
  /** Short phase label, e.g. "Loss of coolant". */
  phase: string;
  /** One plain-language line: what is happening. */
  headline: string;
  /** One line of context. May be empty. */
  detail: string;
  /** Ordered "what to do now" list. */
  steps: CoachStep[];
}

/**
 * The Learn-mode coach. Reads the live HMI snapshot and works out, in plain
 * language, what the plant is doing and what the operator should do next. It is
 * state-driven, so it works for any scenario or injected fault, not just the
 * scripted lessons. Written for someone who has never seen a reactor.
 *
 * This is a teaching aid, not a procedure.
 */
export function coach(s: Snapshot | null): CoachReport {
  if (!s) {
    return {
      level: 'watch',
      phase: 'Starting',
      headline: 'Loading the simulation',
      detail: '',
      steps: [],
    };
  }

  const h = (k: string) => s.hmi[k] ?? 0;
  const c = s.controllers;
  const e = s.electrical;
  const sf = s.safety;
  const power = h('neutron_power');
  const sgMin = Math.min(h('sg1_level'), h('sg2_level'));
  const press = h('primary_pressure');
  const tavg = h('t_avg');
  const highPrio = s.alarms.filter((a) => a.active && a.priority === 1).length;
  const anyFault = s.hmi_faulted.length > 0 || s.signal_faulted.length > 0;
  const tripped = c.reactor_trip_latched;

  // ---- Not started / paused --------------------------------------------------
  if (!s.running && s.sim_time < 1) {
    return {
      level: 'normal',
      phase: 'Getting started',
      headline: 'The plant is frozen — nothing is moving yet',
      detail: 'Plant time only advances while it is running.',
      steps: [
        { text: 'Press RUN (top bar) to start plant time', done: false },
        { text: 'Use the speed buttons to run faster, or STEP to nudge time while paused' },
        { text: 'Watch the plant diagram on the Overview page', page: 'overview' },
      ],
    };
  }

  // ---- Emergencies ---------------------------------------------------------
  // Automatic shutdown has failed or been defeated: the operator must act.
  const notShutdown = tripped && c.trip_age_s > 8 && power > 15;
  if (c.reactor_trip_blocked || notShutdown) {
    return {
      level: 'emergency',
      phase: 'Reactor not shut down',
      headline: 'The reactor has NOT shut down — trip it by hand now',
      detail: c.reactor_trip_blocked
        ? 'A trip was demanded and the automatic system did not act.'
        : 'The trip signal is in but the rods have not inserted.',
      steps: [
        {
          text: 'Press MANUAL REACTOR TRIP on the Reactor page',
          page: 'reactor',
          done: power < 15,
        },
        { text: 'Confirm neutron power collapses below 5%', done: power < 5 },
        { text: 'If power stays up, start emergency boration', page: 'containment' },
        { text: 'This is why safety functions need diverse, independent actuation' },
      ],
    };
  }

  if (sf.sg_ruptured[0] || sf.sg_ruptured[1]) {
    const which =
      sf.sg_ruptured[0] && sf.sg_ruptured[1] ? 'both SGs' : sf.sg_ruptured[0] ? 'SG-1' : 'SG-2';
    return {
      level: 'emergency',
      phase: 'Tube rupture',
      headline: `Reactor coolant is leaking into ${which} (tube rupture)`,
      detail: 'That steam generator is filling on its own and its steam is now contaminated.',
      steps: [
        {
          text: `Identify the affected generator: ${which} level and pressure rising`,
          page: 'secondary',
        },
        { text: 'Reactor tripped', done: tripped, page: 'reactor' },
        {
          text: 'Lower primary pressure toward the ruptured SG — that is what stops the leak',
          page: 'primary',
        },
        { text: 'Keep the ruptured SG isolated; do not dump its steam to atmosphere' },
      ],
    };
  }

  if (!e.essential_bus_energized) {
    return {
      level: 'emergency',
      phase: 'Blackout',
      headline: 'No electrical power to the safety equipment',
      detail: 'The essential bus is dead. Only the station battery is left.',
      steps: [
        { text: 'Open the Electrical page', page: 'electrical' },
        {
          text: 'An emergency diesel should start on its own',
          done: e.edg_a_running || e.edg_b_running,
        },
        { text: 'Essential bus re-energised', done: e.essential_bus_energized },
        { text: 'Watch the battery charge — it is the last line of defence' },
      ],
    };
  }

  const loca = sf.si_active || c.si_latched || sf.cnmt_pressure > 20;
  if (loca) {
    return {
      level: 'emergency',
      phase: 'Loss of coolant',
      headline: 'Coolant is being lost — safety injection has started',
      detail: 'Emergency pumps are replacing lost water and keeping the core covered.',
      steps: [
        { text: 'Reactor tripped', done: tripped, page: 'reactor' },
        { text: 'Safety injection flowing', done: sf.si_flow_pct > 0.01 || sf.si_active },
        { text: 'Containment isolated', done: sf.cnmt_isolated },
        { text: 'Watch containment pressure and sump level', page: 'containment' },
        { text: 'Acknowledge the alarms', page: 'alarms', done: s.alarm_unacked === 0 },
      ],
    };
  }

  if (tripped && sgMin < 22) {
    return {
      level: 'emergency',
      phase: 'Heat sink threatened',
      headline: 'The reactor is shut down but has almost nowhere to send its heat',
      detail: `Steam generator level is down to ${Math.round(sgMin)}%.`,
      steps: [
        { text: 'Open the Secondary page', page: 'secondary' },
        { text: 'Get water into a steam generator: main or auxiliary feedwater' },
        { text: 'Auxiliary feedwater running', done: s.equipment.afw_on },
        { text: 'Steam generator level recovering above 25%', done: sgMin > 25 },
      ],
    };
  }

  if (press < 12.5 || press > 16.8) {
    return {
      level: 'emergency',
      phase: 'Pressure abnormal',
      headline: `Reactor pressure is ${press.toFixed(1)} MPa — well outside normal (~15.5)`,
      detail: '',
      steps: [
        { text: 'Open the Primary page', page: 'primary' },
        press > 16.8
          ? { text: 'Too high: check the pressurizer spray and relief valve' }
          : { text: 'Too low: check the pressurizer heaters, and look for a leak' },
        { text: 'Pressure back between 14 and 16 MPa', done: press >= 14 && press <= 16 },
      ],
    };
  }

  // ---- Abnormal ----------------------------------------------------------
  if (tripped) {
    return {
      level: 'abnormal',
      phase: 'Reactor tripped',
      headline: 'The reactor is shut down (tripped)',
      detail: 'Fission has stopped. The fuel still makes decay heat, so cooling must continue.',
      steps: [
        { text: 'Fission power has collapsed (below 5%)', done: power < 5 },
        { text: 'A steam generator has water (above 30%)', done: sgMin > 30, page: 'secondary' },
        {
          text: 'Electrical bus is energised',
          done: e.essential_bus_energized,
          page: 'electrical',
        },
        { text: 'Acknowledge the alarms', done: s.alarm_unacked === 0, page: 'alarms' },
        { text: 'Work out what tripped it in the Event Log', page: 'eventlog' },
      ],
    };
  }

  if (c.turbine_trip_latched) {
    return {
      level: 'abnormal',
      phase: 'Turbine tripped',
      headline: 'The turbine has tripped',
      detail: 'It stopped taking steam. The reactor usually trips right after this.',
      steps: [
        { text: 'Expect a reactor trip within seconds' },
        { text: 'Watch steam pressure and the steam dump', page: 'secondary' },
      ],
    };
  }

  if (highPrio > 0) {
    return {
      level: 'abnormal',
      phase: 'Alarm',
      headline: `${highPrio} high-priority alarm${highPrio > 1 ? 's' : ''} active`,
      detail: 'Something is outside its safe band.',
      steps: [
        { text: 'Open the Alarm console and read the messages', page: 'alarms' },
        { text: 'Go to the page for that system and act on it' },
        { text: 'Acknowledge the alarms once read', done: s.alarm_unacked === 0 },
      ],
    };
  }

  // ---- Watch -----------------------------------------------------------
  const nFaults = s.hmi_faulted.length + s.signal_faulted.length;
  if (nFaults >= 3 && !tripped) {
    return {
      level: 'abnormal',
      phase: 'Loss of view',
      headline: 'Several displays are frozen or wrong at once',
      detail: 'This looks like a deliberate manipulation, not a random fault.',
      steps: [
        { text: 'Stop trusting the flagged gauges entirely' },
        { text: 'Work from the alarms, the safety strip and the values still live' },
        { text: 'Control, protection and alarms still run on the true measurements' },
        { text: 'Find the real process fault (check the Event Log)', page: 'eventlog' },
      ],
    };
  }
  if (anyFault && !tripped) {
    return {
      level: 'watch',
      phase: 'Suspect indication',
      headline: 'A gauge may be lying to you',
      detail: 'A displayed value is flagged as possibly wrong.',
      steps: [
        { text: 'Do not act on the flagged reading alone' },
        { text: 'Cross-check it against other indications and the safety strip' },
        {
          text: 'If a safety function goes amber while the gauge looks fine, believe the safety strip',
        },
      ],
    };
  }

  if (sgMin < 35 || press < 14.5 || press > 16.2 || tavg > 322 || power > 105) {
    return {
      level: 'watch',
      phase: 'Drifting',
      headline: 'A value is heading toward a limit',
      detail: 'No alarm yet, but worth a look.',
      steps: [
        { text: 'Find the drifting value on the system pages' },
        { text: 'Decide whether to act now or keep watching' },
      ],
    };
  }

  const target = c.target_power ?? 100;
  if (Math.abs(target - power) > 4) {
    return {
      level: 'normal',
      phase: 'Power change',
      headline: `Power is moving toward ${Math.round(target)}%`,
      detail: 'The automatic control system is moving the rods for you.',
      steps: [
        { text: 'Give it a minute to settle after each target change', page: 'reactor' },
        { text: 'Neutron power should track the target within a few percent' },
      ],
    };
  }

  return {
    level: 'normal',
    phase: 'At power',
    headline: `Running normally at ${Math.round(power)}% power`,
    detail: 'Everything is in its normal band.',
    steps: [
      { text: 'Try lowering power with the target slider', page: 'reactor' },
      { text: 'Or start a training exercise', page: 'scenario' },
      { text: 'Or open the Learn page for short lessons', page: 'learn' },
    ],
  };
}
