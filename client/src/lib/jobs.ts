import { useSyncExternalStore } from 'react';
import type { Job } from '@foodi/shared';

/**
 * The person's background jobs, kept in one place so the Cook page cards, the Cook tab dot and
 * the "ready" toast all agree. Seeded from the API on load; updated from `job` events on the
 * notification stream.
 */
let jobs = new Map<string, Job>();
const listeners = new Set<() => void>();
let snapshot: Job[] = [];

function emit() {
  snapshot = [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  for (const l of listeners) l();
}

export function seedJobs(list: Job[]) {
  for (const j of list) jobs.set(j.id, j);
  emit();
}
/** Returns the previous version of the job (so callers can react to transitions). */
export function upsertJob(job: Job): Job | undefined {
  const prev = jobs.get(job.id);
  jobs.set(job.id, job);
  emit();
  return prev;
}
export function dropJob(id: string) {
  jobs.delete(id);
  emit();
}
export function resetJobs() {
  jobs = new Map();
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function useJobs(): Job[] {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
export const isActive = (j: Job) => j.status === 'queued' || j.status === 'running';
