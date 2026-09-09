import { Injectable, inject, signal } from '@angular/core';
import { PersistenceService } from './persistence.service';

export interface ScenarioIndexEntry {
  file: string;
  id: string;
  name: string;
  description: string;
  initial: string;
  events: number;
}

export interface ScenarioEventDef {
  time: number;
  target: string;
  action: string;
  value?: number;
  duration?: number;
  recover_after?: number;
  label?: string;
}

export interface ScenarioDef {
  id: string;
  name: string;
  description?: string;
  initial?: string;
  seed?: number;
  briefing?: string;
  learning_objectives?: string[];
  events: ScenarioEventDef[];
}

const ALLOWED_ACTIONS = new Set([
  'set', 'ramp', 'trip', 'start', 'stop', 'stuck', 'drift', 'bias', 'noise',
  'fail', 'fail_low', 'fail_high', 'degrade', 'restore', 'clear', 'loss',
  'inhibit', 'actuate', 'withdraw', 'insert', 'hold',
]);

/**
 * Validate an imported scenario file. Imported JSON is untrusted input: we check
 * structure, ranges and the target/action vocabulary before it is ever handed
 * to the engine.
 */
export function validateScenario(
  raw: string,
): { ok: true; def: ScenarioDef } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${String(e)}` };
  }
  if (typeof parsed !== 'object' || parsed === null) return { ok: false, error: 'Top-level value must be an object.' };
  const o = parsed as Record<string, unknown>;
  if (typeof o['id'] !== 'string' || o['id'].trim() === '') return { ok: false, error: 'Missing "id".' };
  if (typeof o['name'] !== 'string' || o['name'].trim() === '') return { ok: false, error: 'Missing "name".' };
  if (o['initial'] !== undefined && o['initial'] !== 'hot_full_power' && o['initial'] !== 'hot_standby') {
    return { ok: false, error: '"initial" must be "hot_full_power" or "hot_standby".' };
  }
  const events = o['events'];
  if (!Array.isArray(events)) return { ok: false, error: '"events" must be an array.' };
  if (events.length > 500) return { ok: false, error: 'Too many events (max 500).' };
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] as Record<string, unknown>;
    if (typeof ev['time'] !== 'number' || !isFinite(ev['time']) || ev['time'] < 0 || ev['time'] > 100000) {
      return { ok: false, error: `Event ${i}: "time" out of range.` };
    }
    if (typeof ev['target'] !== 'string' || ev['target'].length > 64) {
      return { ok: false, error: `Event ${i}: bad "target".` };
    }
    if (typeof ev['action'] !== 'string' || !ALLOWED_ACTIONS.has(ev['action'])) {
      return { ok: false, error: `Event ${i}: unknown "action" "${String(ev['action'])}".` };
    }
    for (const k of ['value', 'duration', 'recover_after']) {
      const v = ev[k];
      if (v !== undefined && (typeof v !== 'number' || !isFinite(v))) {
        return { ok: false, error: `Event ${i}: "${k}" must be a finite number.` };
      }
    }
    if (!/^[a-z0-9_.]+$/i.test(ev['target'] as string)) {
      return { ok: false, error: `Event ${i}: "target" has invalid characters.` };
    }
  }
  return { ok: true, def: parsed as ScenarioDef };
}

@Injectable({ providedIn: 'root' })
export class ScenariosService {
  private readonly persistence = inject(PersistenceService);
  readonly builtins = signal<ScenarioIndexEntry[]>([]);

  async loadIndex(): Promise<void> {
    try {
      const res = await fetch('scenarios/index.json');
      this.builtins.set((await res.json()) as ScenarioIndexEntry[]);
    } catch {
      this.builtins.set([]);
    }
  }

  async fetchBuiltin(file: string): Promise<string> {
    const res = await fetch(`scenarios/${file}`);
    if (!res.ok) throw new Error(`Cannot load scenario '${file}'`);
    return res.text();
  }

  validate = validateScenario;

  async importFile(raw: string): Promise<{ ok: boolean; message: string }> {
    const v = validateScenario(raw);
    if (!v.ok) return { ok: false, message: v.error };
    await this.persistence.saveScenario({
      id: v.def.id,
      name: v.def.name,
      json: JSON.stringify(v.def),
      savedAt: Date.now(),
    });
    return { ok: true, message: `Imported "${v.def.name}".` };
  }
}
