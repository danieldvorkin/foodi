import { useState } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime, minutes } from '../../lib/format';

export async function adminRecipesLoader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return admin.recipes(q || undefined);
}

export function AdminRecipes() {
  const { recipes } = useLoaderData<typeof adminRecipesLoader>();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const { revalidate } = useRevalidator();
  const toast = useToast();
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Recipes</h1>
          <p className="muted small">Everything generated or written, across everyone. Deleting removes it for its owner and from the feed.</p>
        </div>
        <form
          className="admin-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(q ? { q } : {});
          }}
        >
          <input className="input" type="search" placeholder="Search title or handle" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" type="submit">
            Search
          </button>
        </form>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Owner</th>
              <th>Source</th>
              <th>Visibility</th>
              <th>Time</th>
              <th className="num">Ingredients</th>
              <th>Allergens</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recipes.map((r) => (
              <tr key={r.id}>
                <td className="wrap">
                  <Link to={`/app/recipes/${r.id}`}>{r.title}</Link>
                </td>
                <td>
                  <Link to={`/admin/users/${r.userId}`}>@{r.handle}</Link>
                </td>
                <td>
                  {r.source}
                  {r.provider ? <span className="muted tiny"> · {r.provider}</span> : null}
                </td>
                <td>{r.visibility}</td>
                <td>{minutes(r.totalMinutes)}</td>
                <td className="num">{r.ingredientCount}</td>
                <td className="wrap muted tiny">{r.allergens.join(', ') || '—'}</td>
                <td>{dateTime(r.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${r.title}”?`)) return;
                      try {
                        await admin.deleteRecipe(r.id);
                        toast('Deleted');
                        revalidate();
                      } catch (e) {
                        toast(errorMessage(e), 'error');
                      }
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {recipes.length === 0 && (
              <tr>
                <td className="muted" colSpan={9}>
                  No recipes match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
