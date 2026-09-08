import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SimService } from '../sim/sim.service';

@Component({
  selector: 'app-csf-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <a routerLink="/safety" class="strip" title="Critical Safety Functions — educational abstraction, not a real EOP">
      @for (c of csf(); track c.name) {
        <span class="csf" [class]="'status-' + c.status.toLowerCase()">
          <b>{{ short(c.name) }}</b>
          <i>{{ c.status }}</i>
        </span>
      }
    </a>
  `,
  styles: [
    `
      .strip {
        display: flex;
        gap: 1px;
        background: var(--line);
        text-decoration: none;
        border-bottom: 1px solid var(--line);
      }
      .csf {
        flex: 1;
        background: var(--panel);
        padding: 4px 8px;
        display: flex;
        flex-direction: column;
        line-height: 1.25;
        min-width: 0;
      }
      .csf b {
        font-size: 10px;
        color: var(--text-dim);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .csf i {
        font-style: normal;
        font-family: var(--mono);
        font-size: 12px;
        font-weight: 700;
      }
    `,
  ],
})
export class CsfStripComponent {
  private readonly sim = inject(SimService);
  readonly csf = computed(() => this.sim.snapshot()?.csf ?? []);
  short(n: string): string {
    return n.replace(' / BARRIER STATUS', '').replace('CONTROL', 'CTRL');
  }
}
