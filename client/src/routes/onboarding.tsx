import { useState } from 'react';
import { redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { emptyProfile, ProfileSchema, type Profile } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { profile as profileApi } from '../api/types';
import { Wordmark } from '../components/Logo';
import { ProfileStep, STEPS } from '../components/ProfileForm';
import { useToast } from '../components/Toast';
import { requireMe } from '../lib/session';

export async function onboardingLoader({ request }: LoaderFunctionArgs) {
  const me = await requireMe(request);
  if (me.hasProfile) throw redirect('/app');
  return { me };
}

export function Onboarding() {
  const { me } = useLoaderData<typeof onboardingLoader>();
  const nav = useNavigate();
  const toast = useToast();
  const [i, setI] = useState(0);
  const [value, setValue] = useState<Profile>({ ...emptyProfile, displayName: me.displayName ?? '' });
  const [busy, setBusy] = useState(false);
  const step = STEPS[i]!;
  const last = i === STEPS.length - 1;
  const stepValid = step.id === 'you' ? value.displayName.trim().length > 0 : true;

  async function finish() {
    const parsed = ProfileSchema.safeParse(value);
    if (!parsed.success) {
      toast('Something in your answers needs a look.', 'error');
      return;
    }
    setBusy(true);
    try {
      await profileApi.save(parsed.data);
      nav(me.vendor ? '/app' : '/connect', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="onb">
      <header className="onb-top">
        <Wordmark />
        <span className="muted small num">
          {i + 1} of {STEPS.length}
        </span>
      </header>
      <div className="onb-progress" aria-hidden="true">
        <span style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
      </div>
      <main className="onb-main">
        <div className="onb-card" key={step.id}>
          <h1>{step.title}</h1>
          <p className="muted">{step.lead}</p>
          <div className="onb-body">
            <ProfileStep step={step.id} value={value} onChange={setValue} />
          </div>
          <div className="onb-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0}>
              Back
            </button>
            {last ? (
              <button type="button" className="btn btn-primary btn-lg" onClick={finish} disabled={busy || !stepValid}>
                {busy ? 'Saving…' : me.vendor ? 'Save and start cooking' : 'Save and connect your AI'}
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-lg" onClick={() => setI((x) => x + 1)} disabled={!stepValid}>
                Next
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
