import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SimService } from '../sim/sim.service';
import type { Snapshot } from '../sim/sim.types';

export interface GuideStep {
  /** Plain-language instruction. */
  text: string;
  /** Route to switch to before showing this step. */
  route?: string;
  /** CSS selector to spotlight (first match). */
  target?: string;
  /** If set, the step auto-advances once this returns true. */
  waitFor?: (s: Snapshot | null) => boolean;
  /** Short call-to-action shown while waiting. */
  cta?: string;
  /** Run once when the step is shown. */
  onEnter?: (sim: SimService) => void;
}

export interface Tour {
  id: string;
  title: string;
  steps: GuideStep[];
}

export const TOURS: Tour[] = [
  {
    id: 'basics',
    title: 'First look around',
    steps: [
      {
        text:
          'Welcome. This plant boils water to make steam, the steam spins a turbine, and the ' +
          'turbine makes electricity. Here is the whole thing on one screen.',
        route: 'overview',
        target: 'svg.mimic',
      },
      {
        text:
          'The plant is frozen right now. Press RUN to let time move. You can speed it up or ' +
          'pause it any time with the buttons next to it.',
        target: '#run-toggle',
        cta: 'Press RUN',
        waitFor: (s) => !!s?.running,
      },
      {
        text: 'This clock is plant time, not real time. At 5x it moves five times faster. Try 5x now.',
        target: '.speeds',
        cta: 'Click 5x',
        waitFor: (s) => (s?.speed ?? 1) >= 5,
      },
      {
        text:
          'The big number on the reactor is how hard it is running, as a percentage. ' +
          'It should sit near 100 and stay steady. That is a healthy plant.',
        target: 'svg.mimic .big',
      },
      {
        text:
          'The coloured strip is a quick health check of the six safety functions. Green is fine; ' +
          'amber or red means something needs attention.',
        target: 'app-csf-strip',
      },
      {
        text:
          'The line below it is your coach. It says, in plain words, what the plant is doing and ' +
          'what to do next. Tap it to expand the step-by-step list. Turn it off with the Learn / ' +
          'Challenge button when you want no help.',
        target: 'app-coach-bar',
      },
      {
        text: 'Open the Reactor page from the menu to see the details behind that big number.',
        route: 'reactor',
        target: 'nol-reactor',
      },
      {
        text:
          'Let us lower the power. Drag the "Target power" slider down to about 85% and watch the ' +
          'neutron power number follow it over the next minute.',
        target: 'nol-reactor input[type=range]',
        cta: 'Set target power to about 85%',
        waitFor: (s) => (s?.controllers.target_power ?? 100) <= 90,
      },
      {
        text:
          'Good. The automatic control system moved the control rods for you. Put the target ' +
          'back to 100% when you are ready.',
        target: 'nol-reactor input[type=range]',
      },
      {
        text:
          'Now a problem. Open Scenarios, pick "Turbine Trip At Power" and press START SCENARIO. ' +
          'Then watch the top strip and the alarms.',
        route: 'scenario',
        target: 'nol-scenario',
        cta: 'Start the Turbine Trip scenario',
        waitFor: (s) => !!s?.controllers.turbine_trip_latched,
      },
      {
        text:
          'The turbine tripped, then the reactor tripped. The rods are in and fission has stopped, ' +
          'but the fuel still makes heat (decay heat), so cooling keeps going.',
        route: 'reactor',
        target: '.csf',
      },
      {
        text:
          'Open the Alarm console. New alarms flash until you acknowledge them. ' +
          'Press ACK ALL VISIBLE.',
        route: 'alarms',
        target: 'nol-alarms',
        cta: 'Acknowledge the alarms',
        waitFor: (s) => (s?.alarm_unacked ?? 1) === 0,
      },
      {
        text:
          'The Event Log lists everything that happened, with plant timestamps. This is how you ' +
          'work out what started a problem.',
        route: 'eventlog',
        target: 'nol-eventlog',
      },
      {
        text:
          'That is the first look. For a guided walk through every gauge and every control, open ' +
          'the Learn page and start the full control-room walkthrough. Press RESET to start over.',
        target: 'button.danger',
      },
    ],
  },
  {
    id: 'walkthrough',
    title: 'Control-room walkthrough',
    steps: [
      {
        text:
          'This walkthrough visits every page and explains what each display shows and what each ' +
          'control does. Click Next to move on; Back to revisit; Skip to leave. The plant is now ' +
          'running so the gauges are live.',
        route: 'overview',
        target: 'svg.mimic',
        onEnter: (sim) => {
          sim.resume();
          sim.setSpeed(2);
        },
      },
      {
        text:
          'The top bar is always here. This is the plant clock and the RUN / pause / STEP buttons. ' +
          'STEP advances 0.2 s at a time while paused — useful for watching a fast transient frame ' +
          'by frame.',
        target: '.clockbox',
      },
      {
        text:
          'Time scaling. 1× is real speed; 5× or 10× fast-forwards steady periods; 0.25× slows a ' +
          'transient down. The physics is identical at every speed.',
        target: '.speeds',
      },
      {
        text:
          'The alarm counter. It flashes when unacknowledged alarms are waiting and links straight ' +
          'to the alarm console.',
        target: '.alarmpill',
      },
      {
        text:
          'The coloured strip is the six Critical Safety Functions at a glance: reactivity, core ' +
          'heat removal, primary inventory, heat sink, electrical, containment. Green is good.',
        target: 'app-csf-strip',
      },
      {
        text:
          'The coach line (Learn mode only) turns that into plain language and a checklist of what ' +
          'to do next. The Learn / Challenge button on the right switches it off.',
        target: 'app-coach-bar',
      },
      {
        text:
          'The Overview mimic is the whole plant on one screen: reactor, pressuriser, two steam ' +
          'generators, turbine, condenser, feedwater, electrical. Animated pipes mean coolant is ' +
          'flowing. Click any block to jump to its page.',
        target: 'svg.mimic',
      },

      // ---- Reactor -------------------------------------------------------
      {
        text:
          'Reactor page. Neutronics: neutron power is fission power as a percent of full load. ' +
          'Thermal power (MW) adds decay heat. Net reactivity in pcm tells you which way power is ' +
          'about to move — positive rising, negative falling. Xenon builds in after a power cut ' +
          'and holds the reactor down for hours.',
        route: 'reactor',
        target: '#w-neutronics',
      },
      {
        text:
          'Control rods. In AUTO you just set Target power and the controller moves the rods to ' +
          'hold it. Take manual to nudge the bank yourself with INSERT / WITHDRAW. The red button ' +
          'is a manual reactor trip; RESET TRIP only works once readings are back in a safe band.',
        target: '#w-rods',
      },
      {
        text:
          'Reactivity balance (needs Instr mode). It breaks the net figure into rods, fuel ' +
          'temperature (Doppler), moderator temperature, xenon, boron and — after a trip — scram. ' +
          'Normally an operator infers this from how power is behaving.',
        target: '#w-reactivity',
      },
      {
        text:
          'Temperatures. Fuel temperature drives the Doppler feedback. Coolant T-avg is the ' +
          'controlled variable; hot and cold leg straddle it, and their difference (ΔT) is ' +
          'proportional to reactor power.',
        target: '#w-rx-temps',
      },

      // ---- Primary ------------------------------------------------------
      {
        text:
          'Primary page. The four reactor coolant pumps push water through the core. Primary flow ' +
          'falls in steps as you stop pumps; below ~87% at power the reactor trips. Losing all ' +
          'four leaves only weak natural circulation.',
        route: 'primary',
        target: '#w-rcp',
      },
      {
        text:
          'Pressure and pressuriser. The pressuriser is a steam bubble that sets primary pressure ' +
          '(~15.5 MPa) and gives the coolant somewhere to expand into. In AUTO, heaters and spray ' +
          'hold the setpoint; the line at the bottom shows heater, spray and relief-valve demand. ' +
          'Falling level or pressure means you are losing coolant.',
        target: '#w-pzr',
      },
      {
        text:
          'Loop temperatures again, with core heat to the coolant in MW. Watch T-avg against its ' +
          'program: if it climbs with power steady, the steam generators are not removing enough ' +
          'heat.',
        target: '#w-loop-temps',
      },

      // ---- Secondary --------------------------------------------------
      {
        text:
          'Secondary page. Each steam generator boils primary heat into steam. Narrow-range level ' +
          'is what you control; steam flow should match feed flow in the steady state. Low-low ' +
          'level trips the reactor; high level trips the turbine.',
        route: 'secondary',
        target: '#w-sg1',
      },
      {
        text:
          'Feedwater. Two main pumps, plus auxiliary feedwater that starts automatically on low ' +
          'level. In AUTO the three-element controller matches feed to steam and level; the slider ' +
          'sets the level target.',
        target: '#w-feedwater',
      },
      {
        text:
          'Turbine and generator. Speed should sit at 100%. Synchronise closes the generator ' +
          'breaker onto the grid; Load target then sets how much power it takes. The red button ' +
          'trips the turbine — the reactor trips straight after at power.',
        target: '#w-turbine',
      },
      {
        text:
          'Condenser. It turns spent steam back into water and sets the turbine backpressure. If ' +
          'its cooling degrades, backpressure rises, output falls, and eventually the turbine ' +
          'trips on high backpressure. It is also where the steam dump sends steam after a trip.',
        target: '#w-condenser',
      },

      // ---- Electrical ------------------------------------------------
      {
        text:
          'Electrical page. The single line reads top to bottom: off-site grid and the main ' +
          'generator feed the essential bus; if both are lost, the two emergency diesels start ' +
          'and pick it up. A green link is energised.',
        route: 'electrical',
        target: '#w-sld',
      },
      {
        text:
          'Loads and battery. The reactor coolant and main feed pumps only run on off-site power ' +
          'or the main generator — never the diesels. When the bus is dead the station battery ' +
          'carries instruments and control for a few hours.',
        target: '#w-loads',
      },

      // ---- Containment & Safeguards --------------------------------
      {
        text:
          'Containment & Safeguards. The containment building is the last barrier. Its pressure, ' +
          'temperature and sump level rise with anything leaked from the primary. Phase-A ' +
          'isolation closes penetrations; spray condenses steam to knock pressure down. Both ' +
          'actuate automatically but you can drive them here.',
        route: 'containment',
        target: '#w-cnmt',
      },
      {
        text:
          'Safety injection. It actuates automatically on low primary pressure or high ' +
          'containment pressure, trips the reactor, and pumps borated water in. Accumulators add ' +
          'a passive dump once pressure is very low. Reset SI once the plant has recovered.',
        target: '#w-si',
      },
      {
        text:
          'Chemistry and makeup (CVCS). Charging adds water and letdown removes it; in AUTO they ' +
          'hold pressuriser level. Boron is a soluble poison — borate to add shutdown margin as ' +
          'the plant cools, dilute to bring power up.',
        target: '#w-cvcs',
      },

      // ---- Safety functions ----------------------------------------
      {
        text:
          'Safety Functions page. The same six cards as the strip, with what each is asking and ' +
          'which signals decide it. This is a teaching aid for defence-in-depth thinking, not a ' +
          'real procedure.',
        route: 'safety',
        target: '.csfgrid',
      },
      {
        text:
          'The table gives the exact bands for NORMAL / DEGRADED / CHALLENGED. UNKNOWN shows when ' +
          'redundant channels disagree too much to trust the reading.',
        target: '#w-csf-derivation',
      },

      // ---- Alarms -------------------------------------------------
      {
        text:
          'Alarm console. ACK ALL VISIBLE silences the ones you have read. Filter by subsystem or ' +
          'priority, sort by priority or time, or show only what is still active.',
        route: 'alarms',
        target: '.toolbar',
      },
      {
        text:
          'The annunciator. Priority 1 is red. The State column tells a live alarm from a cleared ' +
          'one that was never acknowledged. The history panel below is the full timeline.',
        target: '#w-annunciator',
      },

      // ---- Trends ------------------------------------------------
      {
        text:
          'Trends. Tick any variables on the left to plot them together — grouped by system. Your ' +
          'selection is remembered.',
        route: 'trends',
        target: '.picker',
      },
      {
        text:
          'Choose the time window (1 / 5 / 15 min or the whole run). The legend shows the current ' +
          'value of each line. This is how you see the shape of a transient.',
        target: '.chart',
      },

      // ---- Event log -------------------------------------------
      {
        text:
          'Event Log. Every trip, automatic action, operator command, alarm and scripted event, ' +
          'with a plant timestamp. Filter by category to cut the noise.',
        route: 'eventlog',
        target: '.toolbar',
      },
      {
        text:
          'To diagnose a problem, scroll to where it started: the first entry in the chain is ' +
          'usually the initiating event.',
        target: '#w-eventlog',
      },

      // ---- Scenario -------------------------------------------
      {
        text:
          'Scenario / Instructor. Pick a scenario for a briefing and a scripted fault, or use the ' +
          'instructor panel to inject a fault by hand at any time. You can also export a run and ' +
          'replay it exactly.',
        route: 'scenario',
        target: 'nol-scenario',
      },
      {
        text:
          'That is the whole control room. Press RESET to start clean, pick a scenario, or switch ' +
          'to Challenge mode with the top-bar button when you want to run without the coach.',
        target: 'button.danger',
      },
    ],
  },
];

