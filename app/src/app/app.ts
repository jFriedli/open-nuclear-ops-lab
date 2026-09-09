import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SimService, SPEEDS } from './sim/sim.service';
import { ScenariosService } from './core/scenarios.service';
import { PersistenceService } from './core/persistence.service';
import { GuideService } from './core/guide.service';
import { CsfStripComponent } from './ui/csf-strip.component';
import { GuideOverlayComponent } from './ui/guide-overlay.component';
import { WelcomeComponent } from './ui/welcome.component';
import { CoachBarComponent } from './ui/coach-bar.component';
import { LessonHudComponent } from './ui/lesson-hud.component';
import { DebriefComponent } from './ui/debrief.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CsfStripComponent,
    GuideOverlayComponent,
    WelcomeComponent,
    CoachBarComponent,
    LessonHudComponent,
    DebriefComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly sim = inject(SimService);
  readonly guide = inject(GuideService);
  private readonly scenarios = inject(ScenariosService);
  private readonly persistence = inject(PersistenceService);
  private readonly router = inject(Router);
  readonly speeds = SPEEDS;

  readonly snap = this.sim.snapshot;
  readonly navOpen = signal(false);
  readonly showWelcome = signal(false);

  readonly clock = computed(() => {
    const t = this.sim.simTime();
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  });
  readonly unacked = computed(() => this.snap()?.alarm_unacked ?? 0);
  readonly debug = computed(() => this.persistence.prefs().debugMode);
  readonly learn = computed(() => this.persistence.prefs().learnMode);
  readonly hmiFaults = computed(() => this.snap()?.hmi_faulted ?? []);
  readonly signalFaults = computed(() => this.snap()?.signal_faulted ?? []);

  readonly nav = [
    { path: 'overview', label: 'Overview' },
    { path: 'reactor', label: 'Reactor' },
    { path: 'primary', label: 'Primary' },
    { path: 'secondary', label: 'Secondary / Turbine' },
    { path: 'electrical', label: 'Electrical' },
    { path: 'containment', label: 'Containment & Safeguards' },
    { path: 'alarms', label: 'Alarms' },
    { path: 'trends', label: 'Trends' },
    { path: 'safety', label: 'Safety Functions' },
    { path: 'scenario', label: 'Scenario / Instructor' },
    { path: 'eventlog', label: 'Event Log' },
    { path: 'learn', label: 'Learn' },
  ];

  constructor() {
    effect(() => this.sim.setDebug(this.persistence.prefs().debugMode));
  }

  ngOnInit(): void {
    this.sim.start();
    void this.scenarios.loadIndex();
    if (!this.persistence.prefs().onboarded) this.showWelcome.set(true);
  }

  onWelcome(choice: 'learn' | 'challenge'): void {
    this.persistence.updatePrefs({ onboarded: true, learnMode: choice === 'learn' });
    this.showWelcome.set(false);
    if (choice === 'learn') this.guide.start('basics');
    else void this.router.navigateByUrl('/scenario');
  }

  openHelp(): void {
    this.showWelcome.set(true);
  }
  setSpeed(s: number): void {
    this.sim.setSpeed(s);
  }
  toggleRun(): void {
    this.sim.running() ? this.sim.pause() : this.sim.resume();
  }
  toggleDebug(): void {
    this.persistence.updatePrefs({ debugMode: !this.persistence.prefs().debugMode });
  }
  toggleLearn(): void {
    this.persistence.updatePrefs({ learnMode: !this.persistence.prefs().learnMode });
  }
  closeNav(): void {
    this.navOpen.set(false);
  }
}
