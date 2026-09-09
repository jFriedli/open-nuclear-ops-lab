import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ViewBase } from './view-base';
import { SimService } from '../sim/sim.service';
import { ScenariosService, type ScenarioDef } from '../core/scenarios.service';
import { PersistenceService } from '../core/persistence.service';

interface InjectForm {
  target: string;
  action: string;
  value: number;
  duration: number;
}

const INJECTIONS: { label: string; target: string; action: string; value: number; hint: string }[] =
  [
    { label: 'Trip RCP-1', target: 'rcp.0', action: 'trip', value: 0, hint: 'process' },
    {
      label: 'Trip main feedwater pump A',
      target: 'mfw.0',
      action: 'trip',
      value: 0,
      hint: 'process',
    },
    { label: 'Turbine trip', target: 'turbine', action: 'trip', value: 0, hint: 'process' },
    {
      label: 'Loss of off-site power',
      target: 'electrical.offsite',
      action: 'trip',
      value: 0,
      hint: 'process',
    },
    {
      label: 'Grid load rejection',
      target: 'electrical.grid',
      action: 'trip',
      value: 0,
      hint: 'process',
    },
    { label: 'EDG A unavailable', target: 'edg.a', action: 'fail', value: 0, hint: 'equipment' },
    {
      label: 'Relief valve stuck 30% open',
      target: 'valve.porv',
      action: 'stuck',
      value: 0.3,
      hint: 'process',
    },
    {
      label: 'Condenser degrade to 40%',
      target: 'condenser',
      action: 'degrade',
      value: 0.4,
      hint: 'process',
    },
    {
      label: 'SG-1 level ch. B drift +0.2/s',
      target: 'instrument.sg1_level.B',
      action: 'drift',
      value: 0.2,
      hint: 'instrument',
    },
    {
      label: 'Primary pressure ch. A stuck',
      target: 'instrument.primary_pressure.A',
      action: 'stuck',
      value: 0,
      hint: 'instrument',
    },
    {
      label: 'Neutron power ch. C fail low',
      target: 'instrument.neutron_power.C',
      action: 'fail_low',
      value: 0,
      hint: 'instrument',
    },
    {
      label: 'External reactivity −150 pcm ramp',
      target: 'physical.rho_external',
      action: 'ramp',
      value: -0.0015,
      hint: 'process',
    },
    {
      label: 'Signal bias: primary pressure +0.8 MPa',
      target: 'signal.primary_pressure',
      action: 'bias',
      value: 0.8,
      hint: 'signal',
    },
    {
      label: 'HMI: freeze SG-1 level on screen',
      target: 'hmi.sg1_level',
      action: 'stuck',
      value: 0,
      hint: 'HMI',
    },
    {
      label: 'HMI: spoof neutron power to 100%',
      target: 'hmi.neutron_power',
      action: 'set',
      value: 100,
      hint: 'HMI',
    },
    {
      label: 'SG-1 tube rupture (35%)',
      target: 'sgtr.0',
      action: 'start',
      value: 0.35,
      hint: 'process',
    },
    {
      label: 'ATWS: rods fail to insert',
      target: 'rods',
      action: 'fail',
      value: 0,
      hint: 'equipment',
    },
    {
      label: 'Cyber: bypass automatic reactor trip',
      target: 'protection.reactor_trip',
      action: 'inhibit',
      value: 0,
      hint: 'cyber',
    },
    {
      label: 'Cyber: pzr pressure setpoint → 13.5',
      target: 'control.pzr_setpoint',
      action: 'set',
      value: 13.5,
      hint: 'cyber',
    },
    {
      label: 'Cyber: inject rod-withdrawal command',
      target: 'control.rods',
      action: 'withdraw',
      value: 0,
      hint: 'cyber',
    },
    {
      label: 'Cyber: suppress low-pressure alarm',
      target: 'alarm.PRESS_LO',
      action: 'inhibit',
      value: 0,
      hint: 'cyber',
    },
  ];

