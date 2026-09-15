import { Link, useLoaderData } from 'react-router';
import { admin } from '../../api/types';
import { dateTime } from '../../lib/format';

export async function adminOverviewLoader() {
  const [stats, gens] = await Promise.all([admin.stats(), admin.generations('failed')]);
  return { stats, failures: gens.generations.slice(0, 8) };
}

export function AdminOverview() {
  const { stats, failures } = useLoaderData<typeof adminOverviewLoader>();
  const max = Math.max(1, ...stats.generationsByDay.map((d) => d.ok + d.failed));
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Overview</h1>
          <p className="muted small">Last 7 days unless noted.</p>
        </div>
      </div>

      <div className="numbers">
        <div>
          <div className="n num">{stats.users}</div>
          <div className="l">people ({stats.admins} admin{stats.admins === 1 ? '' : 's'}{stats.disabledUsers ? `, ${stats.disabledUsers} disabled` : ''})</div>
        </div>
        <div>
          <div className="n num">{stats.recipes}</div>
          <div className="l">recipes, all time</div>
        </div>
        <div>
          <div className="n num">{stats.mediaCount}</div>
          <div className="l">photos & videos ({(stats.mediaBytes / 1024 / 1024).toFixed(0)} MB)</div>
        </div>
        <div>
          <div className="n num">{stats.generations7d}</div>
          <div className="l">generations</div>
        </div>
        <div>
          <div className="n num">{stats.generations7d ? `${Math.round((stats.failures7d / stats.generations7d) * 100)}%` : '—'}</div>
          <div className="l">failed ({stats.failures7d})</div>
        </div>
        <div>
          <div className="n num">{stats.medianLatencyMs7d != null ? `${(stats.medianLatencyMs7d / 1000).toFixed(1)}s` : '—'}</div>
          <div className="l">median latency</div>
        </div>
      </div>

      <section className="stack">
        <div className="section-head">
          <h2>Generations, last 14 days</h2>
          <span className="muted small">bars: ok · marks: failed</span>
        </div>
        <Sparkline days={stats.generationsByDay} max={max} />
      </section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s-6)' }}>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Connected accounts by vendor</h2>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {stats.byVendor.length === 0 && (
                  <tr>
                    <td className="muted">No one has connected yet.</td>
                  </tr>
                )}
                {stats.byVendor.map((v) => (
                  <tr key={v.vendor}>
                    <td>{v.vendor}</td>
                    <td className="num">{v.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="stack">
          <div className="section-head">
            <h2 style={{ fontSize: 'var(--t-20)' }}>Recent failures</h2>
            <Link to="/admin/generations?status=failed" className="small">
              All
            </Link>
          </div>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {failures.length === 0 && (
                  <tr>
                    <td className="muted">Nothing has failed recently.</td>
                  </tr>
                )}
                {failures.map((g) => (
                  <tr key={g.id}>
                    <td>{dateTime(g.createdAt)}</td>
                    <td>{g.vendor}</td>
                    <td className="status-failed">{g.errorCode}</td>
                    <td>
                      <Link to={`/admin/users/${g.userId}`}>{g.userDisplayName ?? g.userId}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

function Sparkline({ days, max }: { days: { day: string; ok: number; failed: number }[]; max: number }) {
  const w = 700;
  const h = 120;
  const pad = 18;
  const bw = (w - pad * 2) / days.length;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Generations per day">
      <line x1={pad} x2={w - pad} y1={h - pad} y2={h - pad} stroke="var(--line)" />
      {days.map((d, i) => {
        const x = pad + i * bw;
        const okH = ((h - pad * 2) * d.ok) / max;
        const failH = ((h - pad * 2) * d.failed) / max;
        return (
          <g key={d.day}>
            <rect x={x + bw * 0.2} y={h - pad - okH} width={bw * 0.6} height={okH} fill="var(--sage)" opacity={0.85} rx={2} />
            {d.failed > 0 && <rect x={x + bw * 0.2} y={h - pad - okH - failH} width={bw * 0.6} height={failH} fill="var(--clay)" rx={2} />}
            <text x={x + bw / 2} y={h - 4} textAnchor="middle" fontSize="9" fill="var(--stone)">
              {d.day.slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
