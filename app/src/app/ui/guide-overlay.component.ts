import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { GuideService } from '../core/guide.service';
import { SimService } from '../sim/sim.service';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-guide-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.shown]': '!!guide.step()' },
  template: `
    @if (guide.step(); as step) {
      <div role="dialog" aria-label="Guided tour">
        @if (hasTarget()) {
          <div class="ring" [style.top.px]="hole().top" [style.left.px]="hole().left"
            [style.width.px]="hole().width" [style.height.px]="hole().height"></div>
        } @else {
          <div class="scrim"></div>
        }
        <div class="card" [class.float]="floatCard()" [style.top.px]="cardPos().top"
          [style.left.px]="cardPos().left">
          <div class="hd">
            <span>{{ guide.active()?.title }}</span>
            <span class="prog">{{ guide.progress()?.n }} / {{ guide.progress()?.total }}</span>
          </div>
          <p>{{ step.text }}</p>
          @if (step.cta && step.waitFor) {
            <p class="cta">👉 {{ step.cta }}</p>
          }
          <div class="btns">
            <button (click)="guide.stop()">Skip</button>
            <span class="sp"></span>
            <button (click)="guide.prev()" [disabled]="guide.index() === 0">Back</button>
            <button class="primary" (click)="guide.next()">
              {{ step.waitFor ? 'Skip step' : last() ? 'Done' : 'Next' }}
            </button>
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
        z-index: 200;
        pointer-events: none;
        display: block;
      }
      .scrim {
        position: absolute;
        inset: 0;
        pointer-events: auto;
        background: rgba(3, 6, 10, 0.74);
      }
      .ring {
        position: absolute;
        border: 2px solid var(--accent);
        border-radius: 6px;
        box-shadow: 0 0 0 9999px rgba(3, 6, 10, 0.74);
        pointer-events: none;
        transition:
          top 0.2s ease,
          left 0.2s ease,
          width 0.2s ease,
          height 0.2s ease;
      }
      .card {
        pointer-events: auto;
        position: absolute;
        width: min(340px, 88vw);
        background: var(--panel-2);
        border: 1px solid var(--accent);
        border-radius: 8px;
        padding: 12px 14px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
        font-size: 13px;
      }
      .card.float {
        top: auto !important;
        left: 50% !important;
        bottom: 18px;
        transform: translateX(-50%);
      }
      .hd {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: var(--text-dim);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        margin-bottom: 6px;
      }
      .card p {
        margin: 0 0 10px;
        line-height: 1.5;
      }
      .cta {
        color: var(--accent);
        font-weight: 600;
      }
      .btns {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .sp {
        flex: 1;
      }
      @media (max-width: 720px) {
        .card {
          left: 50% !important;
          transform: translateX(-50%);
          bottom: 12px;
          top: auto !important;
        }
      }
    `,
  ],
})
export class GuideOverlayComponent {
  readonly guide = inject(GuideService);
  private readonly sim = inject(SimService);
  private readonly destroyRef = inject(DestroyRef);

  readonly hole = signal<Box>({ top: 0, left: 0, width: 0, height: 0 });
  readonly hasTarget = signal(false);
  readonly last = computed(() => {
    const p = this.guide.progress();
    return !!p && p.n === p.total;
  });
  /** true when the card should just sit bottom-centre (no useful anchor). */
  readonly floatCard = computed(() => {
    const b = this.hole();
    if (!this.hasTarget()) return true;
    // A target that fills most of the screen is not a useful anchor.
    return b.height > window.innerHeight * 0.55 || b.width > window.innerWidth * 0.85;
  });
  readonly cardPos = computed<Box>(() => {
    const b = this.hole();
    if (this.floatCard()) return { top: 0, left: 0, width: 0, height: 0 };
    const below = b.top + b.height + 12;
    const room = window.innerHeight - below;
    const above = b.top - 12 - 220;
    let top: number;
    if (room > 200) top = below;
    else if (above > 48) top = above;
    else top = Math.min(below, window.innerHeight - 240);
    top = Math.max(48, top);
    const left = Math.min(Math.max(12, b.left), Math.max(12, window.innerWidth - 360));
    return { top, left, width: 0, height: 0 };
  });

  private raf = 0;

  constructor() {
    // Re-locate the spotlight target on every animation frame while active.
    const loop = () => {
      const step = this.guide.step();
      if (step) {
        this.guide.tick(this.sim.snapshot());
        const el = step.target
          ? (document.querySelector(step.target) as HTMLElement | null)
          : null;
        if (el) {
          const r = el.getBoundingClientRect();
          const pad = 6;
          this.hole.set({
            top: r.top - pad,
            left: r.left - pad,
            width: r.width + pad * 2,
            height: r.height + pad * 2,
          });
          this.hasTarget.set(true);
        } else {
          this.hasTarget.set(false);
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    this.destroyRef.onDestroy(() => cancelAnimationFrame(this.raf));

    // Keyboard: Esc to skip, Enter/→ to advance.
    const onKey = (ev: KeyboardEvent) => {
      if (!this.guide.step()) return;
      if (ev.key === 'Escape') this.guide.stop();
      else if (ev.key === 'ArrowRight' || ev.key === 'Enter') this.guide.next();
      else if (ev.key === 'ArrowLeft') this.guide.prev();
    };
    window.addEventListener('keydown', onKey);
    this.destroyRef.onDestroy(() => window.removeEventListener('keydown', onKey));

    // Keep an effect so the component reacts to step changes for CD.
    effect(() => this.guide.step());
  }
}
