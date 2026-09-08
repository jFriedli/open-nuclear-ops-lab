import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SimService } from '../sim/sim.service';
import { PersistenceService } from '../core/persistence.service';
import { plantStatus } from '../core/plant-status';

@Component({
  selector: 'app-plant-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (show()) {
      <div class="bar" [class]="status().level">
        <span class="dot"></span>
        <b>{{ status().headline }}</b>
        <span class="detail">{{ status().detail }}</span>
        @if (beginner()) {
          <span class="advice">Next: {{ status().advice }}</span>
        }
      </div>
    }
  `,
  styles: [
    `
      .bar {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 10px;
        padding: 5px 12px;
        font-size: 12px;
        border-bottom: 1px solid var(--line);
        background: var(--panel);
      }
      .bar b {
        font-size: 12.5px;
      }
      .detail {
        color: var(--text-dim);
      }
      .advice {
        color: var(--accent);
      }
      .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        align-self: center;
        flex-shrink: 0;
      }
      .normal .dot {
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
      @media (max-width: 720px) {
        .detail {
          display: none;
        }
      }
    `,
  ],
})
export class PlantStatusBarComponent {
  private readonly sim = inject(SimService);
  private readonly persistence = inject(PersistenceService);
  readonly beginner = computed(() => this.persistence.prefs().beginnerMode);
  readonly status = computed(() => plantStatus(this.sim.snapshot()));
  // Always show when abnormal/emergency; in beginner mode show always.
  readonly show = computed(
    () => this.beginner() || this.status().level === 'abnormal' || this.status().level === 'emergency',
  );
}
