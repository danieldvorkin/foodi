# Deploying foodi to Fly.io

foodi runs as **one machine with one volume**. SQLite and the uploads directory live on the
volume, so the app must never be scaled past a single machine (two machines would each have
their own database). Everything below assumes the app name `foodi` and the URL
`https://foodi.fly.dev`; change both in `fly.toml` if you pick another name or attach a custom
domain.

## What's in the box

| File | Purpose |
|---|---|
| `Dockerfile` | Two-stage build: `npm ci` + `npm run build` for all three workspaces, then a slim runtime image with only production deps, `server/dist`, `client/dist` and `shared`. Runs as the unprivileged `node` user. |
| `deploy/entrypoint.sh` | Fly mounts the volume as root; the entrypoint creates `/data/uploads`, chowns `/data` to `node`, and drops privileges with `setpriv` before starting Node. |
| `fly.toml` | App config: HTTPS forced, health check on `/api/health`, `/data` volume, 1 GB memory (scrypt uses ~128 MB per login), `strategy = "immediate"` so a single-machine deploy doesn't dead-lock on the volume. |
| `.dockerignore` | Keeps `.env`, `node_modules`, local DBs and uploads out of the image. |

In production the Express server serves the built client itself, so `FOODI_APP_ORIGIN` and
`FOODI_API_ORIGIN` are the same origin. The dev-only mock identity provider and mock AI are
compiled out by `NODE_ENV=production` regardless of any other setting, and the first
registrant is **not** made admin (see "Make yourself admin").

## Continuous deployment (the normal path)

Pushes to `main` run `.github/workflows/deploy.yml`: `npm run check` (typecheck, 41 integration
tests, production builds) and then `flyctl deploy --remote-only --ha=false`. Pull requests run
`.github/workflows/ci.yml` (the same checks, plus the built client as an artifact). The only
secret is `FLY_API_TOKEN`, a deploy-scoped token (`fly tokens create deploy --app foodi`) stored
as a repository secret. Deploys are serialised (`concurrency: deploy-production`), and a single
machine with a volume means each deploy has a ~15-second gap — the client's error page detects
it and reloads itself when the server is back.

### Merge emails (optional)

`.github/workflows/merge-email.yml` emails you when a pull request lands on `main`, listing the
issues it closed. It does nothing until three values exist under Settings → Secrets and
variables → Actions:

