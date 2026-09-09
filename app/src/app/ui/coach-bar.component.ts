import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SimService } from '../sim/sim.service';
import { PersistenceService } from '../core/persistence.service';
import { coach } from '../core/coach';

const OPEN_KEY = 'nol.coach.open';

/**
 * Learn-mode coach strip. Sits under the safety strip and tells the operator,
 * in plain language, what the plant is doing and what to do next. Hidden
 * entirely in Challenge mode.
 */
@Component({
  selector: 'app-coach-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    @if (show()) {
      <div class="coach" [class]="report().level">
        <button class="hd" (click)="toggle()" [attr.aria-expanded]="open()">
          <span class="dot"></span>
          <b>{{ report().headline }}</b>
          @if (report().detail) {
            <span class="detail">{{ report().detail }}</span>
          }
          <span class="chev">{{ open() ? '▾' : '▸' }}</span>
        </button>
        @if (open() && report().steps.length) {
          <ol class="steps">
            @for (st of report().steps; track st.text) {
              <li [class.done]="st.done === true" [class.todo]="st.done === false">
                <span class="mk">{{ st.done === true ? '✓' : st.done === false ? '○' : '›' }}</span>
                @if (st.page) {
                  <a [routerLink]="'/' + st.page">{{ st.text }}</a>
                } @else {
                  <span>{{ st.text }}</span>
                }
              </li>
            }
          </ol>
        }
      </div>
    }
  `,
  styles: [
    `
      .coach {
        border-bottom: 1px solid var(--line);
        background: var(--panel);
        font-size: 12px;
      }
      .hd {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        text-align: left;
        background: none;
        border: 0;
        border-radius: 0;
        padding: 6px 12px;
        color: var(--text);
        cursor: pointer;
      }
      .hd:hover:not(:disabled) {
        border-color: transparent;
      }
      .hd b {
        font-size: 12.5px;
        font-weight: 600;
      }
      .detail {
        color: var(--text-dim);
      }
      .chev {
        margin-left: auto;
        color: var(--text-dim);
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--ok);
      }
      .watch {
        background: #2c2610;
      }
      .watch .dot {
        background: var(--warn);
      }
      .abnormal {
        background: #351c10;
      }
      .abnormal .dot {
        background: #ff8c42;
      }
      .emergency {
        background: #3a1414;
      }
      .emergency .dot {
        background: var(--alarm);
      }
      .emergency b {
        color: var(--alarm);
      }
      .steps {
        margin: 0;
        padding: 2px 12px 8px 12px;
        list-style: none;
        display: grid;
        gap: 3px;
      }
      .steps li {
        display: flex;
        gap: 8px;
        color: var(--text-dim);
        line-height: 1.4;
      }
      .steps li.done {
        color: var(--ok);
      }
      .steps li.todo {
        color: var(--text);
      }
      .steps .mk {
        width: 12px;
        flex-shrink: 0;
        text-align: center;
      }
      .steps a {
        color: inherit;
        text-decoration: underline;
        text-decoration-color: var(--accent);
        text-underline-offset: 2px;
      }
      @media (max-width: 720px) {
        .detail {
          display: none;
        }
      }
    `,
  ],
})
export class CoachBarComponent {
  private readonly sim = inject(SimService);
  private readonly persistence = inject(PersistenceService);

  readonly report = computed(() => coach(this.sim.snapshot()));
  readonly show = computed(() => this.persistence.prefs().learnMode);
  readonly open = signal(this.loadOpen());

  toggle(): void {
    const v = !this.open();
    this.open.set(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? '1' : '0');
    } catch {
      /* storage may be unavailable */
    }
  }

  private loadOpen(): boolean {
    try {
      return localStorage.getItem(OPEN_KEY) !== '0';
    } catch {
      return true;
    }
  }
}
