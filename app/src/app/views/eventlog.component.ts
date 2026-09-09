import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';

const CATS = ['operator', 'auto', 'trip', 'fault', 'scenario', 'alarm', 'info'] as const;

@Component({
  selector: 'nol-eventlog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="panel toolbar">
      <span class="dim">Filter:</span>
      @for (c of cats; track c) {
        <label><input type="checkbox" [checked]="shown().includes(c)" (change)="toggle(c)" /> {{ c }}</label>
      }
      <span class="dim">{{ rows().length }} entries · simulation timestamps</span>
    </div>
    <div class="panel" id="w-eventlog">
      <h2>Event log</h2>
      <div class="scroll" style="max-height: 70vh">
        <table>
          <thead><tr><th style="width:70px">Time</th><th style="width:90px">Category</th><th>Event</th></tr></thead>
          <tbody>
            @for (e of rows(); track $index) {
              <tr [class]="'c-' + e.category">
                <td class="num">{{ mmss(e.sim_time) }}</td>
                <td><span class="tag" [class]="tagCls(e.category)">{{ e.category }}</span></td>
                <td>{{ e.message }}</td>
              </tr>
            } @empty {
              <tr><td colspan="3" class="dim">No matching events yet.</td></tr>
            }
          </tbody>
        </table>
      </div>
    </div>
  `,
  styles: [
    `
      .toolbar {
        display: flex;
        gap: 12px;
        align-items: center;
        flex-wrap: wrap;
        margin-bottom: 12px;
      }
      label {
        font-size: 11px;
        color: var(--text-dim);
        display: flex;
        gap: 3px;
        align-items: center;
      }
      tr.c-trip td {
        background: color-mix(in srgb, var(--alarm) 10%, transparent);
        font-weight: 600;
      }
      tr.c-fault td {
        background: color-mix(in srgb, var(--unknown) 8%, transparent);
      }
    `,
  ],
})
export class EventLogComponent extends ViewBase {
  readonly cats = CATS;
  readonly shown = signal<string[]>([...CATS]);
  readonly rows = computed(() => {
    const s = new Set(this.shown());
    return [...(this.snap()?.event_log ?? [])].reverse().filter((e) => s.has(e.category));
  });
  toggle(c: string): void {
    const s = new Set(this.shown());
    s.has(c) ? s.delete(c) : s.add(c);
    this.shown.set([...s]);
  }
  mmss(t: number): string {
    const m = Math.floor(t / 60);
    const sec = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }
  tagCls(c: string): string {
    if (c === 'trip') return 'alarm';
    if (c === 'operator') return 'ok';
    if (c === 'fault' || c === 'scenario') return 'warn';
    return '';
  }
}
