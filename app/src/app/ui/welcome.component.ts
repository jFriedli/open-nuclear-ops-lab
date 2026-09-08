import { ChangeDetectionStrategy, Component, EventEmitter, Output } from '@angular/core';

@Component({
  selector: 'app-welcome',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div role="dialog" aria-label="Welcome">
      <div class="card">
        <h2>Open Nuclear Ops Lab</h2>
        <p class="lead">
          A hands-on toy control room for a pretend nuclear power plant. Learn how a reactor,
          steam plant and grid connection fit together, and practise spotting when something
          is going wrong.
        </p>
        <p class="mini">Runs entirely in your browser. Not a real plant, not for real training.</p>

        <div class="choices">
          <button class="primary" (click)="pick.emit('tour')">
            <b>Take the 2-minute tour</b>
            <span>Guided, click-by-click. Best if reactors are new to you.</span>
          </button>
          <button (click)="pick.emit('lessons')">
            <b>Go to the lessons</b>
            <span>Short practice tasks with a goal and a check.</span>
          </button>
          <button (click)="pick.emit('explore')">
            <b>Just let me poke at it</b>
            <span>Drop me in. I will use the Learn page if I get stuck.</span>
          </button>
          <button class="ghost" (click)="pick.emit('expert')">
            I already know reactors - turn off the beginner helpers
          </button>
        </div>
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
        width: min(520px, 96vw);
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
      .mini {
        font-size: 11px;
        color: var(--text-dim);
        margin-top: 4px;
      }
      .choices {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin-top: 14px;
      }
      .choices button {
        text-align: left;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px 12px;
      }
      .choices button b {
        font-size: 13px;
      }
      .choices button span {
        font-size: 11px;
        color: var(--text-dim);
      }
      .choices button.ghost {
        color: var(--text-dim);
        background: transparent;
        border-style: dashed;
        align-items: center;
        text-align: center;
      }
    `,
  ],
})
export class WelcomeComponent {
  @Output() pick = new EventEmitter<'tour' | 'lessons' | 'explore' | 'expert'>();
}
