import { useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CATEGORY_EMOJI, getIngredient, INGREDIENT_CATEGORIES, INGREDIENTS, searchIngredients, type Ingredient, type IngredientCategory } from '@foodi/shared';

const BASKET = 'basket';

export interface IngredientPickerProps {
  selected: string[];
  onChange: (ids: string[]) => void;
  /** Ids to show first under "My pantry". */
  pantry?: string[];
  basketTitle?: string;
  basketHint?: string;
  /** Rendered under the basket (e.g. the generate button). */
  basketFooter?: React.ReactNode;
  compact?: boolean;
}

/**
 * Drag ingredients from the library into the basket. Every drag action also has a tap
 * equivalent (the + button, the × on basket tiles) so it works on touch and by keyboard.
 */
export function IngredientPicker({ selected, onChange, pantry = [], basketTitle = 'Cook with these', basketHint, basketFooter, compact }: IngredientPickerProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<IngredientCategory | 'pantry' | 'all'>(pantry.length ? 'pantry' : 'vegetables');
  const [active, setActive] = useState<Ingredient | null>(null);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const visible = useMemo(() => {
    if (query.trim()) return searchIngredients(query, 80);
    if (category === 'all') return INGREDIENTS;
    if (category === 'pantry') return pantry.map((id) => getIngredient(id)).filter((x): x is Ingredient => Boolean(x));
    return INGREDIENTS.filter((i) => i.category === category);
  }, [query, category, pantry]);

  const add = (id: string) => {
    if (!selectedSet.has(id)) onChange([...selected, id]);
  };
  const remove = (id: string) => onChange(selected.filter((x) => x !== id));

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id).replace(/^(lib|basket):/, '');
    setActive(getIngredient(id) ?? null);
  }
  function onDragEnd(e: DragEndEvent) {
    setActive(null);
    const raw = String(e.active.id);
    const id = raw.replace(/^(lib|basket):/, '');
    const overBasket = e.over?.id === BASKET;
    if (raw.startsWith('lib:') && overBasket) add(id);
    if (raw.startsWith('basket:') && !overBasket) remove(id);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
      <div className={`picker${compact ? ' picker-compact' : ''}`}>
        <section className="picker-library" aria-label="Ingredient library">
          <div className="picker-search">
            <input
              className="input"
              type="search"
              placeholder="Search 190+ ingredients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search ingredients"
            />
          </div>
          {!query.trim() && (
            <div className="chips picker-cats" role="tablist" aria-label="Categories">
              {pantry.length > 0 && (
                <button type="button" role="tab" className="chip" aria-selected={category === 'pantry'} aria-pressed={category === 'pantry'} onClick={() => setCategory('pantry')}>
                  🧺 My pantry
                </button>
              )}
              {INGREDIENT_CATEGORIES.map((c) => (
                <button key={c} type="button" role="tab" className="chip" aria-selected={category === c} aria-pressed={category === c} onClick={() => setCategory(c)}>
                  {CATEGORY_EMOJI[c]} {c}
                </button>
              ))}
            </div>
          )}
          <div className="picker-grid">
            {visible.map((i) => (
              <LibraryTile key={i.id} ingredient={i} inBasket={selectedSet.has(i.id)} onAdd={() => (selectedSet.has(i.id) ? remove(i.id) : add(i.id))} />
            ))}
            {visible.length === 0 && <p className="muted small">Nothing matches “{query}”. Try another word — or just describe it in the request.</p>}
          </div>
        </section>

        <aside className="picker-basket">
          <div className="section-head" style={{ marginBottom: 'var(--s-2)' }}>
            <h2 style={{ fontSize: 'var(--t-18)' }}>{basketTitle}</h2>
            {selected.length > 0 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onChange([])}>
                Clear
              </button>
            )}
          </div>
          {basketHint && <p className="hint" style={{ marginBottom: 'var(--s-3)' }}>{basketHint}</p>}
          <BasketZone>
            {selected.length === 0 ? (
              <div className="basket-empty">
                <div style={{ fontSize: 28, marginBottom: 6 }} aria-hidden="true">
                  🧺
                </div>
                Drag ingredients here, or tap the + on any tile.
              </div>
            ) : (
              <div className="basket-items">
                {selected.map((id) => {
                  const i = getIngredient(id);
                  return i ? <BasketTile key={id} ingredient={i} onRemove={() => remove(id)} /> : null;
                })}
              </div>
            )}
          </BasketZone>
          {basketFooter && <div style={{ marginTop: 'var(--s-4)' }}>{basketFooter}</div>}
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>{active ? <Tile ingredient={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

type TileProps = React.HTMLAttributes<HTMLDivElement> & {
  ingredient: Ingredient;
  overlay?: boolean;
  inBasket?: boolean;
  action?: React.ReactNode;
  style?: CSSProperties | undefined;
  ref?: React.Ref<HTMLDivElement>;
};

function Tile({ ingredient, overlay, inBasket, action, style, className, ...rest }: TileProps) {
  return (
    <div className={`ing-tile${overlay ? ' is-overlay' : ''}${inBasket ? ' in-basket' : ''}${className ? ` ${className}` : ''}`} style={style} {...rest}>
      <span className="ing-emoji" aria-hidden="true">
        {ingredient.emoji}
      </span>
      <span className="name">{ingredient.name}</span>
      {action}
    </div>
  );
}

function LibraryTile({ ingredient, inBasket, onAdd }: { ingredient: Ingredient; inBasket: boolean; onAdd: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `lib:${ingredient.id}`, data: { ingredient } });
  return (
    <Tile
      ingredient={ingredient}
      inBasket={inBasket}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${ingredient.name}${inBasket ? ' (in basket)' : ''}`}
      style={isDragging ? { opacity: 0.35 } : undefined}
      action={
        <button
          type="button"
          className="add"
          aria-label={inBasket ? `Remove ${ingredient.name}` : `Add ${ingredient.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          {inBasket ? '✓' : '+'}
        </button>
      }
    />
  );
}

function BasketTile({ ingredient, onRemove }: { ingredient: Ingredient; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `basket:${ingredient.id}`, data: { ingredient } });
  return (
    <Tile
      ingredient={ingredient}
      inBasket
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`${ingredient.name}, drag out to remove`}
      style={isDragging ? { opacity: 0.35 } : undefined}
      action={
        <button
          type="button"
          className="add"
          aria-label={`Remove ${ingredient.name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      }
    />
  );
}

function BasketZone({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: BASKET });
  return (
    <div ref={setNodeRef} className={`basket${isOver ? ' is-over' : ''}`} aria-label="Basket">
      {children}
    </div>
  );
}
