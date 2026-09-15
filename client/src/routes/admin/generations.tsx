import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { admin } from '../../api/types';
import { dateTime } from '../../lib/format';

export async function adminGenerationsLoader({ request }: LoaderFunctionArgs) {
  const s = new URL(request.url).searchParams.get('status');
  return admin.generations(s === 'ok' || s === 'failed' ? s : undefined);
}

export function AdminGenerations() {
  const { generations } = useLoaderData<typeof adminGenerationsLoader>();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  return (
    <>
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
                <td className="muted" colSpan={8}>
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
