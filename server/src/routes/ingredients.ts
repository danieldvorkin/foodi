import { Router } from 'express';
import { INGREDIENT_CATEGORIES, INGREDIENTS, searchIngredients } from '@foodi/shared';

/** The library ships with the client too; this endpoint exists for tooling and the admin panel. */
export function ingredientRoutes() {
  const r = Router();
  r.get('/', (req, res) => {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : '';
    res.json({ categories: INGREDIENT_CATEGORIES, ingredients: q ? searchIngredients(q, 60) : INGREDIENTS });
  });
  return r;
}
