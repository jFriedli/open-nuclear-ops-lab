import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LessonService } from '../core/lesson.service';

@Component({
  selector: 'app-debrief',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.shown]': '!!lessons.debrief()' },
  template: `
    @if (lessons.debrief(); as d) {
      <div role="dialog" aria-label="Lesson debrief">
        <div class="card">
          <div class="banner" [class.pass]="d.passed" [class.fail]="!d.passed">
            {{ d.passed ? 'Lesson complete' : 'Lesson ended' }}
          </div>
          <h3>{{ d.lesson.title }}</h3>
          @if (!d.passed && d.failReason) { <p class="reason">{{ d.failReason }}</p> }

          <div class="stats">
            <span>Time: <b class="num">{{ mmss(d.simSeconds) }}</b></span>
            <span>Par: <b class="num">{{ d.lesson.minutes }} min</b></span>
            <span>Hints used: <b class="num">{{ d.hintsUsed }}</b></span>
          </div>

          <h4>Objectives</h4>
          <ul class="obj">
            @for (o of d.objectives; track o.id) {
              <li [class.done]="o.done">{{ o.done ? '✓' : '✗' }} {{ o.text }}</li>
            }
          </ul>

          @if (d.keyEvents.length) {
            <h4>What happened</h4>
            <ul class="events">
              @for (e of d.keyEvents; track $index) {
                <li><span class="num">{{ mmss(e.sim_time) }}</span> {{ e.message }}</li>
              }
            </ul>
          }

          <div class="btns">
            <button class="primary" (click)="retry()">Retry</button>
            <button (click)="lessons.dismissDebrief()">Keep exploring this run</button>
            <button (click)="backToLessons()">Back to lessons</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: none;
      }
      :host.shown {
        position: fixed;
        inset: 0;
        z-index: 220;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(3, 6, 10, 0.82);
        padding: 16px;
      }
      .card {
        width: min(520px, 96vw);
        max-height: 92vh;
        overflow: auto;
        background: var(--panel-2);
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 0 20px 18px;
      }
      .banner {
        margin: 0 -20px 12px;
        padding: 10px 20px;
        font-family: var(--mono);
        font-weight: 700;
        letter-spacing: 0.04em;
        border-radius: 10px 10px 0 0;
      }
      .banner.pass {
        background: #123a24;
        color: var(--ok);
      }
      .banner.fail {
        background: #3a2012;
        color: var(--warn);
      }
      .reason {
        color: var(--warn);
      }
      .stats {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
        font-size: 12px;
        color: var(--text-dim);
        margin: 6px 0 4px;
      }
      h4 {
        margin: 12px 0 4px;
        font-size: 11px;
        text-transform: uppercase;
        color: var(--text-dim);
      }
      ul {
        margin: 0;
        padding-left: 4px;
        list-style: none;
        font-size: 12px;
      }
      .obj li {
        padding: 3px 0;
        color: var(--alarm);
      }
      .obj li.done {
        color: var(--ok);
      }
      .events li {
        padding: 2px 0;
        color: var(--text-dim);
      }
      .events .num {
        color: var(--text);
        margin-right: 6px;
      }
      .btns {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 14px;
      }
    `,
  ],
})
export class DebriefComponent {
  readonly lessons = inject(LessonService);
  private readonly router = inject(Router);

  mmss(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  retry(): void {
    const id = this.lessons.debrief()?.lesson.id;
    this.lessons.dismissDebrief();
    if (id) void this.lessons.start(id);
  }
  backToLessons(): void {
    this.lessons.dismissDebrief();
    void this.router.navigateByUrl('/learn');
  }
}
