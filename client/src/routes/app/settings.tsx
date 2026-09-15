import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { auth, profile as profileApi, social } from '../../api/types';
import { ProfileForm } from '../../components/ProfileForm';
import { useToast } from '../../components/Toast';
import { useMe } from './layout';

export async function settingsLoader() {
  const [p, s] = await Promise.all([profileApi.get(), social.myProfile()]);
  return { profile: p.profile, social: s.profile };
}

const VENDOR_LABEL = { anthropic: 'Claude (Anthropic API key)', openai: 'OpenAI', mock: 'Mock account (development)' } as const;

export function SettingsPage() {
  const data = useLoaderData<typeof settingsLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [tab, setTab] = useState<'answers' | 'profile' | 'account'>('answers');
  const [handle, setHandle] = useState(data.social.handle);
  const [bio, setBio] = useState(data.social.bio);
  const [busy, setBusy] = useState(false);

  async function saveAnswers(p: NonNullable<typeof data.profile>) {
    setBusy(true);
    try {
      await profileApi.save(p);
      toast('Answers saved');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveSocial() {
    setBusy(true);
    try {
      await social.updateProfile(handle.trim().toLowerCase(), bio.trim());
      toast('Profile saved');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (!window.confirm('Delete your account, recipes, posts and connected key? This cannot be undone.')) return;
    try {
      await auth.deleteAccount();
      nav('/', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="page-narrow stack-lg">
      <h1>Settings</h1>
      <div className="chips" role="tablist">
        {(['answers', 'profile', 'account'] as const).map((t) => (
          <button key={t} type="button" role="tab" className="chip" aria-selected={tab === t} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {t === 'answers' ? 'Your answers' : t === 'profile' ? 'Public profile' : 'Account'}
          </button>
        ))}
      </div>

      {tab === 'answers' && data.profile && (
        <section className="stack">
          <p className="muted">Every recipe is written against these.</p>
          <ProfileForm initial={data.profile} onSave={saveAnswers} busy={busy} />
        </section>
      )}

      {tab === 'profile' && (
        <section className="stack">
          <p className="muted">
            What others see on the feed. Your page:{' '}
            <Link to={`/app/u/${data.social.handle}`}>@{data.social.handle}</Link>
          </p>
          <div className="field">
            <label htmlFor="handle">Handle</label>
            <input id="handle" className="input" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={20} pattern="[a-z0-9_]{3,20}" />
            <p className="hint">3–20 lowercase letters, numbers or underscores.</p>
          </div>
          <div className="field">
            <label htmlFor="bio">Bio</label>
            <textarea id="bio" className="textarea" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={240} placeholder="What you like to cook" />
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={saveSocial} disabled={busy || !/^[a-z0-9_]{3,20}$/.test(handle.trim().toLowerCase())}>
              Save profile
            </button>
          </div>
        </section>
      )}

      {tab === 'account' && (
        <section className="stack-lg">
          <div className="stack">
            <h3>Connected AI</h3>
            <p>
              {VENDOR_LABEL[me.vendor]} · {me.credentialKind === 'oauth' ? 'signed in with OAuth' : 'API key, encrypted at rest'}
            </p>
            <p className="muted small">Recipes are generated with this account. Connecting a different key replaces it.</p>
            <div className="row">
              <Link to="/connect/anthropic" className="btn btn-sm">
                Connect a Claude key
              </Link>
              <Link to="/connect/openai" className="btn btn-sm">
                Connect an OpenAI key
              </Link>
            </div>
          </div>
          <div className="stack">
            <h3>Sessions</h3>
            <p className="muted small">Signed in as {me.email ?? me.displayName ?? me.id}. Role: {me.role}.</p>
            <div className="row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  await auth.logoutEverywhere();
                  nav('/', { replace: true });
                }}
              >
                Sign out everywhere
              </button>
            </div>
          </div>
          <div className="stack">
            <h3>Delete account</h3>
            <p className="muted small">Removes your answers, recipes, posts, comments and the connected key. Other people’s saved copies of your recipes stay with them.</p>
            <div className="row">
              <button type="button" className="btn btn-danger btn-sm" onClick={deleteAccount}>
                Delete my account
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