@Component({
  selector: 'nol-scenario',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="layout">
      <section class="panel">
        <h2>Scenarios</h2>
        <div class="scroll" style="max-height: 320px">
          @for (s of scenarios(); track s.file) {
            <div class="scen" [class.sel]="selectedFile() === s.file" (click)="select(s.file)">
              <b>{{ s.name }}</b>
              <span class="dim sm">{{ s.description }}</span>
              <span class="dim sm">{{ s.events }} event(s) · {{ s.initial }}</span>
            </div>
          }
          @for (s of customScenarios(); track s.id) {
            <div
              class="scen custom"
              [class.sel]="selectedCustomId() === s.id"
              (click)="selectCustom(s.id)"
            >
              <b>{{ s.name }} <span class="tag warn">custom</span></b>
              <button class="danger sm" (click)="deleteCustom(s.id, $event)">delete</button>
            </div>
          }
        </div>
        <div class="row">
          <button class="primary" (click)="startSelected()" [disabled]="!currentJson()">
            ▶ START SCENARIO
          </button>
          <button (click)="reset()">RESET CURRENT</button>
        </div>
        @if (loadMsg(); as m) {
          <p class="dim sm" [class.err]="!loadOk()">{{ m }}</p>
        }
      </section>

      <section class="panel">
        <h2>Briefing</h2>
        @if (parsedDef(); as d) {
          <h3>{{ d.name }}</h3>
          <p>{{ d.briefing || d.description }}</p>
          @if (d.learning_objectives?.length) {
            <h4>Learning objectives</h4>
            <ul>
              @for (o of d.learning_objectives; track o) {
                <li>{{ o }}</li>
              }
            </ul>
          }
          @if (d.events.length) {
            <h4>Scripted events</h4>
            <table>
              <thead>
                <tr>
                  <th>t (s)</th>
                  <th>Target</th>
                  <th>Action</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                @for (ev of d.events; track $index) {
                  <tr>
                    <td class="num">{{ ev.time }}</td>
                    <td class="mono">{{ ev.target }}</td>
                    <td class="mono">{{ ev.action }}</td>
                    <td class="num">{{ ev.value ?? '' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        } @else {
          <p class="dim">Select a scenario to see its briefing.</p>
        }
      </section>

      <section class="panel instr">
        <h2>Instructor - manual fault injection</h2>
        <div class="chips">
          @for (inj of injections; track inj.label) {
            <button
              (click)="quickInject(inj)"
              [title]="inj.target + ' ' + inj.action + ' ' + inj.value"
            >
              {{ inj.label }} <em class="dim">{{ inj.hint }}</em>
            </button>
          }
        </div>
        <details>
          <summary>Custom injection</summary>
          <div class="form">
            <label
              >Target <input [(ngModel)]="form.target" placeholder="e.g. instrument.t_avg.A"
            /></label>
            <label
              >Action
              <select [(ngModel)]="form.action">
                <option>set</option>
                <option>ramp</option>
                <option>trip</option>
                <option>start</option>
                <option>stuck</option>
                <option>drift</option>
                <option>bias</option>
                <option>noise</option>
                <option>fail_low</option>
                <option>fail_high</option>
                <option>degrade</option>
                <option>restore</option>
              </select>
            </label>
            <label>Value <input type="number" step="0.001" [(ngModel)]="form.value" /></label>
            <label>Duration (s) <input type="number" step="1" [(ngModel)]="form.duration" /></label>
            <button (click)="customInject()">Inject</button>
          </div>
        </details>
        <div class="row">
          <button (click)="clearInjections()">Clear all manual injections</button>
        </div>
        @if (injectMsg(); as m) {
          <p class="dim sm">{{ m }}</p>
        }
      </section>

      <section class="panel">
        <h2>Session record &amp; replay</h2>
        <p class="dim sm">
          Every operator command is recorded with its simulation tick. Export a self-contained
          session (scenario + seed + action tape) and replay it later - the deterministic engine
          reproduces the run exactly.
        </p>
        <div class="row">
          <button (click)="exportSession()">Export current session</button>
          <button (click)="replaySession()" [disabled]="!sessionText.trim()">
            Load &amp; replay session
          </button>
        </div>
        <textarea
          [(ngModel)]="sessionText"
          rows="6"
          placeholder="Session JSON appears here on export; paste one here to replay"
        ></textarea>
        @if (sessionMsg(); as m) {
          <p class="sm" [class.err]="!sessionOk()">{{ m }}</p>
        }
      </section>

      <section class="panel">
        <h2>Import / export scenario JSON</h2>
        <p class="dim sm">Imported files are validated before use.</p>
        <textarea
          [(ngModel)]="importText"
          rows="8"
          placeholder="Paste scenario JSON here"
        ></textarea>
        <div class="row">
          <button (click)="importScenario()">Validate &amp; import</button>
          <button (click)="exportCurrent()" [disabled]="!currentJson()">
            Copy current scenario JSON
          </button>
        </div>
        @if (importMsg(); as m) {
          <p class="sm" [class.err]="!importOk()">{{ m }}</p>
        }
      </section>
    </div>
  `,
  styles: [
    `
      .layout {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
        align-items: start;
      }
      .scen {
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 6px 8px;
        margin-bottom: 4px;
        cursor: pointer;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .scen.sel {
        border-color: var(--accent);
        background: var(--panel-3);
      }
      .scen.custom {
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
      }
      .row {
        display: flex;
        gap: 8px;
        margin: 8px 0;
        flex-wrap: wrap;
      }
      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin: 8px 0;
      }
      .form {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: end;
      }
      .form label {
        display: flex;
        flex-direction: column;
        font-size: 10px;
        color: var(--text-dim);
      }
      textarea {
        width: 100%;
        font-family: var(--mono);
      }
      .sm {
        font-size: 10px;
      }
      .err {
        color: var(--alarm);
      }
      ul {
        margin: 4px 0 8px 18px;
      }
    `,
  ],
})
export class ScenarioComponent extends ViewBase implements OnInit {
  private readonly svc = inject(SimService);
  private readonly scenariosSvc = inject(ScenariosService);
  private readonly persistence = inject(PersistenceService);
  readonly injections = INJECTIONS;

  readonly scenarios = this.scenariosSvc.builtins;
  readonly customScenarios = this.persistence.customScenarios;
  readonly selectedFile = signal<string | null>(null);
  readonly selectedCustomId = signal<string | null>(null);
  readonly currentJson = signal<string | null>(null);
  readonly parsedDef = signal<(ScenarioDef & { briefing?: string; description?: string }) | null>(
    null,
  );

  readonly loadMsg = signal('');
  readonly loadOk = signal(true);
  readonly injectMsg = signal('');
  readonly importMsg = signal('');
  readonly importOk = signal(true);
  importText = '';
  readonly sessionMsg = signal('');
  readonly sessionOk = signal(true);
  sessionText = '';

  form: InjectForm = { target: '', action: 'stuck', value: 0, duration: 0 };

  ngOnInit(): void {
    void this.scenariosSvc.loadIndex();
    void this.persistence.refreshScenarios();
  }

  async select(file: string): Promise<void> {
    this.selectedFile.set(file);
    this.selectedCustomId.set(null);
    const json = await this.scenariosSvc.fetchBuiltin(file);
    this.currentJson.set(json);
    this.parsedDef.set(JSON.parse(json));
  }
  selectCustom(id: string): void {
    const s = this.customScenarios().find((x) => x.id === id);
    if (!s) return;
    this.selectedCustomId.set(id);
    this.selectedFile.set(null);
    this.currentJson.set(s.json);
    this.parsedDef.set(JSON.parse(s.json));
  }
  async deleteCustom(id: string, ev: Event): Promise<void> {
    ev.stopPropagation();
    await this.persistence.deleteScenario(id);
  }

  async startSelected(): Promise<void> {
    const json = this.currentJson();
    if (!json) return;
    const r = await this.svc.loadScenario(json);
    this.loadOk.set(r.ok);
    this.loadMsg.set(r.reason);
    if (r.ok) {
      this.persistence.updatePrefs({ lastScenarioFile: this.selectedFile() });
      this.svc.resume();
    }
  }
  async reset(): Promise<void> {
    const r = await this.svc.reset();
    this.loadOk.set(r.ok);
    this.loadMsg.set(r.reason);
  }

  async quickInject(inj: { target: string; action: string; value: number }): Promise<void> {
    const r = await this.svc.action({
      type: 'inject',
      time: 0,
      target: inj.target,
      action: inj.action,
      value: inj.value,
      label: `manual: ${inj.action} ${inj.target}`,
    });
    this.injectMsg.set(r.reason);
  }
  async customInject(): Promise<void> {
    const r = await this.svc.action({
      type: 'inject',
      time: 0,
      target: this.form.target,
      action: this.form.action,
      value: this.form.value,
      duration: this.form.duration,
      label: `manual: ${this.form.action} ${this.form.target}`,
    });
    this.injectMsg.set(r.reason);
  }
  async clearInjections(): Promise<void> {
    const r = await this.svc.action({ type: 'clear_injections' });
    this.injectMsg.set(r.reason);
  }

  async importScenario(): Promise<void> {
    const r = await this.scenariosSvc.importFile(this.importText);
    this.importOk.set(r.ok);
    this.importMsg.set(r.message);
    if (r.ok) await this.persistence.refreshScenarios();
  }
  async exportSession(): Promise<void> {
    const json = await this.svc.exportSession();
    this.sessionText = json;
    try {
      await navigator.clipboard.writeText(json);
      this.sessionMsg.set('Session exported and copied to clipboard.');
    } catch {
      this.sessionMsg.set('Session exported to the text box.');
    }
    this.sessionOk.set(true);
  }
  async replaySession(): Promise<void> {
    const r = await this.svc.loadSession(this.sessionText);
    this.sessionOk.set(r.ok);
    this.sessionMsg.set(r.reason);
  }

  async exportCurrent(): Promise<void> {
    const json = this.currentJson();
    if (!json) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(JSON.parse(json), null, 2));
      this.importMsg.set('Current scenario JSON copied to clipboard.');
      this.importOk.set(true);
    } catch {
      this.importText = JSON.stringify(JSON.parse(json), null, 2);
      this.importMsg.set('Clipboard unavailable - JSON placed in the text box.');
    }
  }
}