| Kind     | Name                | Value                                                     |
| -------- | ------------------- | --------------------------------------------------------- |
| variable | `NOTIFY_EMAIL`      | where to send                                             |
| secret   | `MAIL_USERNAME`     | the Gmail address to send from                            |
| secret   | `MAIL_APP_PASSWORD` | an [app password](https://myaccount.google.com/apppasswords) for that address |

```bash
gh variable set NOTIFY_EMAIL --body you@example.com
gh secret set MAIL_USERNAME --body you@gmail.com
gh secret set MAIL_APP_PASSWORD   # paste the 16-character app password when prompted
```

Everything below is the manual path: first-time setup, and a fallback if Actions is down.

## First deploy

```bash
# 0. One-time: log in, create the app (does not deploy yet)
fly auth login
fly apps create foodi

# 1. A volume in the primary region. 3 GB is plenty to start; it can be extended later.
fly volumes create foodi_data --region yyz --size 3 --yes

# 2. Secrets. Generate fresh ones — never reuse your local .env values.
fly secrets set \
  FOODI_SESSION_SECRET="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=')" \
  FOODI_ENCRYPTION_KEY="$(openssl rand -hex 32)"

# 3. Build remotely and deploy
fly deploy --remote-only

# 4. Make sure there is exactly one machine
fly scale count 1 --yes
fly status
```

Open `https://foodi.fly.dev`, create an account with your email and password, then continue
below.

> **Losing `FOODI_ENCRYPTION_KEY` loses every connected API key** (they're AES-256-GCM
> encrypted with it). Losing `FOODI_SESSION_SECRET` signs everyone out. Keep both in a
> password manager.

## Make yourself admin

Production never promotes automatically. After you've signed up once:

```bash
fly ssh console -C "node /app/server/dist/make-admin.js you@example.com"
```

The command accepts an email, a handle or a user id. From then on you can promote others in
**Admin → People**.

If you later add an OIDC provider that verifies emails (OpenAI sign-in), you can also set
`fly secrets set FOODI_ADMIN_EMAILS=you@example.com` — that path only trusts emails the
provider marked `email_verified`, never a self-typed password registration.

## Optional: "Continue with ChatGPT"

Register an OAuth client with OpenAI using the redirect URI
`https://foodi.fly.dev/api/auth/openai/callback`, then:

```bash
fly secrets set OPENAI_OAUTH_CLIENT_ID=... OPENAI_OAUTH_CLIENT_SECRET=...
```

Without these, people connect an OpenAI or Anthropic API key from **Settings → AI keys**,
which is the expected path for Claude anyway (Anthropic does not permit third-party
Claude.ai sign-in).

## Optional: real payments with Stripe

Until you add Stripe, selling and promoting run in **test mode** — a fake checkout page completes
orders and nothing is charged (the admin portal and every buyer-facing screen say so). To go live:

1. In the Stripe dashboard create a **secret key** and a **webhook endpoint** pointing at
   `https://foodi.fly.dev/api/payments/stripe/webhook`, subscribed to
   `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
2. `fly secrets set STRIPE_SECRET_KEY=sk_live_… STRIPE_WEBHOOK_SECRET=whsec_…`
3. Redeploy. Admin → Sales & payouts shows *Payment provider: Stripe*.

Money model: buyers pay foodi's Stripe account; foodi keeps `platformFeePercent` (Admin →
Sales & payouts, default 20%) of book sales and 100% of promotions. Sellers accumulate a
balance and click **Request payout**; an admin sends the money by hand (bank transfer,
e-transfer, PayPal) and marks the request paid, which notifies the seller. Refunds from the
portal call Stripe's refund API and revoke the buyer's access.

## Day-2 operations

```bash
fly logs                      # structured pino logs
fly ssh console               # shell in the machine; /data holds the DB and uploads
# sqlite3 isn't in the image; query through node instead:
fly ssh console -C "node -e \"const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('/data/foodi.db').prepare('select handle, role from users').all())\""
fly volumes list              # capacity; extend with: fly volumes extend <id> --size 10
fly deploy --remote-only      # redeploy after a push
```

**Backups.** Fly takes daily volume snapshots (kept 5 days by default). For an off-site copy,
the database is a single file in WAL mode — the safe way to copy it is through SQLite's own
backup API, not `cp`:

```bash
fly ssh console -C "node -e \"const {DatabaseSync}=require('node:sqlite');new DatabaseSync('/data/foodi.db').exec(\\\"VACUUM INTO '/data/backup.db'\\\")\""
fly sftp get /data/backup.db ./foodi-backup-$(date +%F).db
```

Uploads are plain files under `/data/uploads/` (`fly sftp shell` → `get -R /data/uploads`).

**Migrations** run automatically on boot (`server/src/db/migrations.ts`, recorded in
`_migrations`). A deploy that adds a migration applies it before the health check passes.

**Memory.** Password hashing is scrypt with N=2¹⁷ (≈128 MB per hash). `fly.toml` gives the
machine 1 GB plus 512 MB swap; if you drop to 512 MB, lower `N` in
`server/src/lib/password.ts` first (existing hashes keep their own parameters and are
re-hashed on the next successful login).

**Custom domain.** `fly certs add cook.example.com`, point a CNAME at `foodi.fly.dev`, then
update `FOODI_APP_ORIGIN` and `FOODI_API_ORIGIN` in `fly.toml` and redeploy. Both must match
the address people actually use — they drive the CSRF origin check, OAuth redirect URIs and
the CSP `form-action` list.

## Security checklist for the public deployment

- `force_https = true` plus `FOODI_COOKIE_SECURE=true`: cookies are `Secure; HttpOnly;
  SameSite=Lax`, HSTS is on.
- `FOODI_TRUST_PROXY=true` so rate limits and audit IPs use Fly's `X-Forwarded-For`, not the
  proxy's address.
- Mock provider, mock AI and first-user-admin are hard-disabled in production.
- The container runs as `node` (uid 1000); only `/data` is writable.
- Secrets live in Fly's secret store, never in `fly.toml` or the image (`.dockerignore`
  excludes `.env`).
- Uploaded images have EXIF/GPS/text metadata stripped; files are served with `nosniff`,
  `inline` disposition and a strict CSP, from a random id, only to signed-in users who can
  see the recipe/post/blog they belong to.
