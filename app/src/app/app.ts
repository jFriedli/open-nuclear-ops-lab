import { ChangeDetectionStrategy, Component, computed, effect, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SimService, SPEEDS } from './sim/sim.service';
import { ScenariosService } from './core/scenarios.service';
import { PersistenceService } from './core/persistence.service';
import { CsfStripComponent } from './ui/csf-strip.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CsfStripComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnInit {
  readonly sim = inject(SimService);
  private readonly scenarios = inject(ScenariosService);
  private readonly persistence = inject(PersistenceService);
  readonly speeds = SPEEDS;

  readonly snap = this.sim.snapshot;
  readonly clock = computed(() => {
    const t = this.sim.simTime();
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  });
  readonly unacked = computed(() => this.snap()?.alarm_unacked ?? 0);
  readonly debug = computed(() => this.persistence.prefs().debugMode);
  readonly hmiFaults = computed(() => this.snap()?.hmi_faulted ?? []);
  readonly signalFaults = computed(() => this.snap()?.signal_faulted ?? []);

  readonly nav = [
    { path: 'overview', label: 'Overview' },
    { path: 'reactor', label: 'Reactor' },
    { path: 'primary', label: 'Primary' },
    { path: 'secondary', label: 'Secondary / Turbine' },
    { path: 'electrical', label: 'Electrical' },
    { path: 'alarms', label: 'Alarms' },
    { path: 'trends', label: 'Trends' },
    { path: 'safety', label: 'Safety Functions' },
    { path: 'scenario', label: 'Scenario / Instructor' },
    { path: 'eventlog', label: 'Event Log' },
    { path: 'learn', label: 'Learn' },
  ];

  constructor() {
    // Keep the worker's debug flag in sync with the stored preference.
    effect(() => this.sim.setDebug(this.persistence.prefs().debugMode));
  }

  ngOnInit(): void {
    this.sim.start();
    void this.scenarios.loadIndex();
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
}
