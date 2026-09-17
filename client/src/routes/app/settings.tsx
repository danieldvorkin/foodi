import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator, useSearchParams } from 'react-router';
import { errorMessage } from '../../api/client';
import { auth, profile as profileApi, social } from '../../api/types';
import { timeAgo } from '../../lib/format';
import { AVATAR_EMOJI } from '@foodi/shared';
import { ProfileForm } from '../../components/ProfileForm';
import { Avatar, EmojiPicker } from '../../components/ui';
import { useToast } from '../../components/Toast';
import { useMe } from './layout';

export async function settingsLoader() {
  const [p, s, prov] = await Promise.all([profileApi.get(), social.myProfile(), auth.providers()]);
  return { profile: p.profile, social: s.profile, providers: prov.providers };
}

const VENDOR_LABEL = { anthropic: 'Claude (Anthropic)', openai: 'OpenAI', mock: 'Mock account (development)' } as const;
const KEY_COPY = {
  anthropic: { name: 'Claude', where: 'console.anthropic.com → API keys', href: 'https://console.anthropic.com/settings/keys', prefix: 'sk-ant-…', emoji: '🅰️' },
  openai: { name: 'OpenAI', where: 'platform.openai.com → API keys', href: 'https://platform.openai.com/api-keys', prefix: 'sk-…', emoji: '🤖' },
} as const;
type Tab = 'answers' | 'profile' | 'ai' | 'account';
const TABS: [Tab, string][] = [
  ['answers', '🍽️ Your answers'],
  ['profile', '🧑‍🍳 Public profile'],
  ['ai', '🔌 AI keys'],
  ['account', '🔑 Account'],
];
function tabFrom(v: string | null): Tab {
  return v === 'profile' || v === 'ai' || v === 'account' ? v : 'answers';
}

export function SettingsPage() {
  const data = useLoaderData<typeof settingsLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('error') ? 'ai' : tabFrom(params.get('tab')));
  const [keyVendor, setKeyVendor] = useState<'anthropic' | 'openai'>(me.vendor === 'openai' ? 'openai' : 'anthropic');
  const [key, setKey] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const oauthLinks = data.providers.filter((p) => p.kind === 'oauth');
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
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" className="chip" aria-selected={tab === t} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'ai' && (
        <section className="stack-lg">
          <div className="stack">
            <h3>🔌 Connected AI</h3>
            {me.vendor ? (
              <div className="notice notice-sage">
                <b>{VENDOR_LABEL[me.vendor]}</b>
                {me.credentialKind === 'api_key' ? ` · key ending in …${me.credentialHint ?? '????'}` : ' · linked account'}
                {me.credentialUpdatedAt ? ` · updated ${timeAgo(me.credentialUpdatedAt)}` : ''}
              </div>
            ) : (
              <div className="notice notice-warn">Nothing connected yet — recipes can’t be written until you add a key below.</div>
            )}
            <p className="muted small measure">
              Recipes are written with this account and billed to it, never to foodi. The key is encrypted with AES-256-GCM on this machine, only decrypted to call the vendor, and never shown again — only its last four characters are kept in the clear.
            </p>
          </div>

          <div className="stack" style={{ maxWidth: 560 }}>
            <h3>✨ Photos</h3>
            <label className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
              <input
                type="checkbox"
                checked={me.autoPhotos}
                style={{ marginTop: 4 }}
                onChange={async (e) => {
                  try {
                    await auth.prefs({ autoPhotos: e.target.checked });
                    toast(e.target.checked ? 'Photos on' : 'Photos off');
                    revalidate();
                  } catch (err) {
                    toast(errorMessage(err), 'error');
                  }
                }}
              />
              <span>
                Also give each recipe the AI writes a cover photo
                <span className="muted small" style={{ display: 'block' }}>
                  {me.aiCapabilities.images
                    ? 'Generated after the recipe and checked by a vision model against the dish before it’s shown, billed to your account (roughly a few cents each). You can always swap or delete it.'
                    : me.vendor === 'anthropic'
                      ? 'Claude can’t make pictures, so a photo of the dish is found in a photo library instead and Claude checks it (a fraction of a cent). Connect an OpenAI key to generate photos.'
                      : 'A photo of the dish is found in a photo library after the recipe is written. Connect an AI that can generate images (OpenAI) to make them instead.'}
                </span>
              </span>
            </label>
          </div>

          <form
            className="stack"
            style={{ maxWidth: 460 }}
            onSubmit={async (e) => {
              e.preventDefault();
              setKeyBusy(true);
              try {
                await auth.connectKey(keyVendor, key.trim());
                setKey('');
                toast(`${KEY_COPY[keyVendor].name} key ${me.vendor ? 'updated' : 'connected'}`);
                revalidate();
              } catch (err) {
                toast(errorMessage(err), 'error');
              } finally {
                setKeyBusy(false);
              }
            }}
          >
            <h3>{me.vendor && me.credentialKind === 'api_key' ? 'Update your key' : 'Add a key'}</h3>
            <div className="field">
              <span className="label">Vendor</span>
              <div className="chips" role="radiogroup">
                {(['anthropic', 'openai'] as const).map((v) => (
                  <button key={v} type="button" role="radio" className="chip" aria-checked={keyVendor === v} onClick={() => setKeyVendor(v)}>
                    {KEY_COPY[v].emoji} {KEY_COPY[v].name}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="ai-key">{KEY_COPY[keyVendor].name} API key</label>
              <input id="ai-key" className="input" type="password" autoComplete="off" spellCheck={false} placeholder={KEY_COPY[keyVendor].prefix} value={key} onChange={(e) => setKey(e.target.value)} minLength={20} required />
              <p className="hint">
                Create one at{' '}
                <a href={KEY_COPY[keyVendor].href} target="_blank" rel="noreferrer noopener">
                  {KEY_COPY[keyVendor].where}
                </a>
                . It’s checked with one request, then encrypted. Saving replaces whatever is connected now.
              </p>
            </div>
            <div className="row">
              <button type="submit" className="btn btn-primary" disabled={keyBusy || key.trim().length < 20}>
                {keyBusy ? 'Checking key…' : me.vendor ? 'Replace key' : 'Connect'}
              </button>
              {me.vendor && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={async () => {
                    if (!window.confirm('Disconnect the AI account? You can add a key again any time.')) return;
                    await auth.disconnectKey();
                    toast('Disconnected');
                    revalidate();
                  }}
                >
                  Disconnect
                </button>
              )}
            </div>
          </form>

          {oauthLinks.length > 0 && (
            <div className="stack">
              <h3>Or link an account</h3>
              <div className="row">
                {oauthLinks.map((p) => (
                  <a key={p.id} className="btn btn-sm" href={`/api/auth/${p.id}/start?returnTo=${encodeURIComponent('/app/settings?tab=ai')}`}>
                    {p.vendor === 'mock' ? '🧪 Mock account (dev)' : p.label.replace(/^Continue with (a )?/, 'Link ')}
                  </a>
                ))}
              </div>
              <p className="hint">Linking an account uses it both to sign in and to write recipes.</p>
            </div>
          )}
        </section>
      )}

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
