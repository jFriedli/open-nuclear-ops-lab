import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TrendsService, TREND_VARS } from '../core/trends.service';
import { PersistenceService } from '../core/persistence.service';

const WINDOWS = [
  { label: '1 min', sec: 60 },
  { label: '5 min', sec: 300 },
  { label: '15 min', sec: 900 },
  { label: 'Full scenario', sec: 0 },
];

@Component({
  selector: 'nol-trends',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="layout">
      <aside class="panel picker">
        <h2>Variables</h2>
        @for (g of groups(); track g) {
          <div class="grp">{{ g }}</div>
          @for (v of varsIn(g); track v.key) {
            <label>
              <input type="checkbox" [checked]="selected().includes(v.key)" (change)="toggle(v.key)" />
              <span [style.color]="v.color">■</span> {{ v.label }} <em class="dim">{{ v.units }}</em>
            </label>
          }
        }
      </aside>

      <section class="panel chart">
        <div class="ctl">
          @for (w of windows; track w.sec) {
            <button [class.active]="windowSec() === w.sec" (click)="setWindow(w.sec)">{{ w.label }}</button>
          }
          <span class="dim">{{ selected().length }} variable(s)</span>
        </div>
        <canvas #cv></canvas>
        <div class="legend">
          @for (k of selected(); track k) {
            <span [style.color]="color(k)">■ {{ label(k) }} - <b class="num">{{ current(k) }}</b> {{ units(k) }}</span>
          }
        </div>
        <p class="dim sm">Trends reset when a new scenario is loaded.</p>
      </section>
    </div>
  `,
  styles: [
    `
      .layout {
        display: flex;
        gap: 12px;
        align-items: flex-start;
      }
      .picker {
        width: 240px;
        flex-shrink: 0;
        max-height: 80vh;
        overflow: auto;
      }
      .picker label {
        display: flex;
        gap: 6px;
        align-items: center;
        font-size: 11px;
        padding: 2px 0;
      }
      .grp {
        margin-top: 8px;
        font-size: 10px;
        text-transform: uppercase;
        color: var(--text-dim);
        letter-spacing: 0.05em;
      }
      .chart {
        flex: 1;
        min-width: 0;
      }
      .ctl {
        display: flex;
        gap: 6px;
        align-items: center;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      canvas {
        width: 100%;
        height: 420px;
        display: block;
        background: var(--panel-3);
        border: 1px solid var(--line);
        border-radius: 4px;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        font-size: 11px;
        font-family: var(--mono);
        margin-top: 6px;
      }
      .sm {
        font-size: 10px;
      }
      @media (max-width: 720px) {
        .layout {
          flex-direction: column;
        }
        .picker {
          width: 100%;
        }
      }
    `,
  ],
})
export class TrendsComponent implements AfterViewInit {
  private readonly trends = inject(TrendsService);
  private readonly persistence = inject(PersistenceService);
  readonly windows = WINDOWS;
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');

  readonly selected = signal<string[]>(this.persistence.prefs().trendVars);
  readonly windowSec = signal<number>(this.persistence.prefs().trendWindow);

  readonly groups = computed(() => [...new Set(TREND_VARS.map((v) => v.group))]);

  constructor() {
    effect(() => {
      this.trends.revision();
      this.selected();
      this.windowSec();
      this.draw();
    });
  }
  ngAfterViewInit(): void {
    this.draw();
  }

  varsIn(g: string) {
    return TREND_VARS.filter((v) => v.group === g);
  }
  color(k: string) {
    return TREND_VARS.find((v) => v.key === k)?.color ?? '#8ab';
  }
  label(k: string) {
    return TREND_VARS.find((v) => v.key === k)?.label ?? k;
  }
  units(k: string) {
    return TREND_VARS.find((v) => v.key === k)?.units ?? '';
  }
  current(k: string): string {
    const w = this.trends.window([k], this.windowSec());
    const arr = w.values.get(k) ?? [];
    const v = arr[arr.length - 1];
    return Number.isFinite(v) ? v.toFixed(1) : '--';
  }

  toggle(k: string): void {
    const s = new Set(this.selected());
    s.has(k) ? s.delete(k) : s.add(k);
    const next = TREND_VARS.filter((v) => s.has(v.key)).map((v) => v.key);
    this.selected.set(next);
    this.persistence.updatePrefs({ trendVars: next });
  }
  setWindow(sec: number): void {
    this.windowSec.set(sec);
    this.persistence.updatePrefs({ trendWindow: sec });
  }

  private draw(): void {
    const canvas = this.cv().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 600;
    const hgt = canvas.clientHeight || 420;
    canvas.width = w * dpr;
    canvas.height = hgt * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);

    const padL = 46;
    const padR = 10;
    const padT = 10;
    const padB = 22;
    const plotW = w - padL - padR;
    const plotH = hgt - padT - padB;

    ctx.strokeStyle = '#2c3946';
    ctx.fillStyle = '#667';
    ctx.font = '10px monospace';
    for (let i = 0; i <= 4; i++) {
      const y = padT + (plotH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
    }

    const keys = this.selected();
    if (keys.length === 0) {
      ctx.fillText('Select one or more variables.', padL + 4, padT + 16);
      return;
    }
    const { t, values } = this.trends.window(keys, this.windowSec());
    if (t.length < 2) {
      ctx.fillText('Collecting data - press RUN.', padL + 4, padT + 16);
      return;
    }
    const t0 = t[0];
    const span = t[t.length - 1] - t0 || 1;

    // x-axis labels
    for (let i = 0; i <= 4; i++) {
      const tt = t0 + (span * i) / 4;
      const x = padL + (plotW * i) / 4;
      const m = Math.floor(tt / 60);
      const s = Math.floor(tt % 60);
      ctx.fillText(`${m}:${s.toString().padStart(2, '0')}`, x - 12, hgt - 6);
    }

    // Each series auto-scaled independently; y label shows the first series range.
    keys.forEach((k, idx) => {
      const ys = values.get(k) ?? [];
      let lo = Infinity;
      let hi = -Infinity;
      for (const y of ys) {
        if (Number.isFinite(y)) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
      if (!Number.isFinite(lo)) return;
      const pad = (hi - lo) * 0.12 || 1;
      lo -= pad;
      hi += pad;
      ctx.beginPath();
      ctx.strokeStyle = this.color(k);
      ctx.lineWidth = 1.5;
      let started = false;
      for (let i = 0; i < ys.length; i++) {
        const y = ys[i];
        if (!Number.isFinite(y)) continue;
        const px = padL + ((t[i] - t0) / span) * plotW;
        const py = padT + plotH - ((y - lo) / (hi - lo || 1)) * plotH;
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (idx === 0) {
        ctx.fillStyle = this.color(k);
        ctx.fillText(hi.toFixed(0), 4, padT + 10);
        ctx.fillText(lo.toFixed(0), 4, padT + plotH);
      }
    });
  }
}
