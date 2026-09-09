import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { SimService } from '../sim/sim.service';
import type { Alarm } from '../sim/sim.types';

@Component({
  selector: 'nol-alarms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="toolbar panel">
      <button class="primary" (click)="ackAll()">ACK ALL VISIBLE</button>
      <label>Subsystem
        <select [ngModel]="subsystem()" (ngModelChange)="subsystem.set($event)">
          <option value="">all</option>
          @for (s of subsystems(); track s) { <option [value]="s">{{ s }}</option> }
        </select>
      </label>
      <label>Priority
        <select [ngModel]="priority()" (ngModelChange)="priority.set(+$event)">
          <option [value]="0">all</option>
          <option [value]="1">1 - high</option>
          <option [value]="2">2 - medium</option>
          <option [value]="3">3 - low</option>
        </select>
      </label>
      <label>Sort
        <select [ngModel]="sort()" (ngModelChange)="sort.set($event)">
          <option value="priority">priority</option>
          <option value="time">newest</option>
          <option value="subsystem">subsystem</option>
        </select>
      </label>
      <label><input type="checkbox" [ngModel]="onlyActive()" (ngModelChange)="onlyActive.set($event)" /> only active</label>
      <span class="dim">{{ filtered().length }} shown · {{ unacked() }} unacknowledged</span>
    </div>

    <div class="panel" id="w-annunciator">
      <h2>Annunciator</h2>
      <table>
        <thead>
          <tr><th>P</th><th>Time</th><th>Subsystem</th><th>Message</th><th>State</th><th></th></tr>
        </thead>
        <tbody>
          @for (a of filtered(); track a.id) {
            <tr [class]="rowCls(a)">
              <td class="num">{{ a.priority }}</td>
              <td class="num">{{ mmss(a.raised_at) }}</td>
              <td>{{ a.subsystem }}</td>
              <td>{{ a.message }}@if (a.count > 1) {<span class="dim"> (×{{ a.count }})</span>}</td>
              <td>
                @if (a.active && !a.acknowledged) { <span class="tag alarm blink">ALARM</span> }
                @else if (a.active && a.acknowledged) { <span class="tag warn">ACK</span> }
                @else if (!a.active && !a.acknowledged) { <span class="tag warn">CLEARED·UNACK</span> }
                @else { <span class="tag ok">CLEAR</span> }
              </td>
              <td>
                @if (!a.acknowledged) { <button (click)="ack(a.id)">ACK</button> }
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="dim">No alarms match the filter.</td></tr>
          }
        </tbody>
      </table>
    </div>

    <div class="panel">
      <h2>Alarm history ({{ history().length }})</h2>
      <div class="scroll" style="max-height: 260px">
        <table>
          <tbody>
            @for (h of history(); track $index) {
              <tr>
                <td class="num">{{ mmss(h.sim_time) }}</td>
                <td class="num">P{{ h.priority }}</td>
                <td>{{ h.subsystem }}</td>
                <td>
                  <span class="tag"
                    [class.alarm]="h.transition === 'raised'"
                    [class.ok]="h.transition === 'cleared'"
                    [class.warn]="h.transition === 'ack'">{{ h.transition }}</span>
                </td>
                <td>{{ h.message }}</td>
              </tr>
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
        display: flex;
        gap: 4px;
        align-items: center;
        font-size: 11px;
        color: var(--text-dim);
      }
      tr.p1 td {
        background: color-mix(in srgb, var(--alarm) 8%, transparent);
      }
      tr.unack td {
        font-weight: 600;
      }
      .panel {
        margin-bottom: 12px;
      }
    `,
  ],
})
export class AlarmsComponent extends ViewBase {
  private readonly svc = inject(SimService);
  readonly subsystem = signal('');
  readonly priority = signal(0);
  readonly sort = signal<'priority' | 'time' | 'subsystem'>('priority');
  readonly onlyActive = signal(false);

  readonly alarms = computed(() => this.snap()?.alarms ?? []);
  readonly history = computed(() => [...(this.snap()?.alarm_history ?? [])].reverse());
  readonly unacked = computed(() => this.snap()?.alarm_unacked ?? 0);
  readonly subsystems = computed(() => [...new Set(this.alarms().map((a) => a.subsystem))].sort());

  readonly filtered = computed(() => {
    let list = this.alarms();
    if (this.subsystem()) list = list.filter((a) => a.subsystem === this.subsystem());
    if (this.priority()) list = list.filter((a) => a.priority === this.priority());
    if (this.onlyActive()) list = list.filter((a) => a.active);
    const s = this.sort();
    return [...list].sort((a, b) => {
      if (s === 'time') return b.raised_at - a.raised_at;
      if (s === 'subsystem') return a.subsystem.localeCompare(b.subsystem) || a.priority - b.priority;
      return a.priority - b.priority || b.raised_at - a.raised_at;
    });
  });

  rowCls(a: Alarm): string {
    return `${a.priority === 1 ? 'p1' : ''} ${!a.acknowledged ? 'unack' : ''}`;
  }
  mmss(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  ack(id: string): void {
    void this.svc.action({ type: 'ack_alarm', id });
  }
  ackAll(): void {
    void this.svc.action({ type: 'ack_all' });
  }
}
