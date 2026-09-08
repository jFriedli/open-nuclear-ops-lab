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
          'Welcome. This is a make-believe nuclear power plant. It boils water to make steam, ' +
          'the steam spins a turbine, and the turbine makes electricity. Nothing here is real.',
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
        text:
          'This clock is plant time, not real time. At 5x it moves five times faster. Try 5x now.',
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
          'The strip across the top is a plain-language health check. Green means fine. ' +
          'It turns amber or red when something needs your attention.',
        target: 'app-csf-strip',
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
          'That is the tour. Press RESET (top right) to start over, or open the Learn page for ' +
          'short lessons you can practise. Have fun.',
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
