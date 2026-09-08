/// <reference lib="webworker" />
//
// Simulation Web Worker. Owns the Rust/WASM engine and a fixed-timestep logical
// clock that is decoupled from the wall clock.
//
// The clock advances in whole physics timesteps per publication frame, so the
// number of engine steps depends only on the number of frames elapsed (not on
// jittery timestamps). This keeps scenario runs reproducible and keeps Angular
// change-detection off the physics loop entirely.

import init, { Engine } from '../../wasm/nol_engine.js';
import type { FromWorker, ToWorker } from './protocol';
import { SNAPSHOT_HZ } from './protocol';
import type { Snapshot } from './sim.types';

let engine: Engine | null = null;
let dt = 0.02;
let running = false;
let speed = 1;
let acc = 0; // fractional simulated-seconds carry
let debug = false;
let currentScenario = 'baseline';
let currentSeed = 0;

const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);

function publish(): void {
  if (!engine) return;
  try {
    const snap = JSON.parse(engine.snapshot()) as Snapshot;
    post({ type: 'snapshot', snapshot: snap });
  } catch (e) {
    post({ type: 'error', message: `snapshot failed: ${String(e)}` });
  }
}

function frame(): void {
  if (engine && running) {
    acc += speed / SNAPSHOT_HZ;
    let steps = Math.floor(acc / dt);
    if (steps > 5000) steps = 5000; // guard against runaway after a stall
    if (steps > 0) {
      acc -= steps * dt;
      try {
        engine.step(steps);
      } catch (e) {
        running = false;
        post({ type: 'error', message: `engine.step failed: ${String(e)}` });
      }
    }
  }
  publish();
}

function makeEngine(scenarioJson: string, seed: number): void {
  engine?.free();
  engine = new Engine(scenarioJson, seed);
  engine.set_debug(debug);
  dt = engine.dt;
  acc = 0;
  running = false;
  engine.set_running(false);
  engine.set_speed(speed);
  currentScenario = scenarioJson;
  currentSeed = seed;
}

self.addEventListener('message', async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        await init();
        makeEngine('baseline', 0);
        post({ type: 'ready', dt });
        publish();
        setInterval(frame, Math.round(1000 / SNAPSHOT_HZ));
        break;
      }
      case 'clock': {
        const c = msg.cmd;
        if (c.kind === 'pause') running = false;
        else if (c.kind === 'resume') running = true;
        else if (c.kind === 'set-speed') speed = Math.max(0, Math.min(20, c.speed));
        else if (c.kind === 'step-once') {
          if (engine) {
            engine.step(Math.round(0.2 / dt));
          }
        }
        // Mirror clock state into the engine so it appears in the snapshot.
        engine?.set_running(running);
        engine?.set_speed(speed);
        publish();
        break;
      }
      case 'action': {
        if (!engine) return;
        const res = JSON.parse(engine.action(msg.json)) as { ok: boolean; reason: string };
        // When paused, advance a single timestep so the control/protection loop
        // processes the command and the operator sees its effect immediately.
        if (!running && res.ok) engine.step(1);
        post({ type: 'command-result', id: msg.id, ok: res.ok, reason: res.reason });
        publish();
        break;
      }
      case 'load-scenario': {
        if (!engine) return;
        // Validate by attempting a load on the live engine first.
        const res = JSON.parse(engine.load_scenario(msg.json)) as { ok: boolean; reason: string };
        if (res.ok) {
          makeEngine(msg.json.trim() === '' ? 'baseline' : msg.json, 0);
        }
        post({ type: 'command-result', id: msg.id, ok: res.ok, reason: res.reason });
        publish();
        break;
      }
      case 'reset': {
        makeEngine(currentScenario, currentSeed);
        post({ type: 'command-result', id: msg.id, ok: true, reason: 'Simulation reset.' });
        publish();
        break;
      }
      case 'export-session': {
        if (!engine) return;
        post({ type: 'session', id: msg.id, json: engine.export_session() });
        break;
      }
      case 'load-session': {
        if (!engine) return;
        const res = JSON.parse(engine.load_session(msg.json)) as { ok: boolean; reason: string };
        running = false;
        engine.set_running(false);
        engine.set_speed(speed);
        post({ type: 'command-result', id: msg.id, ok: res.ok, reason: res.reason });
        publish();
        break;
      }
      case 'set-debug': {
        debug = msg.on;
        engine?.set_debug(debug);
        publish();
        break;
      }
      case 'request-snapshot': {
        publish();
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', message: String(e) });
  }
});
