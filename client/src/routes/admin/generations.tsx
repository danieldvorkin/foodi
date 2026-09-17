import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';

export async function adminGenerationsLoader({ request }: LoaderFunctionArgs) {
  const s = new URL(request.url).searchParams.get('status');
  const [gens, jobs] = await Promise.all([admin.generations(s === 'ok' || s === 'failed' ? s : undefined), admin.jobs()]);
  return { ...gens, jobs: jobs.jobs, counts: jobs.counts };
}

export function AdminGenerations() {
  const { generations, jobs, counts } = useLoaderData<typeof adminGenerationsLoader>();
  const [params, setParams] = useSearchParams();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const status = params.get('status') ?? '';
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast(done);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <>
      <section className="stack" style={{ marginBottom: 'var(--s-6)' }}>
        <div className="row-between">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Background jobs</h2>
          <p className="muted small">
            {counts.running} running · {counts.queued} queued · {counts.failed} failed
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Prompt</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th>Last error</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 50).map((j) => (
                <tr key={j.id}>
                  <td className="muted small">{j.id}</td>
                  <td className="wrap">{j.recipeId ? <Link to={`/app/recipes/${j.recipeId}`}>{j.recipeTitle ?? j.prompt}</Link> : j.prompt}</td>
                  <td>{j.status}</td>
                  <td className="num">
                    {j.attempts}/{j.maxAttempts}
                  </td>
                  <td className="wrap muted small">{j.lastError ? `${j.lastErrorCode ?? ''} ${j.lastError}` : '—'}</td>
                  <td>{dateTime(j.createdAt)}</td>
                  <td>
                    {(j.status === 'failed' || j.status === 'cancelled') && (
                      <button type="button" className="btn btn-sm" onClick={() => act(() => admin.retryJob(j.id), 'Requeued')}>
                        Retry
                      </button>
                    )}
                    {j.status === 'queued' && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => act(() => admin.cancelJob(j.id), 'Cancelled')}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td className="muted" colSpan={7}>
                    No jobs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <div className="admin-head">
        <div>
          <h1>Generations</h1>
          <p className="muted small">Every call to a vendor on someone’s behalf. Prompts and keys are never stored here.</p>
        </div>
        <div className="chips">
          {[
            ['', 'All'],
            ['ok', 'Succeeded'],
            ['failed', 'Failed'],
          ].map(([v, l]) => (
            <button key={v} type="button" className="chip" aria-pressed={status === v} onClick={() => setParams(v ? { status: v! } : {})}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Kind</th>
              <th>Person</th>
              <th>Vendor</th>
              <th>Model</th>
              <th>Status</th>
              <th className="num">Latency</th>
              <th className="num">Tokens in/out</th>
              <th>Recipe</th>
            </tr>
          </thead>
          <tbody>
            {generations.map((g) => (
              <tr key={g.id}>
                <td>{dateTime(g.createdAt)}</td>
                <td>{g.kind === 'image' ? '🖼️ image' : g.kind === 'vision' ? '👁️ check' : '📝 recipe'}</td>
                <td>
                  <Link to={`/admin/users/${g.userId}`}>{g.userDisplayName ?? g.userId}</Link>
                </td>
                <td>{g.vendor}</td>
                <td>{g.model}</td>
                <td className={`status-${g.status}`}>{g.status === 'ok' ? 'ok' : g.errorCode}</td>
                <td className="num">{(g.latencyMs / 1000).toFixed(1)}s</td>
                <td className="num">
                  {g.inputTokens ?? '—'}/{g.outputTokens ?? '—'}
                </td>
                <td>{g.recipeId ? <Link to={`/app/recipes/${g.recipeId}`}>open</Link> : '—'}</td>
              </tr>
            ))}
            {generations.length === 0 && (
              <tr>
                <td className="muted" colSpan={9}>
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
