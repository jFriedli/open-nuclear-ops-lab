import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LessonService } from '../core/lesson.service';
import { GuideService } from '../core/guide.service';
import { PersistenceService } from '../core/persistence.service';

interface Topic {
  id: string;
  title: string;
  body: string[];
}

const TOPICS: Topic[] = [
  {
    id: 'overview',
    title: 'What the major plant systems do',
    body: [
      'A pressurised-water reactor makes heat by fission in the fuel. That heat is carried by high-pressure water (the primary coolant) which is kept liquid by holding it well above its boiling point using a pressuriser.',
      'The hot primary water gives its heat to a second, lower-pressure water loop inside the steam generators. The secondary water boils; the steam drives a turbine connected to an electrical generator.',
      'After the turbine, steam is condensed back to water in the condenser and pumped back to the steam generators as feedwater. The primary and secondary loops never mix.',
      'Electrical power runs the pumps, valves, instruments and controls. If the plant loses its own generator and the grid, emergency diesel generators and a battery keep the safety systems alive.',
    ],
  },
  {
    id: 'power',
    title: 'Why reactor power changes',
    body: [
      'Reactor power follows reactivity - the balance between neutrons produced and neutrons lost. When reactivity is exactly zero the reactor is critical and power is steady.',
      'Withdrawing control rods adds positive reactivity and power rises; inserting them does the opposite. Because a few neutrons are released seconds to minutes after fission (delayed neutrons), a small reactivity change produces a gradual, controllable power change rather than an instant jump.',
      'The operator rarely knows reactivity directly. They infer it from how fast power is changing and from rod position, then trim the rods to hold the target.',
    ],
  },
  {
    id: 'feedback',
    title: 'Temperature feedback',
    body: [
      'As fuel gets hotter, more neutrons are absorbed without causing fission (the Doppler effect). This adds negative reactivity almost instantly, so a power rise partly cancels itself. This is a large part of why the reactor is inherently stable.',
      'As the coolant/moderator gets hotter it becomes less dense and moderates neutrons less effectively. In this simulator that moderator temperature coefficient is negative too, so rising average temperature also pushes power down.',
      'Try it: take rod control to manual, withdraw briefly, then stop. Power overshoots and then settles back down as the fuel and coolant heat up - that settle-back is negative feedback.',
    ],
  },
  {
    id: 'decay',
    title: 'Decay heat',
    body: [
      'When the reactor trips, fission stops within a second or two, but the radioactive fission products left in the fuel keep releasing heat as they decay.',
      'Immediately after shutdown this decay heat is roughly 6–7% of full power; it falls to about 1–2% within minutes and continues decreasing for days.',
      'This is why "shut down" is not "safe and walk away": the plant must keep removing decay heat for a long time. Loss of that heat removal is the central concern of every post-trip scenario.',
    ],
  },
  {
    id: 'steam',
    title: 'Steam generation and the heat sink',
    body: [
      'Each steam generator is a big kettle: primary water flows through tubes, secondary water outside the tubes boils. Steam flow out must be matched by feedwater flow in, or the water level drifts.',
      'Level control uses three signals - level, steam flow and feed flow - so it can react to a load change before the level actually moves ("three-element control").',
      'If feedwater is lost, level falls; auxiliary feedwater starts automatically, and a very low level trips the reactor because the steam generators are the normal way to remove heat.',
    ],
  },
  {
    id: 'turbine',
    title: 'Turbine / generator relationship',
    body: [
      'The turbine converts steam energy to shaft rotation; the generator converts shaft rotation to electricity. While the generator breaker is closed, the grid holds the shaft at exactly synchronous speed.',
      'If the breaker opens while steam is still flowing (a load rejection), there is suddenly nothing absorbing the shaft power and it speeds up quickly - hence overspeed protection and fast-acting governor valves.',
      'A turbine trip at power is followed almost immediately by a reactor trip, because the reactor has lost its main heat sink.',
    ],
  },
  {
    id: 'trips',
    title: 'Reactor trips',
    body: [
      'A reactor trip (scram) drops all control rods into the core by gravity, inserting a large negative reactivity in a couple of seconds. Fission power collapses; decay heat remains.',
      'The trips here are simple and independent: high power, high or low pressure, low pressuriser level, low steam-generator level, high coolant temperature, low coolant flow, safety injection, and a trip on turbine trip.',
    ],
  },
  {
    id: 'electrical',
    title: 'Electrical power and defence in depth',
    body: [
      "Normal power comes from the plant's own generator and from the off-site grid. Losing one leaves the other.",
      'Lose both and it is a "loss of off-site power": the reactor coolant pumps stop, the plant trips, and the essential electrical bus transfers to the emergency diesel generators within seconds.',
      'There are two independent diesels so that a single failure still leaves one. Below that is the station battery, which powers instrumentation and control for a few hours.',
    ],
  },
  {
    id: 'instrumentation',
    title: 'Why redundant instrumentation exists',
    body: [
      'Every measurement is made by an instrument, and instruments fail: they can read noisy, drift slowly, freeze at a value, or fail hard high or low.',
      'Safety-significant signals are measured by two or three independent channels. Control systems use a voted value (e.g. the median), and a large disagreement between channels raises its own alarm.',
      'The skill this simulator is built to teach is telling apart a real process problem from an instrument problem: if one channel says the tank is full and two say it is emptying, the tank is emptying.',
    ],
  },
  {
    id: 'safeguards',
    title: 'Loss of coolant, safety injection and containment',
    body: [
      'The reactor coolant system is a closed, high-pressure loop. If it springs a leak - a real break, or a relief valve stuck open - water is lost and pressure falls. The charging pumps make up what they can; when they cannot keep up, pressure and pressurizer level keep dropping.',
      'On low primary pressure the protection system actuates safety injection: it trips the reactor and starts the high-head SI pumps, which inject heavily borated water. If pressure falls far enough, passive accumulators dump their contents in as well. The boron keeps the core shut down as it cools.',
      'Everything that leaks out ends up inside the containment building, raising its pressure, temperature and sump level. Containment isolation closes the pipes that pass through the wall; containment spray washes the atmosphere to knock the pressure back down.',
      'Think in terms of the three barriers between the fuel and the outside world: the fuel cladding, the reactor coolant boundary, and the containment. The Containment & Safeguards page shows the state of the last two.',
    ],
  },
];

