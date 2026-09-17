import { useState } from 'react';

/**
 * Local state that resets whenever `dep` changes identity — the "adjusting state when a prop
 * changes" pattern without an effect. Used for pagination/edits layered on top of loader data:
 * when the loader revalidates, the layered state starts over.
 */
export function useDerivedState<D, S>(dep: D, init: (d: D) => S): [S, (next: S | ((prev: S) => S)) => void] {
  const [slot, setSlot] = useState(() => ({ dep, value: init(dep) }));
  const current = slot.dep === dep ? slot.value : init(dep);
  const set = (next: S | ((prev: S) => S)) =>
    setSlot((prev) => {
      const base = prev.dep === dep ? prev.value : init(dep);
      return { dep, value: typeof next === 'function' ? (next as (p: S) => S)(base) : next };
    });
  return [current, set];
}
