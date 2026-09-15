import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator, useSearchParams } from 'react-router';
import { errorMessage } from '../../api/client';
import { auth, profile as profileApi, social } from '../../api/types';
import { AVATAR_EMOJI } from '@foodi/shared';
import { ProfileForm } from '../../components/ProfileForm';
import { Avatar, EmojiPicker } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useMe } from './layout';

export async function settingsLoader() {
  const [p, s, prov] = await Promise.all([profileApi.get(), social.myProfile(), auth.providers()]);
  return { profile: p.profile, social: s.profile, providers: prov.providers };
}

const VENDOR_LABEL = { anthropic: 'Claude (Anthropic API key)', openai: 'OpenAI', mock: 'Mock account (development)' } as const;

export function SettingsPage() {
  const data = useLoaderData<typeof settingsLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<'answers' | 'profile' | 'account'>(params.get('error') || params.get('tab') === 'account' ? 'account' : 'answers');
  const linkError = params.get('error');
  const [handle, setHandle] = useState(data.social.handle);
  const [bio, setBio] = useState(data.social.bio);
  const [avatar, setAvatar] = useState(data.social.avatar);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', email: me.email ?? '' });
  const hasPassword = me.signInMethods.includes('password');
  const ssoLinks = data.providers.filter((p) => p.kind === 'oauth' && !me.signInMethods.includes(p.id));

  async function changePassword() {
    setBusy(true);
    try {
      await auth.changePassword(pw.next, hasPassword ? pw.current : undefined, hasPassword ? undefined : pw.email.trim().toLowerCase());
      setPw({ current: '', next: '', email: pw.email });
      toast(hasPassword ? 'Password changed. Other devices were signed out.' : 'Password set. You can sign in with your email now.');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

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
      await social.updateProfile(handle.trim().toLowerCase(), bio.trim(), avatar);
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
      {linkError && <div className="notice notice-warn">{linkError}</div>}
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
            <span className="label">Avatar</span>
            <div className="row" style={{ gap: 'var(--s-4)' }}>
              <Avatar name={me.displayName ?? ''} emoji={avatar} size="lg" />
              <EmojiPicker options={AVATAR_EMOJI} value={avatar} onChange={setAvatar} allowCustom />
            </div>
          </div>
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
            <h3>🔌 Connected AI</h3>
            {me.vendor ? (
              <p>
                {VENDOR_LABEL[me.vendor]} · {me.credentialKind === 'oauth' ? 'linked account' : 'API key, encrypted at rest'}
              </p>
            ) : (
              <p className="muted">Nothing connected yet — recipes can’t be written until you connect one.</p>
            )}
            <p className="muted small">Recipes are generated with this account and billed to it, never to foodi. Connecting a different one replaces it.</p>
            <div className="row">
              <Link to="/connect" className="btn btn-sm">
                {me.vendor ? 'Change' : 'Connect'}
              </Link>
              {me.vendor && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={async () => {
                    await auth.disconnectKey();
                    toast('Disconnected');
                    revalidate();
                    nav('.', { replace: true });
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </div>
          <div className="stack">
            <h3>🔑 Sign-in</h3>
            <p className="muted small">
              Signed in as {me.email ?? me.displayName ?? me.id} · methods: {me.signInMethods.join(', ')} · role: {me.role}
            </p>
            <form
              className="stack"
              style={{ maxWidth: 380 }}
              onSubmit={(e) => {
                e.preventDefault();
                changePassword();
              }}
            >
              {!hasPassword && <p className="small">Add an email and password so you can sign in without the provider.</p>}
              {!hasPassword && (
                <div className="field">
                  <label htmlFor="pw-email">Email</label>
                  <input id="pw-email" className="input" type="email" autoComplete="email" value={pw.email} onChange={(e) => setPw({ ...pw, email: e.target.value })} required />
                </div>
              )}
              {hasPassword && (
                <div className="field">
                  <label htmlFor="pw-current">Current password</label>
                  <input id="pw-current" className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
                </div>
              )}
                <div className="field">
                  <label htmlFor="pw-next">New password</label>
                  <input id="pw-next" className="input" type="password" autoComplete="new-password" minLength={10} maxLength={200} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
                </div>
              <div className="row">
                <button type="submit" className="btn btn-sm" disabled={busy || pw.next.length < 10 || (hasPassword ? !pw.current : !pw.email)}>
                  {hasPassword ? 'Change password' : 'Set password'}
                </button>
              </div>
            </form>
            {ssoLinks.length > 0 && (
              <div className="row">
                {ssoLinks.map((p) => (
                  <a key={p.id} className="btn btn-sm" href={`/api/auth/${p.id}/start?returnTo=${encodeURIComponent('/app/settings')}`}>
                    Link {p.label.replace(/^Continue with (a )?/, '')}
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="stack">
            <h3>Sessions</h3>
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
