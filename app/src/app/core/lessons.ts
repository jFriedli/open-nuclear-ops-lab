import type { Snapshot } from '../sim/sim.types';

const h = (s: Snapshot | null, k: string) => s?.hmi[k] ?? 0;

export interface Objective {
  id: string;
  text: string;
  /** True once this objective is satisfied. Latches (stays done). */
  check: (s: Snapshot | null) => boolean;
  /** Instead of `check`, require `cond` to hold continuously for `seconds`. */
  dwell?: { cond: (s: Snapshot | null) => boolean; seconds: number };
}

export interface Lesson {
  id: string;
  title: string;
  level: 'Starter' | 'Basic' | 'Intermediate';
  minutes: number;
  brief: string;
  /** Scenario file to load, or 'baseline' for the clean plant. */
  scenario: string;
  /** Start the clock automatically. */
  autorun: boolean;
  objectives: Objective[];
  hints: string[];
  /** Optional soft fail condition that ends the lesson early. */
  failIf?: { text: string; check: (s: Snapshot | null) => boolean };
}

export const LESSONS: Lesson[] = [
  {
    id: 'l1-watch',
    title: 'Watch a healthy plant',
    level: 'Starter',
    minutes: 3,
    brief:
      'Get a feel for the controls. Start time, speed it up, pause it, and watch a trend line ' +
      'settle. Nothing will go wrong.',
    scenario: 'baseline',
    autorun: false,
    hints: [
      'The RUN button is at the top. STEP nudges time forward while paused.',
      'Open the Trends page and watch "Neutron power" hold near 100.',
    ],
    objectives: [
      { id: 'run', text: 'Start time with RUN', check: (s) => !!s?.running },
      { id: 'fast', text: 'Speed the clock up to 5x or more', check: (s) => (s?.speed ?? 1) >= 5 },
      {
        id: 'time',
        text: 'Let 3 minutes of plant time pass',
        check: (s) => (s?.sim_time ?? 0) >= 180,
      },
    ],
  },
  {
    id: 'l2-power',
    title: 'Change reactor power',
    level: 'Basic',
    minutes: 5,
    brief:
      'Lower the plant to 80% power, hold it, then bring it back to 100%. The automatic control ' +
      'system moves the rods for you; you just set the target.',
    scenario: 'baseline',
    autorun: true,
    hints: [
      'Reactor page, "Target power" slider. Give it a minute to settle after each move.',
      'Neutron power should track the target within a few percent.',
    ],
    objectives: [
      { id: 'down', text: 'Reach 80% power (±3%)', check: (s) => h(s, 'neutron_power') <= 83 },
      {
        id: 'hold',
        text: 'Hold between 76% and 84% for 60 seconds',
        check: () => false,
        dwell: {
          cond: (s) => h(s, 'neutron_power') >= 76 && h(s, 'neutron_power') <= 84,
          seconds: 60,
        },
      },
      { id: 'back', text: 'Return to 100% power (±3%)', check: (s) => h(s, 'neutron_power') >= 97 },
    ],
    failIf: {
      text: 'Reactor tripped - power moves must be gentle',
      check: (s) => !!s?.controllers.reactor_trip_latched,
    },
  },
  {
    id: 'l3-trip',
    title: 'Respond to a reactor trip',
    level: 'Basic',
    minutes: 6,
    brief:
      'The turbine will trip and the reactor will follow. Your job after a trip: check the plant ' +
      'is safe, acknowledge alarms, and confirm cooling continues.',
    scenario: 'turbine-trip.json',
    autorun: true,
    hints: [
      'After any trip: is the reactor shut down? does a steam generator have water? is there power?',
      'Alarm console: ACK ALL VISIBLE once you have read them.',
      'Decay heat keeps the fuel warm. Watch a steam generator level stay above 30%.',
    ],
    objectives: [
      {
        id: 'tripped',
        text: 'Confirm the reactor has tripped',
        check: (s) => !!s?.controllers.reactor_trip_latched,
      },
      {
        id: 'shutdown',
        text: 'Confirm fission power has collapsed (below 5%)',
        check: (s) => h(s, 'neutron_power') < 5,
      },
      { id: 'ack', text: 'Acknowledge all alarms', check: (s) => (s?.alarm_unacked ?? 1) === 0 },
      {
        id: 'heatsink',
        text: 'Keep both steam generators above 30% for the exercise',
        check: (s) => Math.min(h(s, 'sg1_level'), h(s, 'sg2_level')) > 30 && (s?.sim_time ?? 0) > 200,
      },
    ],
  },
  {
    id: 'l4-feed',
    title: 'Feedwater is lost',
    level: 'Intermediate',
    minutes: 7,
    brief:
      'Both main feedwater pumps trip. Steam generator levels will fall. Auxiliary feedwater starts ' +
      'automatically. Manage the trip and keep a heat sink.',
    scenario: 'feedwater-pump-trip.json',
    autorun: true,
    hints: [
      'Secondary page shows the feed pumps and aux feedwater status.',
      'Low-low steam generator level trips the reactor. Expect it.',
      'After the trip, aux feedwater should stop the level fall. Confirm it recovers.',
    ],
    objectives: [
      {
        id: 'noticed',
        text: 'Feedwater lost: a steam generator drops below 40%',
        check: (s) => Math.min(h(s, 'sg1_level'), h(s, 'sg2_level')) < 40,
      },
      {
        id: 'trip',
        text: 'Reactor trips on low steam generator level',
        check: (s) => !!s?.controllers.reactor_trip_latched,
      },
      {
        id: 'afw',
        text: 'Auxiliary feedwater is running',
        check: (s) => !!s?.equipment.afw_on,
      },
      {
        id: 'recover',
        text: 'Steam generator level stops falling and holds above 20%',
        check: (s) =>
          Math.min(h(s, 'sg1_level'), h(s, 'sg2_level')) > 22 && (s?.sim_time ?? 0) > 240,
      },
    ],
  },
  {
    id: 'l5-loop',
    title: 'Loss of off-site power',
    level: 'Intermediate',
    minutes: 8,
    brief:
      'The grid connection is lost. Pumps trip, the plant trips, and the safety bus transfers to ' +
      'the emergency diesels. Confirm each automatic action worked.',
    scenario: 'loss-of-offsite-power.json',
    autorun: true,
    hints: [
      'Electrical page: watch the essential bus and both diesels.',
      'Reactor coolant pumps run down. The plant cools by natural circulation.',
      'Battery charge should stay high while a diesel is running.',
    ],
    objectives: [
      {
        id: 'offsite',
        text: 'Off-site power is lost',
        check: (s) => !s?.electrical.offsite_power,
      },
      {
        id: 'trip',
        text: 'The reactor trips',
        check: (s) => !!s?.controllers.reactor_trip_latched,
      },
      {
        id: 'diesel',
        text: 'At least one emergency diesel is running',
        check: (s) => !!s?.electrical.edg_a_running || !!s?.electrical.edg_b_running,
      },
      {
        id: 'bus',
        text: 'The essential bus stays energised',
        check: (s) => !!s?.electrical.essential_bus_energized && (s?.sim_time ?? 0) > 120,
      },
      { id: 'ack', text: 'Acknowledge the alarm burst', check: (s) => (s?.alarm_unacked ?? 1) === 0 },
    ],
  },
  {
    id: 'l6-instrument',
    title: 'Is the plant broken, or the gauge?',
    level: 'Intermediate',
    minutes: 8,
    brief:
      'Several instruments misbehave with no real plant fault. Prove the plant is actually fine by ' +
      'cross-checking, and do not let a bad reading make you act.',
    scenario: 'generic-instrumentation-failure.json',
    autorun: true,
    hints: [
      'Look for channel-disagreement alarms. A single bad channel does not mean the plant moved.',
      'The safety-function strip stays green. That is a strong hint the plant is fine.',
      'Do not trip anything. The exercise is to stay calm and diagnose.',
    ],
    objectives: [
      {
        id: 'alarm',
        text: 'An instrument-disagreement alarm appears',
        check: (s) =>
          s?.alarm_history.some((a) => a.subsystem === 'Instrument' && a.transition === 'raised') ??
          false,
      },
      {
        id: 'stable',
        text: 'The plant stays stable: no reactor trip for 2 minutes after the first fault',
        check: (s) => !s?.controllers.reactor_trip_latched && (s?.sim_time ?? 0) > 150,
      },
      {
        id: 'nopanic',
        text: 'You did not trip the reactor or turbine',
        check: (s) =>
          !s?.controllers.reactor_trip_latched && !s?.controllers.turbine_trip_latched &&
          (s?.sim_time ?? 0) > 200,
      },
    ],
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}
