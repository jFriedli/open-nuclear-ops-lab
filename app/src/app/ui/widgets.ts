import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

type Level = 'normal' | 'warn' | 'alarm';

@Component({
  selector: 'nol-readout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ro" [class.warn]="level() === 'warn'" [class.alarm]="level() === 'alarm'">
      <span class="lbl">{{ label() }}</span>
      <span class="val num">{{ display() }}<em>{{ units() }}</em></span>
      @if (deviation() != null && deviation()! > 0) {
        <span class="dev num" title="max channel disagreement">±{{ deviation()!.toFixed(devDp()) }}</span>
      }
    </div>
  `,
  styles: [
    `
      .ro {
        display: flex;
        align-items: baseline;
        gap: 8px;
        padding: 3px 0;
        border-bottom: 1px dotted var(--line);
      }
      .lbl {
        flex: 1;
        color: var(--text-dim);
        font-size: 11px;
      }
      .val {
        font-size: 14px;
        font-variant-numeric: tabular-nums;
      }
      .val em {
        color: var(--text-dim);
        font-style: normal;
        font-size: 10px;
        margin-left: 3px;
      }
      .dev {
        color: var(--unknown);
        font-size: 10px;
      }
      .warn .val {
        color: var(--warn);
      }
      .alarm .val {
        color: var(--alarm);
        font-weight: 700;
      }
    `,
  ],
})
export class ReadoutComponent {
  label = input.required<string>();
  value = input.required<number>();
  units = input('');
  dp = input(1);
  deviation = input<number | null>(null);
  level = input<Level>('normal');

  display = computed(() => {
    const v = this.value();
    return Number.isFinite(v) ? v.toFixed(this.dp()) : '--';
  });
  devDp = computed(() => Math.max(1, this.dp()));
}

@Component({
  selector: 'nol-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bar" [style.--pct.%]="pct()">
      <div class="fill" [class.warn]="level() === 'warn'" [class.alarm]="level() === 'alarm'"></div>
      @for (m of markers(); track m) {
        <span class="mark" [style.left.%]="scale(m)"></span>
      }
    </div>
  `,
  styles: [
    `
      .bar {
        position: relative;
        height: 10px;
        background: var(--panel-3);
        border: 1px solid var(--line);
        border-radius: 3px;
        overflow: hidden;
      }
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--pct);
        background: linear-gradient(90deg, var(--accent-2), var(--accent));
        transition: width 0.15s linear;
      }
      .fill.warn {
        background: var(--warn);
      }
      .fill.alarm {
        background: var(--alarm);
      }
      .mark {
        position: absolute;
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgba(255, 255, 255, 0.4);
      }
    `,
  ],
})
export class BarComponent {
  value = input.required<number>();
  min = input(0);
  max = input(100);
  markers = input<number[]>([]);
  level = input<Level>('normal');

  scale = (v: number) => ((v - this.min()) / (this.max() - this.min() || 1)) * 100;
  pct = computed(() => Math.max(0, Math.min(100, this.scale(this.value()))));
}

@Component({
  selector: 'nol-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="pill" [class]="cls()">{{ text() }}</span>`,
  styles: [
    `
      .pill {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 3px;
        font-family: var(--mono);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid currentColor;
      }
      .on {
        color: var(--ok);
      }
      .off {
        color: var(--text-dim);
      }
      .bad {
        color: var(--alarm);
      }
      .hold {
        color: var(--warn);
      }
    `,
  ],
})
export class PillComponent {
  text = input.required<string>();
  cls = input<'on' | 'off' | 'bad' | 'hold'>('off');
}
