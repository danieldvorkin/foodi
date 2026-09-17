# Testing

Two suites, both run by `npm run check` (which CI runs on every PR):

| Suite | Where | Runs with | What it covers |
|---|---|---|---|
| Server integration | `server/src/app.test.ts` | Vitest + supertest against a real in-memory SQLite, the mock IdP and the test payment provider | Every API flow end to end: auth, RBAC, recipes, social, blog, books, commerce, shop, house kitchen, security regressions |
| Client components | `client/src/**/__tests__/*.test.tsx` | Vitest + jsdom + Testing Library | Rendering, interaction and accessibility contracts of components and a few routes |

Lint (`npm run lint`, ESLint 9 flat config in `eslint.config.js`) runs `typescript-eslint`, `react-hooks` (including the React Compiler rules — no `setState` in effect bodies, no refs during render) and `jsx-a11y`.

## Writing a client test

```tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter, stubApi, apiError } from '../../test/helpers';

it('does the thing', async () => {
  const calls = stubApi({ 'GET /api/books': { books: [] }, 'POST /api/books': apiError(400, 'Name the book') });
  renderWithRouter(<MyComponent />);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Name the book')).toBeInTheDocument();
  expect(calls[0]).toMatchObject({ method: 'POST' });
});
```

- `renderWithRouter` wraps the component in a memory router and the toast provider, so `<Link>`, `useNavigate` and `useToast` work.
- `stubApi` replaces `fetch` with a map of `"METHOD /api/path"` → JSON body (or a `Response`, or a function of the request) and returns the list of calls made.
- Loader-driven pages: build a `createMemoryRouter` mirroring the real route shape (see `feed-scope.test.tsx`) so `useLoaderData`/`useRouteLoaderData('app')` resolve.
- `client/src/test/setup.ts` shims `<dialog>.showModal/close` and `EventSource`, which jsdom lacks.
- Prefer queries by role and name; they double as an accessibility check.
