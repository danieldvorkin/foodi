import { useState } from 'react';
import { Link } from 'react-router';
import type { Person } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { social } from '../api/types';
import { useToast } from './Toast';
import { Avatar } from './ui';

/** Follow / Following toggle. Optimistic; reverts on error. */
export function FollowButton({ handle, following, onChange, size = 'sm' }: { handle: string; following: boolean; onChange?: (following: boolean, followerCount: number) => void; size?: 'sm' | 'md' }) {
  const toast = useToast();
  const [state, setState] = useState(following);
  const [busy, setBusy] = useState(false);
  async function toggle() {
    const next = !state;
    setState(next);
    setBusy(true);
    try {
      const r = await social.follow(handle, next);
      onChange?.(r.following, r.followerCount);
    } catch (e) {
      setState(!next);
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={`btn ${size === 'sm' ? 'btn-sm' : ''} ${state ? '' : 'btn-primary'}`} aria-pressed={state} onClick={toggle} disabled={busy}>
      {state ? 'Following' : 'Follow'}
    </button>
  );
}

export function PersonRow({ p, compact }: { p: Person; compact?: boolean }) {
  return (
    <div className="person">
      <Link to={`/app/u/${p.handle}`} aria-label={p.displayName}>
        <Avatar name={p.displayName} emoji={p.avatar} />
      </Link>
      <div className="grow">
        <Link to={`/app/u/${p.handle}`} className="name">
          {p.displayName}
        </Link>
        <p className="bio">{p.bio || `@${p.handle}${compact ? '' : ` · ${p.followerCount} ${p.followerCount === 1 ? 'follower' : 'followers'}`}`}</p>
      </div>
      {!p.isMe && <FollowButton handle={p.handle} following={p.followedByMe} />}
    </div>
  );
}

export function PeopleList({ people, empty }: { people: Person[]; empty: string }) {
  if (people.length === 0) return <p className="muted small">{empty}</p>;
  return (
    <div className="people">
      {people.map((p) => (
        <PersonRow key={p.id} p={p} />
      ))}
    </div>
  );
}
