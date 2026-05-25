# Sneebly Subscription — Spec & Roadmap

Deferred until core app phases are complete. This document is the full spec so nothing needs to be rediscovered when work begins.

---

## Architecture Overview

```
sneebly.com  (Next.js on Vercel)
├── Marketing / pricing / download pages
├── Clerk sign-up / sign-in
├── Account page (subscription management)
└── /api/billing/*  ← the "doorman" (billing backend)
      ├── POST /checkout-session   → creates Stripe Checkout session
      ├── POST /portal-session     → opens Stripe billing portal
      ├── GET  /entitlement        ← Sneebly app polls this
      └── POST /webhook            ← Stripe calls this on subscription events

Supabase (Postgres)
└── customer_mappings table
      clerkUserId ↔ stripeCustomerId ↔ { status, plan, currentPeriodEnd, trialEnd }

Sneebly desktop app
└── On launch + every 1 hour:
      1. Get Clerk session token (user must be signed in)
      2. GET /api/billing/entitlement with Bearer token
      3. Cache result locally (encrypted, keychain or app-data)
      4. If status = active/trialing → run normally
      5. If status = canceled/past_due → show lapsed screen, block core features
      6. If server unreachable → use cached status for up to 7 days (grace period)
```

The identity glue is Clerk. One account works on the website and in the desktop app. The doorman verifies Clerk tokens server-side and never trusts anything the client sends except the signed JWT.

---

## Stack Decisions

| Piece | Choice | Reason |
|---|---|---|
| Website + billing API | Next.js on Vercel | One deploy, one platform, no cold-start problems for webhooks, Clerk has first-class Next.js SDK |
| Database | Supabase (existing account) | Postgres, already provisioned, free tier stays awake with regular app polling |
| Auth | Clerk | Cryptographically-signed JWTs, backend SDK verifies without a network call (JWKS), first-class Next.js + Electron support |
| Payments | Stripe | Standard, battle-tested, MoR path available |
| Stripe MoR flag | `MANAGED_PAYMENTS_ENABLED` env var | Stripe Managed Payments (handles global VAT/GST) was in preview as of early 2026 — gate it behind a single flag so the cutover is one env var change, not a code change |

---

## API Contract (stable — the desktop app and website both build against this)

All authed endpoints require `Authorization: Bearer <clerk-session-token>`. The doorman verifies the token using `@clerk/backend` and extracts the Clerk user ID from the `sub` claim. No Stripe IDs or user IDs are accepted from the client body.

### POST /api/billing/checkout-session

**Auth:** Clerk Bearer token required.

**Request body:**
```json
{ "priceId": "price_xxx", "successUrl": "https://...", "cancelUrl": "https://..." }
```

**Behavior:** find-or-create a Stripe Customer mapped to the Clerk user ID; create a Stripe Checkout Session for that customer.

**Response:**
```json
{ "url": "https://checkout.stripe.com/..." }
```

Note: if we later switch to a Stripe Payment Link, the response shape stays identical — `{ url }` either way. The client just opens the URL.

### POST /api/billing/portal-session

**Auth:** Clerk Bearer token required.

**Request body:** empty.

**Behavior:** look up the Stripe Customer ID for the Clerk user; create a Stripe Billing Portal session.

**Response:**
```json
{ "url": "https://billing.stripe.com/..." }
```

Used for "Manage subscription" and "View invoices" links in the account page and app settings.

### GET /api/billing/entitlement

**Auth:** Clerk Bearer token required.

**Behavior:** read the user's subscription record from Supabase (Stripe webhooks keep it current). Never computed from client input.

**Response:**
```json
{
  "status": "active" | "trialing" | "past_due" | "canceled" | "none",
  "plan": "pro_monthly" | null,
  "currentPeriodEnd": "2026-07-01T00:00:00Z" | null,
  "trialEnd": "2026-06-08T00:00:00Z" | null
}
```

This is the endpoint the local daemon polls. It must be fast (read from DB, no Stripe API call at request time).

### POST /api/billing/webhook

**Auth:** none (Stripe calls it). Verified by Stripe webhook signature using `STRIPE_WEBHOOK_SECRET`.

**Critical:** this route must receive the raw request body before any JSON parsing, or signature verification will fail. In Next.js App Router this requires reading `request.text()` before passing to `stripe.webhooks.constructEvent`.

**Handled events:**
- `checkout.session.completed` — upsert the clerkUserId → stripeCustomerId mapping
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

**Behavior:** on any of the above, upsert the subscription record in Supabase keyed by stripeCustomerId. All handlers must be idempotent (Stripe retries on failure).

**Response:** `{ "received": true }` with 200. Return 400 on invalid signature.

---

## Database Schema

One table in Supabase:

```sql
create table customer_mappings (
  id                 text primary key default gen_random_uuid()::text,
  clerk_user_id      text unique not null,
  stripe_customer_id text unique not null,
  status             text not null default 'none',
  -- 'active' | 'trialing' | 'past_due' | 'canceled' | 'none'
  plan               text,
  current_period_end timestamptz,
  trial_end          timestamptz,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index on customer_mappings (clerk_user_id);
create index on customer_mappings (stripe_customer_id);
```

