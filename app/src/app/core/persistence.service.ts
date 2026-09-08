import { Injectable, signal } from '@angular/core';

/**
 * Local-only persistence. Preferences and small state live in localStorage;
 * custom scenarios (potentially larger, and user-imported) live in IndexedDB.
 * Nothing ever leaves the browser.
 */
export interface Preferences {
  debugMode: boolean;
  beginnerMode: boolean;
  /** Seen the welcome screen at least once. */
  onboarded: boolean;
  /** Lesson ids the user has completed. */
  lessonsDone: string[];
  confirmCritical: boolean;
  defaultSpeed: number;
  lastScenarioFile: string | null;
  trendVars: string[];
  trendWindow: number;
  favouritePanels: string[];
}

const DEFAULT_PREFS: Preferences = {
  debugMode: false,
  beginnerMode: true,
  onboarded: false,
  lessonsDone: [],
  confirmCritical: true,
  defaultSpeed: 1,
  lastScenarioFile: null,
  trendVars: ['neutron_power', 't_avg', 'primary_pressure', 'sg1_level'],
  trendWindow: 300,
  favouritePanels: [],
};

const PREFS_KEY = 'nol.prefs.v1';
const DB_NAME = 'nol-lab';
const STORE = 'scenarios';

export interface StoredScenario {
  id: string;
  name: string;
  json: string;
  savedAt: number;
}

@Injectable({ providedIn: 'root' })
export class PersistenceService {
  readonly prefs = signal<Preferences>(this.loadPrefs());
  readonly customScenarios = signal<StoredScenario[]>([]);

  constructor() {
    void this.refreshScenarios();
  }

  private loadPrefs(): Preferences {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Preferences>) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  updatePrefs(patch: Partial<Preferences>): void {
    const next = { ...this.prefs(), ...patch };
    this.prefs.set(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }

  // ---- IndexedDB helpers ----
  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async refreshScenarios(): Promise<void> {
    try {
      const db = await this.open();
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        this.customScenarios.set((req.result as StoredScenario[]).sort((a, b) => b.savedAt - a.savedAt));
      };
    } catch {
      this.customScenarios.set([]);
    }
  }

  async saveScenario(s: StoredScenario): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(s);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await this.refreshScenarios();
  }

  async deleteScenario(id: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await this.refreshScenarios();
  }
}
