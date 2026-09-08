import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SimService } from '../sim/sim.service';
import { ScenariosService } from './scenarios.service';
import { PersistenceService } from './persistence.service';
import { LESSONS, lessonById, type Lesson } from './lessons';
import type { Snapshot } from '../sim/sim.types';

export interface ObjectiveState {
  id: string;
  text: string;
  done: boolean;
  /** For dwell objectives: seconds accumulated toward the goal. */
  dwellProgress?: number;
  dwellGoal?: number;
}

export interface Debrief {
  lesson: Lesson;
  passed: boolean;
  failReason?: string;
  simSeconds: number;
  hintsUsed: number;
  objectives: ObjectiveState[];
  keyEvents: { sim_time: number; message: string }[];
}

@Injectable({ providedIn: 'root' })
export class LessonService {
  private readonly sim = inject(SimService);
  private readonly scenarios = inject(ScenariosService);
  private readonly persistence = inject(PersistenceService);

  readonly all = LESSONS;
  readonly active = signal<Lesson | null>(null);
  readonly objectives = signal<ObjectiveState[]>([]);
  readonly hintsUsed = signal(0);
  readonly debrief = signal<Debrief | null>(null);

  private dwell = new Map<string, number>();
  private doneIds = new Set<string>();
  private lastSimTime = 0;

  readonly done = computed(() => this.persistence.prefs().lessonsDone);
  readonly progress = computed(() => {
    const o = this.objectives();
    return o.length ? { n: o.filter((x) => x.done).length, total: o.length } : null;
  });

  constructor() {
    effect(() => {
      const s = this.sim.snapshot();
      const lesson = this.active();
      if (!lesson || !s) return;
      this.evaluate(lesson, s);
    });
  }

  async start(id: string): Promise<void> {
    const lesson = lessonById(id);
    if (!lesson) return;
    this.debrief.set(null);
    this.hintsUsed.set(0);
    this.dwell.clear();
    this.doneIds.clear();

    const json =
      lesson.scenario === 'baseline'
        ? 'baseline'
        : await this.scenarios.fetchBuiltin(lesson.scenario);
    await this.sim.loadScenario(json);

    this.active.set(lesson);
    this.objectives.set(
      lesson.objectives.map((o) => ({
        id: o.id,
        text: o.text,
        done: false,
        dwellProgress: o.dwell ? 0 : undefined,
        dwellGoal: o.dwell?.seconds,
      })),
    );
    this.lastSimTime = 0;
    if (lesson.autorun) this.sim.resume();
  }

  private evaluate(lesson: Lesson, s: Snapshot): void {
    if (this.debrief()) return; // already finished this run
    const now = s.sim_time;
    const dt = Math.max(0, now - this.lastSimTime);
    this.lastSimTime = now;

    if (lesson.failIf?.check(s)) {
      this.finish(lesson, false, lesson.failIf.text);
      return;
    }

    const next: ObjectiveState[] = lesson.objectives.map((def) => {
      let done = this.doneIds.has(def.id);
      let dwellProgress: number | undefined;
      if (def.dwell) {
        const acc = (this.dwell.get(def.id) ?? 0) + (def.dwell.cond(s) ? dt : -dt * 0.5);
        const clamped = Math.max(0, Math.min(def.dwell.seconds, acc));
        this.dwell.set(def.id, clamped);
        dwellProgress = Math.round(clamped);
        if (clamped >= def.dwell.seconds) done = true;
      } else if (!done && def.check(s)) {
        done = true;
      }
      if (done) this.doneIds.add(def.id);
      return {
        id: def.id,
        text: def.text,
        done,
        dwellProgress,
        dwellGoal: def.dwell?.seconds,
      };
    });
    this.objectives.set(next);

    if (next.every((o) => o.done)) this.finish(lesson, true);
  }

  private finish(lesson: Lesson, passed: boolean, failReason?: string): void {
    const s = this.sim.snapshot();
    const keyEvents = (s?.event_log ?? [])
      .filter((e) => e.category === 'trip' || e.category === 'scenario' || e.category === 'operator')
      .slice(-12)
      .map((e) => ({ sim_time: e.sim_time, message: e.message }));

    this.debrief.set({
      lesson,
      passed,
      failReason,
      simSeconds: s?.sim_time ?? 0,
      hintsUsed: this.hintsUsed(),
      objectives: this.objectives(),
      keyEvents,
    });

    if (passed) {
      const done = new Set(this.persistence.prefs().lessonsDone);
      done.add(lesson.id);
      this.persistence.updatePrefs({ lessonsDone: [...done] });
    }
    this.sim.pause();
    this.active.set(null);
  }

  useHint(): void {
    this.hintsUsed.update((n) => n + 1);
  }

  quit(): void {
    if (this.active()) this.finish(this.active()!, false, 'Ended early');
  }

  dismissDebrief(): void {
    this.debrief.set(null);
  }
}
