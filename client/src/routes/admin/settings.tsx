import { useState } from 'react';
import { useLoaderData, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';

export async function adminSettingsLoader() {
  return admin.settings();
}

export function AdminSettings() {
  const { settings, server } = useLoaderData<typeof adminSettingsLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await admin.updateSettings(s);
      toast('Settings saved');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Settings</h1>
          <p className="muted small">Runtime switches live in the database and apply immediately. Server facts come from the environment.</p>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s-6)' }}>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Runtime</h2>
          <label className="row" style={{ gap: 10 }}>
            <input type="checkbox" checked={s.allowSignups} onChange={(e) => setS({ ...s, allowSignups: e.target.checked })} />
            <span>
              Allow new sign-ups <span className="muted small">— existing accounts always work</span>
            </span>
          </label>
          <div className="field">
            <label htmlFor="max">Generations per person per day</label>
            <input id="max" className="input" type="number" min={0} max={10000} value={s.maxGenerationsPerUserPerDay} onChange={(e) => setS({ ...s, maxGenerationsPerUserPerDay: Number(e.target.value) || 0 })} style={{ maxWidth: 160 }} />
            <p className="hint">0 means no limit. Each person pays their own vendor bill; this only caps runaway use.</p>
          </div>
          <div className="field">
            <label htmlFor="upload">Upload space per person (MB)</label>
            <input id="upload" className="input" type="number" min={0} max={100000} value={s.maxUploadMbPerUser} onChange={(e) => setS({ ...s, maxUploadMbPerUser: Number(e.target.value) || 0 })} style={{ maxWidth: 160 }} />
            <p className="hint">0 turns uploads off. Files are stored on this server’s disk.</p>
          </div>
          <div className="field">
            <label htmlFor="maint">Banner on the sign-in page</label>
            <input id="maint" className="input" value={s.maintenanceMessage} onChange={(e) => setS({ ...s, maintenanceMessage: e.target.value })} maxLength={300} placeholder="e.g. Down for maintenance tonight 10–11pm" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () => {
                await admin.purgeSessions();
                toast('Expired sessions purged');
              }}
            >
              Purge expired sessions
            </button>
          </div>
        </section>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Server</h2>
          <dl className="kv">
            <dt>Environment</dt>
            <dd>{server.env}</dd>
            <dt>Sign-in providers</dt>
            <dd>{server.providers.join(', ')}</dd>
            <dt>Mock provider</dt>
            <dd>{server.mockEnabled ? 'enabled (development only)' : 'off'}</dd>
            <dt>Claude model</dt>
            <dd>{server.models.anthropic}</dd>
            <dt>OpenAI model</dt>
            <dd>{server.models.openai}</dd>
            <dt>Uploads folder</dt>
            <dd style={{ wordBreak: 'break-all' }}>{server.uploadDir}</dd>
            <dt>First sign-in becomes admin</dt>
            <dd>{server.bootstrapFirstAdmin ? 'yes' : 'no'}</dd>
            <dt>Admin emails</dt>
            <dd>{server.adminEmails.join(', ') || '—'}</dd>
            <dt>Secure cookies</dt>
            <dd>{server.cookieSecure ? 'yes' : 'no (local HTTP)'}</dd>
          </dl>
          <p className="hint">Change these in .env and restart the API.</p>
        </section>
      </div>
    </>
  );
}
