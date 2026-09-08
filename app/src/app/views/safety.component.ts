import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { ViewBase } from './view-base';

@Component({
  selector: 'nol-safety',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="disclaimer">
      These Critical Safety Functions are an <strong>educational abstraction</strong>. They are
      <strong>not</strong> real emergency operating criteria, status trees, or safety-function
      acceptance limits, and must never be used as such. Each status is derived from several
      simulated signals to illustrate defence-in-depth thinking.
    </div>

    <div class="grid csfgrid">
      @for (c of csf(); track c.name) {
        <section class="panel csf" [class]="'edge-' + c.status.toLowerCase()">
          <div class="hd">
            <h3>{{ c.name }}</h3>
            <span class="st" [class]="'status-' + c.status.toLowerCase()">{{ c.status }}</span>
          </div>
          <p class="dim">Derived from: {{ c.basis }}</p>
          <p class="expl">{{ explain(c.name) }}</p>
        </section>
      }
    </div>

    <div class="panel">
      <h2>How the statuses are derived</h2>
      <table>
        <thead><tr><th>Function</th><th>NORMAL</th><th>DEGRADED</th><th>CHALLENGED</th></tr></thead>
        <tbody>
          <tr><td>Reactivity control</td><td>power ≤ 103% or tripped &amp; shut</td><td>power 103–108%</td><td>power &gt; 108% or failed to shut</td></tr>
          <tr><td>Core heat removal</td><td>flow ≥ 88%, T-avg ≤ 322 °C</td><td>flow &lt; 88% or T-avg &gt; 322 °C</td><td>T-avg &gt; 335 °C, or flow &lt; 20% while T-avg &gt; 315 °C</td></tr>
          <tr><td>Primary inventory</td><td>pzr 25–88%, 14–16.3 MPa</td><td>outside those bands</td><td>pzr &lt; 12% or &lt; 12.5 MPa</td></tr>
          <tr><td>Heat sink</td><td>both SG 35–82%</td><td>a SG outside that band</td><td>a SG &lt; 22%</td></tr>
          <tr><td>Electrical power</td><td>battery ≥ 70%</td><td>battery 30–70%</td><td>battery &lt; 30%</td></tr>
          <tr><td>Containment / barrier</td><td>pressure ≥ 13.5 MPa, T-avg ≤ 345 °C</td><td>pressure &lt; 13.5 MPa</td><td>pressure &lt; 11 MPa or T-avg &gt; 345 °C</td></tr>
        </tbody>
      </table>
      <p class="dim sm">UNKNOWN appears when redundant instrument channels disagree enough that the
        true state cannot be confirmed from the HMI — the point being that you cannot manage a
        safety function you cannot measure.</p>
    </div>
  `,
  styles: [
    `
      .csfgrid {
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        margin: 12px 0;
      }
      .csf .hd {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
      }
      .csf .st {
        font-family: var(--mono);
        font-weight: 700;
      }
      .edge-normal {
        border-left: 3px solid var(--ok);
      }
      .edge-degraded {
        border-left: 3px solid var(--degraded);
      }
      .edge-challenged {
        border-left: 3px solid var(--challenged);
      }
      .edge-unknown {
        border-left: 3px solid var(--unknown);
      }
      .expl {
        font-size: 12px;
      }
      .sm {
        font-size: 10px;
      }
    `,
  ],
})
export class SafetyComponent extends ViewBase {
  readonly csf = computed(() => this.snap()?.csf ?? []);
  private readonly notes: Record<string, string> = {
    'REACTIVITY CONTROL':
      'Is the fission chain reaction controlled and can it be shut down? Watch neutron power, its rate of change, rod position and — after a trip — that power has actually collapsed.',
    'CORE HEAT REMOVAL':
      'Is heat being carried away from the fuel? Needs coolant flow (pumps or natural circulation) and an acceptable core outlet temperature. Loss here is the most urgent problem after shutdown.',
    'PRIMARY INVENTORY':
      'Is there enough water in the reactor coolant system, at the right pressure, to keep the core covered and sub-cooled? Pressurizer level and primary pressure are the key indications.',
    'HEAT SINK':
      'Somewhere for the primary heat to go — normally the steam generators fed by feedwater, rejecting steam to the turbine, condenser, or atmosphere. Low SG level threatens this function.',
    'ELECTRICAL POWER':
      'Power for pumps, valves, instrumentation and control. Off-site supply, the main generator, emergency diesels, and finally the station battery form the defence in depth.',
    'CONTAINMENT / BARRIER STATUS':
      'A very abstract placeholder in this version: are the barriers between fuel and environment intact? Approximated here from primary pressure and temperature only.',
  };
  explain(name: string): string {
    return this.notes[name] ?? '';
  }
}
