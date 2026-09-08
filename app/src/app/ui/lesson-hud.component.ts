import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LessonService } from '../core/lesson.service';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'app-lesson-hud',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lessons.active(); as lesson) {
      <div class="hud" [class.min]="minimised()">
        <div class="hd" (click)="minimised.set(!minimised())">
          <b>{{ lesson.title }}</b>
          <span class="prog">{{ lessons.progress()?.n }} / {{ lessons.progress()?.total }}</span>
          <span class="clock num">{{ mmss(sim.simTime()) }}</span>
          <button class="mini" (click)="minimised.set(!minimised()); $event.stopPropagation()">
            {{ minimised() ? '▲' : '▾' }}
          </button>
        </div>
        @if (!minimised()) {
          <ul>
            @for (o of lessons.objectives(); track o.id) {
              <li [class.done]="o.done">
                <span class="mark">{{ o.done ? '✓' : '○' }}</span>
                <span>{{ o.text }}</span>
                @if (o.dwellGoal && !o.done) {
                  <span class="dwell num">{{ o.dwellProgress }}/{{ o.dwellGoal }}s</span>
                }
              </li>
            }
          </ul>
          <div class="btns">
            <button (click)="showHint()">Hint ({{ lessons.hintsUsed() }})</button>
            <button class="danger" (click)="lessons.quit()">End lesson</button>
          </div>
          @if (hint(); as t) { <p class="hinttext">💡 {{ t }}</p> }
        }
      </div>
    }
  `,
  styles: [
    `
      .hud {
        position: fixed;
        right: 12px;
        bottom: 12px;
        z-index: 120;
        width: min(320px, 92vw);
        background: var(--panel-2);
        border: 1px solid var(--accent);
        border-radius: 8px;
        font-size: 12px;
        box-shadow: 0 8px 26px rgba(0, 0, 0, 0.5);
      }
      .hd {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .hd b {
        flex: 1;
        font-size: 12px;
      }
      .prog {
        color: var(--accent);
        font-family: var(--mono);
      }
      .clock {
        color: var(--text-dim);
      }
      .mini {
        padding: 1px 6px;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0 10px 6px;
      }
      li {
        display: flex;
        gap: 7px;
        padding: 4px 0;
        border-top: 1px dotted var(--line);
        color: var(--text-dim);
      }
      li.done {
        color: var(--ok);
      }
      li .mark {
        width: 12px;
      }
      .dwell {
        margin-left: auto;
        font-size: 10px;
      }
      .btns {
        display: flex;
        gap: 6px;
        padding: 8px 10px;
      }
      .hinttext {
        margin: 0;
        padding: 0 10px 10px;
        color: var(--warn);
        font-size: 11px;
      }
      @media (max-width: 720px) {
        .hud {
          left: 12px;
          right: 12px;
          width: auto;
        }
      }
    `,
  ],
})
export class LessonHudComponent {
  readonly lessons = inject(LessonService);
  readonly sim = inject(SimService);
  readonly minimised = signal(false);
  private hintIdx = signal(0);

  readonly hint = computed(() => {
    const l = this.lessons.active();
    const i = this.hintIdx();
    return l && i > 0 ? l.hints[Math.min(i - 1, l.hints.length - 1)] : null;
  });

  showHint(): void {
    this.lessons.useHint();
    this.hintIdx.update((n) => n + 1);
  }
  mmss(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
}
