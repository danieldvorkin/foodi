import { AppSettingsSchema, type AppSettings } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, run } from '../db/index.js';
import { now } from '../lib/time.js';

const DEFAULTS: AppSettings = { allowSignups: true, maintenanceMessage: '', maxGenerationsPerUserPerDay: 50, maxUploadMbPerUser: 500, housePostsPerDay: 2, paymentsEnabled: true, promotionsEnabled: true, platformFeePercent: 20, openaiManagedKeys: true, managedGenerationsPerUserPerDay: 10, managedImages: false };

export function createSettings(db: Db) {
  function get(): AppSettings {
    const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
    const raw: Record<string, unknown> = { ...DEFAULTS };
    for (const r of rows) {
      try {
        raw[r.key] = JSON.parse(r.value);
      } catch {
        /* ignore corrupt row */
      }
    }
    const parsed = AppSettingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : DEFAULTS;
  }
  function update(patch: { [K in keyof AppSettings]?: AppSettings[K] | undefined }): AppSettings {
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const next = AppSettingsSchema.parse({ ...get(), ...clean });
    for (const [k, v] of Object.entries(next)) {
      run(
        db,
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        k,
        JSON.stringify(v),
        now(),
      );
    }
    return next;
  }
  return { get, update };
}
export type Settings = ReturnType<typeof createSettings>;
