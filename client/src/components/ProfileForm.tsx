import { useState } from 'react';
import {
  COMMON_ALLERGENS,
  CUISINES,
  DIETS,
  EQUIPMENT,
  GOALS,
  ProfileSchema,
  SKILLS,
  SPICE,
  TIME_BUDGETS,
  UNITS,
  type Profile,
} from '@foodi/shared';
import { Chips, TagInput } from './ui';

export type StepId = 'you' | 'diet' | 'avoid' | 'taste' | 'kitchen' | 'time';

export const STEPS: { id: StepId; title: string; lead: string }[] = [
  { id: 'you', title: 'What should we call you?', lead: 'Just for the greeting, and for anything you share.' },
  { id: 'diet', title: 'How do you eat?', lead: 'Every recipe is written to fit this.' },
  { id: 'avoid', title: 'Anything you can’t eat, or won’t?', lead: 'Allergies are a hard rule. Dislikes are avoided.' },
  { id: 'taste', title: 'What do you reach for?', lead: 'Cuisines you like and how hot you go. Skip if you’re open to anything.' },
  { id: 'kitchen', title: 'What’s in your kitchen?', lead: 'We only call for equipment you have.' },
  { id: 'time', title: 'Time, people, and what you’re cooking for', lead: 'You can change these any time in Settings.' },
];

const DIET_LABELS: Record<(typeof DIETS)[number], string> = {
  omnivore: 'Everything',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  pescatarian: 'Pescatarian',
  keto: 'Keto',
  halal: 'Halal',
  kosher: 'Kosher',
  'gluten-free': 'Gluten-free',
};

const SKILL_LABELS: Record<(typeof SKILLS)[number], string> = {
  beginner: 'Still learning — spell it out',
  comfortable: 'Comfortable — normal detail',
  confident: 'Confident — keep it short',
};

export function ProfileStep({ step, value, onChange }: { step: StepId; value: Profile; onChange: (p: Profile) => void }) {
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => onChange({ ...value, [k]: v });
  switch (step) {
    case 'you':
      return (
        <div className="stack-lg">
          <div className="field">
            <label htmlFor="displayName">Name</label>
            <input id="displayName" className="input input-lg" value={value.displayName} onChange={(e) => set('displayName', e.target.value)} placeholder="Your name" maxLength={40} />
          </div>
          <div className="field">
            <span className="label">Units</span>
            <Chips options={UNITS} value={value.units} multi={false} onChange={(v) => set('units', v as Profile['units'])} labels={{ metric: 'Metric (g, ml, °C)', imperial: 'Imperial (oz, cups, °F)' }} />
          </div>
        </div>
      );
    case 'diet':
      return (
        <div className="field">
          <Chips options={DIETS} value={value.diet} multi={false} onChange={(v) => set('diet', v as Profile['diet'])} labels={DIET_LABELS} />
        </div>
      );
    case 'avoid':
      return (
        <div className="stack-lg">
          <div className="field">
            <span className="label">Allergies</span>
            <TagInput value={value.allergies} onChange={(v) => set('allergies', v)} suggestions={COMMON_ALLERGENS} placeholder="Another allergy…" />
          </div>
          <div className="field">
            <span className="label">Dislikes</span>
            <TagInput value={value.dislikes} onChange={(v) => set('dislikes', v)} suggestions={['cilantro', 'mushrooms', 'olives', 'blue cheese', 'liver', 'anchovies']} placeholder="Something else…" />
          </div>
        </div>
      );
    case 'taste':
      return (
        <div className="stack-lg">
          <div className="field">
            <span className="label">Cuisines</span>
            <Chips options={CUISINES} value={value.cuisines} onChange={(v) => set('cuisines', v as string[])} />
          </div>
          <div className="field">
            <span className="label">Spice</span>
            <Chips options={SPICE} value={value.spice} multi={false} onChange={(v) => set('spice', v as Profile['spice'])} labels={{ mild: 'Mild', medium: 'Medium', hot: 'Hot' }} />
          </div>
        </div>
      );
    case 'kitchen':
      return (
        <div className="stack-lg">
          <div className="field">
            <span className="label">Equipment</span>
            <Chips options={EQUIPMENT} value={value.equipment} onChange={(v) => set('equipment', v as string[])} />
          </div>
          <div className="field">
            <span className="label">In the kitchen, you’re…</span>
            <Chips options={SKILLS} value={value.skill} multi={false} onChange={(v) => set('skill', v as Profile['skill'])} labels={SKILL_LABELS} />
          </div>
        </div>
      );
    case 'time':
      return (
        <div className="stack-lg">
          <div className="field">
            <span className="label">Time you usually have</span>
            <Chips
              options={TIME_BUDGETS.map(String) as unknown as readonly string[]}
              value={String(value.timeBudgetMinutes)}
              multi={false}
              onChange={(v) => set('timeBudgetMinutes', Number(v))}
              labels={Object.fromEntries(TIME_BUDGETS.map((t) => [String(t), t >= 60 ? `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ''}` : `${t} min`]))}
            />
          </div>
          <div className="field">
            <label htmlFor="household">People you cook for</label>
            <input id="household" className="input" type="number" min={1} max={12} value={value.householdSize} onChange={(e) => set('householdSize', Math.max(1, Math.min(12, Number(e.target.value) || 1)))} style={{ maxWidth: 120 }} />
          </div>
          <div className="field">
            <span className="label">Goals</span>
            <Chips options={GOALS} value={value.goals} onChange={(v) => set('goals', v as string[])} />
          </div>
        </div>
      );
  }
}

/** Single-page version for Settings. */
export function ProfileForm({ initial, onSave, busy }: { initial: Profile; onSave: (p: Profile) => void; busy: boolean }) {
  const [value, setValue] = useState(initial);
  const valid = ProfileSchema.safeParse(value).success;
  return (
    <form
      className="stack-lg"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave(value);
      }}
    >
      {STEPS.map((s) => (
        <section key={s.id} className="stack">
          <h3>{s.title}</h3>
          <ProfileStep step={s.id} value={value} onChange={setValue} />
        </section>
      ))}
      <div className="row">
        <button className="btn btn-primary" type="submit" disabled={!valid || busy}>
          {busy ? 'Saving…' : 'Save answers'}
        </button>
      </div>
    </form>
  );
}