@Injectable({ providedIn: 'root' })
export class GuideService {
  private readonly router = inject(Router);
  private readonly sim = inject(SimService);

  private tour = signal<Tour | null>(null);
  readonly index = signal(0);
  /** Bumped each time a tour starts, so listeners can tell restarts apart. */
  readonly runId = signal(0);

  readonly active = computed(() => this.tour());
  readonly step = computed<GuideStep | null>(() => {
    const t = this.tour();
    return t ? (t.steps[this.index()] ?? null) : null;
  });
  readonly progress = computed(() => {
    const t = this.tour();
    return t ? { n: this.index() + 1, total: t.steps.length } : null;
  });

  start(id: string): void {
    const t = TOURS.find((x) => x.id === id) ?? null;
    this.tour.set(t);
    this.index.set(0);
    this.runId.update((n) => n + 1);
    this.applyStep();
  }

  next(): void {
    const t = this.tour();
    if (!t) return;
    if (this.index() >= t.steps.length - 1) {
      this.stop();
      return;
    }
    this.index.update((i) => i + 1);
    this.applyStep();
  }

  prev(): void {
    if (this.index() > 0) {
      this.index.update((i) => i - 1);
      this.applyStep();
    }
  }

  stop(): void {
    this.tour.set(null);
  }

  /** Called by the overlay on each snapshot to auto-advance waiting steps. */
  tick(s: Snapshot | null): void {
    const st = this.step();
    if (st?.waitFor && st.waitFor(s)) this.next();
  }

  private applyStep(): void {
    const st = this.step();
    if (!st) return;
    if (st.route) void this.router.navigateByUrl('/' + st.route);
    st.onEnter?.(this.sim);
  }
}
