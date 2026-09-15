import { getIngredient, type RecipeIngredient, type Step } from '@foodi/shared';

const COUNT_UNITS = new Set(['piece', 'pieces', 'whole', 'large', 'medium', 'small']);

export function ingredientLine(i: RecipeIngredient): string {
  const unit = i.unit && !COUNT_UNITS.has(i.unit.toLowerCase()) ? i.unit : null;
  const qty = [i.quantity, unit].filter(Boolean).join(' ');
  const prep = i.preparation ? `, ${i.preparation}` : '';
  return `${qty ? `${qty} ` : ''}${i.item}${prep}`;
}

export function IngredientList({ ingredients, checked, onToggle, warnings = [] }: { ingredients: RecipeIngredient[]; checked?: Set<number>; onToggle?: (i: number) => void; warnings?: string[] }) {
  const groups = new Map<string, number[]>();
  ingredients.forEach((ing, idx) => {
    const g = ing.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(idx);
  });
  const warn = new Set(warnings.map((w) => w.toLowerCase()));
  return (
    <div className="stack">
      {[...groups.entries()].map(([g, idxs]) => (
        <div key={g || '_'}>
          {g && <h4 style={{ marginBottom: 'var(--s-2)' }}>{g}</h4>}
          <ul className="ing-list">
            {idxs.map((idx) => {
              const ing = ingredients[idx]!;
              const preset = ing.ingredientId ? getIngredient(ing.ingredientId) : undefined;
              const flagged = preset?.allergens.some((a) => warn.has(a.toLowerCase()));
              const done = checked?.has(idx);
              return (
                <li key={idx} className={`ing-row${done ? ' is-done' : ''}`}>
                  {onToggle ? (
                    <label className="ing-check">
                      <input type="checkbox" checked={Boolean(done)} onChange={() => onToggle(idx)} />
                      <span className="ing-text">
                        {ingredientLine(ing)}
                        {ing.optional && <span className="muted"> (optional)</span>}
                        {ing.note && <span className="muted"> — {ing.note}</span>}
                      </span>
                    </label>
                  ) : (
                    <span className="ing-text">
                      {ingredientLine(ing)}
                      {ing.optional && <span className="muted"> (optional)</span>}
                      {ing.note && <span className="muted"> — {ing.note}</span>}
                    </span>
                  )}
                  {flagged && <span className="chip chip-warn chip-static">allergen</span>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function StepList({ steps, ingredients }: { steps: Step[]; ingredients: RecipeIngredient[] }) {
  return (
    <ol className="step-list">
      {steps.map((s, i) => (
        <li key={i} className="step-row">
          <span className="step-n num">{i + 1}</span>
          <div className="stack" style={{ gap: 6 }}>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
            {(s.temperature || s.timerSeconds) && (
              <div className="row small muted" style={{ gap: 'var(--s-3)' }}>
                {s.temperature && <span>{s.temperature}</span>}
                {s.timerSeconds ? <span>⏱ {Math.round(s.timerSeconds / 60)} min</span> : null}
              </div>
            )}
            {s.ingredientRefs.length > 0 && (
              <div className="badges">
                {s.ingredientRefs.map((r) => ingredients[r] && (
                  <span key={r} className="chip chip-static">
                    {ingredients[r]!.item}
                  </span>
                ))}
              </div>
            )}
            {s.tip && <p className="small muted">Tip: {s.tip}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