No card data is ever stored. IDs and status only.

---

## Entitlement Caching in the Desktop App

The app caches the last successful entitlement response locally (encrypted, using keychain via `keytar` which is already a dependency).

Cache key: `sneebly.entitlement.<clerkUserId>`
Cache value: `{ status, plan, currentPeriodEnd, checkedAt }`

Decision logic on each check:

```
if (cache exists AND checkedAt < 1 hour ago) → use cache (fast path)
if (network available) → fetch fresh, update cache
if (network unavailable AND cache exists) → use cache + show offline indicator
if (cache.checkedAt > 7 days ago AND status != active/trialing) → treat as unknown, prompt re-auth
```

This keeps the app usable offline and during brief server outages without being indefinitely bypassable by blocking the network.

---

## Env Vars

All secrets live in environment only, never in code or committed files.

**Vercel (sneebly-web):**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_PRO_MONTHLY=price_...
CLERK_SECRET_KEY=sk_...
CLERK_PUBLISHABLE_KEY=pk_...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ALLOWED_ORIGINS=http://localhost:5173,https://sneebly.com
MANAGED_PAYMENTS_ENABLED=false
```

**Sneebly desktop app (never receives Stripe keys):**
```
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_BILLING_API_BASE=https://sneebly.com/api/billing
```

---

## Managed Payments Flag

When Stripe Managed Payments (Stripe as merchant-of-record for global tax) reaches GA for our account, the cutover is a single env var change. No code change needed.

In `checkout-session` route:
```typescript
const sessionParams: Stripe.Checkout.SessionCreateParams = {
  customer: stripeCustomerId,
  mode: 'subscription',
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: successUrl,
  cancel_url: cancelUrl,
  // MANAGED_PAYMENTS_ENABLED=true sets Stripe as merchant-of-record
  // which handles global VAT/GST/sales tax automatically.
  // Requires GA access from Stripe account team before enabling.
  ...(process.env.MANAGED_PAYMENTS_ENABLED === 'true' && {
    automatic_tax: { enabled: true },
    // merchant_of_record: 'stripe',  // uncomment when GA
  }),
}
```

Flag this to the team before enabling: verify the feature is GA for the account, and run a test checkout in test mode first.

---

## Phased Roadmap

### Phase S1 — Billing backend (the doorman)

**Goal:** all four API endpoints live at a public URL, tested against Stripe test mode.

**Prerequisites:**
- Vercel account connected to GitHub
- Clerk app created (grab secret key + publishable key)
- Stripe test mode enabled (grab secret key, create a monthly price, install Stripe CLI)
- Supabase project ready (grab URL + service role key)

**Deliverables:**
- `sneebly-web/` Next.js project scaffolded and deployed to Vercel
- Supabase `customer_mappings` table created
- Clerk middleware wired — all `/api/billing/*` routes except webhook return 401 without valid token
- `POST /api/billing/checkout-session` creates a real Stripe Checkout session in test mode
- `POST /api/billing/portal-session` creates a real Stripe billing portal session
- `GET /api/billing/entitlement` returns correct status from Supabase
- `POST /api/billing/webhook` verifies Stripe signature, rejects tampered payloads, upserts subscription status on `customer.subscription.*` events
- `.env.example` in repo, no secrets committed

**Acceptance tests:**
1. `curl -H "Authorization: Bearer <invalid>"` any authed endpoint → 401
2. Stripe CLI: `stripe trigger checkout.session.completed` → entitlement record appears in Supabase
3. `GET /api/billing/entitlement` with valid token → `{ status: "active" }` after test webhook
4. Tamper the webhook payload → 400 rejected with signature error logged
5. `POST /api/billing/checkout-session` → returns `{ url: "https://checkout.stripe.com/..." }`

**Claude Code kickoff prompt:**
> Build the Sneebly billing backend as Next.js API routes in a new `sneebly-web/` directory. Stack: Next.js App Router, TypeScript, Stripe SDK, @clerk/backend for JWT verification, Supabase JS client for Postgres. Four routes: POST /api/billing/checkout-session, POST /api/billing/portal-session, GET /api/billing/entitlement, POST /api/billing/webhook. Full spec in SUBSCRIPTION.md at the root of sneebly-interface. Do not touch any files outside sneebly-web/. All secrets via env vars; provide .env.example. Webhook route must read raw body before JSON parse for Stripe signature verification. Test mode only. Report the deployed Vercel URL when done.

---

### Phase S2 — Marketing website

**Goal:** a real website at sneebly.com where users can sign up and subscribe.

**Deliverables:**
- Landing page (above the fold: headline, subheadline, CTA button)
- Pricing page with one plan, Stripe Checkout button (calls `/api/billing/checkout-session`)
- Sign-up / sign-in pages (Clerk components)
- Account page (authenticated): shows current plan status, "Manage subscription" button (calls `/api/billing/portal-session`), download button
- Download page: gated — only accessible to users with `status === "active"` or `"trialing"`; shows platform-specific download link
- Deployed to Vercel with custom domain `sneebly.com`

**Acceptance test:** end-to-end in test mode: sign up → subscribe → see "active" on account page → download button appears.

**Claude Code kickoff prompt:**
> Add marketing and account pages to sneebly-web/. Landing page, pricing page with Stripe Checkout integration (POST /api/billing/checkout-session), Clerk sign-up/sign-in pages, authenticated account page showing entitlement status from GET /api/billing/entitlement with a Manage Subscription button (POST /api/billing/portal-session), and a download page gated to active/trialing users. Use Tailwind for styling; match a clean, minimal SaaS aesthetic. All pages in Next.js App Router. Full spec in SUBSCRIPTION.md.

---

### Phase S3 — Desktop app integration

**Goal:** the Sneebly app requires a paid subscription to use.

**Deliverables:**
- Clerk sign-in flow inside the Sneebly app (new onboarding step before the existing project picker)
- Clerk session token stored securely (keytar, which is already a dependency)
- On launch + every 60 minutes: `GET /api/billing/entitlement` with Bearer token
- Entitlement cached locally (keytar) with 7-day offline grace period
- If `status` is `active` or `trialing`: normal app experience
- If `status` is `past_due`: banner warning "Payment failed — please update your payment method" with link to billing portal; app still works for 3 days then blocks
- If `status` is `canceled` or `none`: full-screen "subscription required" overlay — shows plan/pricing link to sneebly.com, sign-out button
- Settings panel: shows current plan status, "Manage subscription" button (opens portal session URL in system browser)
- Graceful degradation: if entitlement check fails due to network error, use cached status; show "offline mode" indicator if cache is > 24 hours stale

**Acceptance test:**
1. Fresh install, no account → Clerk sign-in screen
2. Sign in with active subscription → app loads normally
3. Manually set status to `canceled` in Supabase → relaunch app → subscription required screen
4. Disconnect network → app still works using cache
5. Set cache timestamp to 8 days ago with `canceled` status → app prompts re-auth

**Claude Code kickoff prompt:**
> Integrate Clerk authentication and subscription gating into the Sneebly desktop app. Users must sign in with Clerk before reaching the project picker. After sign-in, the app polls GET /api/billing/entitlement (env var VITE_BILLING_API_BASE) using the Clerk session token. Cache the result with keytar. Show appropriate UI for active/trialing (normal), past_due (warning banner), canceled/none (full-screen gate). Add plan status + Manage Subscription button to the Settings panel. 7-day offline grace period using cached status. Full spec in SUBSCRIPTION.md.

---

### Phase S4 — Production hardening

**Goal:** flip to live Stripe keys, verify end-to-end in production, monitor.

**Deliverables:**
- Stripe production mode keys in Vercel env (replace test keys)
- Stripe webhook endpoint registered in production Stripe dashboard
- `MANAGED_PAYMENTS_ENABLED` reviewed — confirm with Stripe whether GA for the account; leave `false` until confirmed
- Smoke test in production: real checkout → real subscription → entitlement returns `active` in app
- Error monitoring wired (Vercel has basic logging; add Sentry or similar if volume warrants)
- Rate limiting on `/api/billing/entitlement` (simple: 60 req/min per user via Upstash or Vercel KV) to prevent abuse

**Acceptance test:** buy a real subscription with a real card in test mode (using Stripe's test card `4242 4242 4242 4242`) → confirm entitlement in app → cancel → confirm app shows lapsed state within one polling cycle.

---

## Security Checklist (verify before Phase S4)

- [ ] Stripe secret key never appears in client code, logs, or the desktop app bundle
- [ ] Webhook signature verified on every call; unsigned requests rejected with 400
- [ ] Clerk token verified server-side on every authed call; expired/invalid → 401
- [ ] No card data stored anywhere; only IDs and status
- [ ] Entitlement computed server-side from Stripe-driven DB records, never from client claims
- [ ] Supabase service role key only on server, never in app bundle
- [ ] `MANAGED_PAYMENTS_ENABLED` is `false` until explicitly confirmed GA and tested

---

## Open Questions (resolve before Phase S4)

1. **Trial period?** Should new accounts get a free trial (7 or 14 days)? If yes, set `trial_period_days` on the Stripe price and surface `trialEnd` date in the app.
2. **Stripe Managed Payments GA status?** Confirm with Stripe account team before enabling `MANAGED_PAYMENTS_ENABLED`.
3. **Download hosting?** Where does the `.dmg` live — GitHub Releases, S3, or Vercel? The download page needs a URL. Electron Forge can upload to GitHub Releases automatically.
4. **Price point?** Needed before Phase S2. A single monthly plan keeps Phase S2 simple.
5. **Windows/Linux?** The app is currently macOS-only. Affects the download page copy and build pipeline.
