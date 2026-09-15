import { redirect } from 'react-router';
import { ApiError } from '../api/client';
import { auth, type Me } from '../api/types';

/** Loader helper: the signed-in person, or a redirect to the landing page. */
export async function requireMe(request: Request): Promise<Me> {
  try {
    return await auth.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const url = new URL(request.url);
      const returnTo = url.pathname + url.search;
      throw redirect(`/?returnTo=${encodeURIComponent(returnTo)}`);
    }
    throw e;
  }
}

export async function requireOnboarded(request: Request): Promise<Me> {
  const me = await requireMe(request);
  if (!me.hasProfile) throw redirect('/onboarding');
  return me;
}

export async function requireAdmin(request: Request): Promise<Me> {
  const me = await requireOnboarded(request);
  if (me.role !== 'admin') throw redirect('/app');
  return me;
}

export async function maybeMe(): Promise<Me | null> {
  try {
    return await auth.me();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}