@Component({
  selector: 'nol-learn',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="panel mode">
      <div>
        <b>{{ learn() ? 'Learn mode is on' : 'Challenge mode' }}</b>
        <span class="dim">
          {{
            learn()
              ? 'The coach under the safety strip tells you what to do next. Turn it off when you want to be tested.'
              : 'No coaching. Run the scenarios below or from the Scenario page.'
          }}
        </span>
      </div>
      <button [class.active]="learn()" (click)="toggleLearn()">
        {{ learn() ? 'Switch to Challenge' : 'Switch to Learn' }}
      </button>
    </div>

    <div class="panel tours">
      <b>Guided tours</b>
      <button (click)="startTour('basics')">First look (2 min)</button>
      <button (click)="startTour('walkthrough')">Full control-room walkthrough</button>
    </div>

    <div class="tabs">
      <button [class.active]="tab() === 'lessons'" (click)="tab.set('lessons')">Lessons</button>
      <button [class.active]="tab() === 'reference'" (click)="tab.set('reference')">
        How it works
      </button>
    </div>

    @if (tab() === 'lessons') {
      <div class="lessons">
        @for (l of lessons.all; track l.id) {
          <div class="lesson" [class.done]="isDone(l.id)">
            <div class="ltop">
              <b>{{ l.title }}</b>
              <span class="tag">{{ l.level }}</span>
              <span class="dim sm">~{{ l.minutes }} min</span>
              @if (isDone(l.id)) {
                <span class="tag ok">done</span>
              }
            </div>
            <p class="dim">{{ l.brief }}</p>
            <ul class="objs">
              @for (o of l.objectives; track o.id) {
                <li>{{ o.text }}</li>
              }
            </ul>
            <button class="primary" (click)="start(l.id)">
              {{ isDone(l.id) ? 'Do it again' : 'Start lesson' }}
            </button>
          </div>
        }
        <p class="dim sm">
          Each lesson loads a scenario and checks your objectives automatically. Pause, use a hint,
          or end it any time.
        </p>
      </div>
    } @else {
      <div class="layout">
        <nav class="panel toc">
          <h2>Topics</h2>
          @for (t of topics; track t.id) {
            <a [class.sel]="openTopic() === t.id" (click)="openTopic.set(t.id)">{{ t.title }}</a>
          }
        </nav>
        <article class="panel">
          @for (t of topics; track t.id) {
            @if (openTopic() === t.id) {
              <h3>{{ t.title }}</h3>
              @for (p of t.body; track $index) {
                <p>{{ p }}</p>
              }
            }
          }
        </article>
      </div>
    }
  `,
  styles: [
    `
      .mode {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
      }
      .mode > div {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .mode .dim {
        font-size: 11px;
      }
      .mode button {
        flex-shrink: 0;
      }
      .tours {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      .tours b {
        margin-right: 4px;
      }
      .tabs {
        display: flex;
        gap: 6px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      }
      .lessons {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        align-items: start;
      }
      .lesson {
        border: 1px solid var(--line);
        border-radius: 6px;
        background: var(--panel);
        padding: 12px;
      }
      .lesson.done {
        border-color: color-mix(in srgb, var(--ok) 40%, var(--line));
      }
      .ltop {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .objs {
        margin: 6px 0 10px 16px;
        font-size: 11px;
        color: var(--text-dim);
      }
      .layout {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .toc {
        width: 260px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .toc a {
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 4px;
        color: var(--text-dim);
        font-size: 12px;
      }
      .toc a.sel {
        background: var(--accent-2);
        color: #fff;
      }
      article {
        flex: 1;
        max-width: 70ch;
      }
      article p {
        margin: 0 0 10px;
      }
      .sm {
        font-size: 10px;
      }
      @media (max-width: 720px) {
        .layout {
          flex-direction: column;
        }
        .toc {
          width: 100%;
        }
      }
    `,
  ],
})
export class LearnComponent {
  readonly lessons = inject(LessonService);
  private readonly guide = inject(GuideService);
  private readonly persistence = inject(PersistenceService);
  readonly topics = TOPICS;
  readonly tab = signal<'lessons' | 'reference'>('lessons');
  readonly openTopic = signal('overview');
  readonly learn = computed(() => this.persistence.prefs().learnMode);

  isDone(id: string): boolean {
    return this.lessons.done().includes(id);
  }
  start(id: string): void {
    void this.lessons.start(id);
  }
  startTour(id: string): void {
    this.guide.start(id);
  }
  toggleLearn(): void {
    this.persistence.updatePrefs({ learnMode: !this.persistence.prefs().learnMode });
  }
}
