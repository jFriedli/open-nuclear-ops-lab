import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="dialog" aria-label="Welcome">
      <div class="card">
        <h2>Open Nuclear Ops Lab</h2>
        <p class="lead">
          A control room for a pressurised-water power plant. Keep the reactor, the steam plant and
          the grid connection working together — and spot when something is going wrong.
        </p>

        <div class="choices">
          <button class="primary" (click)="pick.emit('learn')">
            <b>Learn the plant</b>
            <span
              >Guided tour, then a coach that tells you what to do next. Best if reactors are new to
              you.</span
            >
          </button>
          <button (click)="pick.emit('challenge')">
            <b>Take a challenge</b>
            <span>Straight to the scenarios, no coaching. For when you want to be tested.</span>
          </button>
        </div>

        <p class="mini">
          Fictional plant with simplified physics — not for real operation or training. Runs
          entirely in your browser.
        </p>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        position: fixed;
        inset: 0;
        z-index: 210;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(3, 6, 10, 0.8);
        padding: 16px;
      }
      .card {
        width: min(480px, 96vw);
        max-height: 92vh;
        overflow: auto;
        background: var(--panel-2);
        border: 1px solid var(--accent);
        border-radius: 10px;
        padding: 20px 22px;
      }
      h2 {
        color: var(--accent);
        margin-bottom: 8px;
      }
      .lead {
        font-size: 14px;
        line-height: 1.55;
      }
      .choices {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 16px 0 12px;
      }
      .choices button {
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 12px 14px;
      }
      .choices button b {
        font-size: 13px;
      }
      .choices button span {
        font-size: 11px;
        color: var(--text-dim);
      }
      .choices button.primary span {
        color: color-mix(in srgb, #fff 75%, transparent);
      }
      .mini {
        font-size: 11px;
        color: var(--text-dim);
      }
    `,
  ],
})
export class WelcomeComponent {
  @Output() pick = new EventEmitter<'learn' | 'challenge'>();
}
