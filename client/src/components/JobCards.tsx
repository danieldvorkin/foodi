import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { Job } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { recipes as recipesApi } from '../api/types';
import { dropJob, isActive, upsertJob, useJobs } from '../lib/jobs';
import { useToast } from './Toast';

const LINES = ['Reading your answers…', 'Checking allergens twice…', 'Writing the steps…', 'Setting the timers…', 'Plating up…'];

/** Seconds since `since`, ticking once a second. The clock is external state; render only reads it. */
function useElapsedSeconds(since: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
}

function JobCard({ job, onOpened }: { job: Job; onOpened?: ((recipeId: string) => void) | undefined }) {
  const toast = useToast();
  const active = isActive(job);
  const started = job.startedAt ?? job.createdAt;
  const seconds = useElapsedSeconds(started);
  const line = LINES[Math.min(LINES.length - 1, Math.floor(seconds / 5))];
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return (
    <article className={`jobcard is-${job.status}`} aria-live="polite">
      <div className="jobcard-icon" aria-hidden="true">
        {active ? <span className="spinner" /> : job.status === 'done' ? '✨' : job.status === 'failed' ? '⚠️' : '⏹'}
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <p className="jobcard-title">
          {job.status === 'done' && job.recipeTitle ? job.recipeTitle : job.prompt || 'A new recipe'}
        </p>
        <p className="muted small">
          {job.status === 'queued' && (job.attempts > 0 ? `Trying again (${job.attempts}/${job.maxAttempts})…` : 'Queued')}
          {job.status === 'running' && (
            <>
              {line} · <span className="num">{elapsed}</span>
            </>
          )}
          {job.status === 'done' && 'Ready'}
          {job.status === 'failed' && (job.lastError ?? 'Something went wrong')}
          {job.status === 'cancelled' && 'Cancelled'}
        </p>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        {job.status === 'done' && job.recipeId && (
          <Link to={`/app/recipes/${job.recipeId}`} className="btn btn-primary btn-sm" onClick={() => onOpened?.(job.recipeId!)}>
            Open
          </Link>
        )}
        {job.status === 'failed' && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              try {
                upsertJob((await recipesApi.retryJob(job.id)).job);
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            Try again
          </button>
        )}
        {job.status === 'queued' && (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={async () => {
              try {
                upsertJob((await recipesApi.cancelJob(job.id)).job);
              } catch (e) {
                toast(errorMessage(e), 'error');
              }
            }}
          >
            Cancel
          </button>
        )}
        {!active && (
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Dismiss" onClick={() => dropJob(job.id)}>
            ×
          </button>
        )}
      </div>
    </article>
  );
}

/** Everything being written for this person right now, plus recent results until dismissed. */
export function JobCards({ onOpened }: { onOpened?: (recipeId: string) => void }) {
  const jobs = useJobs();
  const shown = jobs.filter((j) => isActive(j) || j.status === 'failed' || j.status === 'done' || j.status === 'cancelled').slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <section className="jobcards" aria-label="Recipes being written">
      {shown.map((j) => (
        <JobCard key={j.id} job={j} onOpened={onOpened} />
      ))}
    </section>
  );
}
