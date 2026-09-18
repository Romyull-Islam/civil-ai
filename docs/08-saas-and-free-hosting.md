# Selling subscriptions: SaaS mode, admin panel, and free-tier online deployment

## Three ways to ship the same code

| Mode (`CIVIL_AI_MODE`) | Who | AI models | Keys | Accounts |
|---|---|---|---|---|
| `saas` | **Your online product** | Per subscription plan (Free / Pro / Business, editable) | Held by you, encrypted in the database; users never see or enter keys | Email + password, roles `admin` / `user`, daily quotas, usage metering |
| `desktop` | **Downloadable app** | Built-in local model (offline, unlimited) by default; cloud models through the user's Civil AI account when they pick one | None on the PC (cloud requests go through your service) | Optional: *Settings → Civil AI cloud account* links the app to the hosted service |
| `byok` | Self-hosters / developers | Any provider | Each user pastes their own | None |

The desktop app therefore works fully offline and, when a better model is needed, forwards the request to your hosted backend with the user's session token. Quotas and plan rules are enforced on the server.

## Roles

| Role | Who | Can do |
|---|---|---|
| **superadmin** | You (first sign-up, or `ADMIN_EMAILS`) | Everything below **plus** create staff accounts (with a temporary password, emailed), change any account's role, delete accounts |
| **admin** | 1–2 people running the service | Users & subscriptions, payments approval, support tickets, provider API keys (add/remove), plans, site & payment settings, usage |
| **support** | Customer service / helpline | Users (view, set plan/expiry after payment, disable), payments approval, support tickets. No access to keys, plans, site settings or usage |
| **user** | Customers | Chat within plan, calculators, drawings, code library, Account, Plans, Subscribe, Help |

Staff accounts have unlimited AI usage. Nobody can disable or delete their own account; only a superadmin can modify another superadmin. Admin → *Users & subscriptions* is where the superadmin creates and removes staff.

## Default plans (edit in /admin → Plans)

| Plan | Price | AI requests/day | Models |
|---|---|---|---|
| Free | $0 | 15 | Gemini 3.5 Flash-Lite, GPT-OSS 20B (Groq) |
| Pro | $12 | 300 | GPT-OSS 120B, Qwen 3.6-27B vision (Groq), Gemini 3.8 Flash, Qwen 3.6 Plus, GLM 4.7 Flash |
| Business | $39 | 2,000 | Claude Sonnet 5 / Opus 5, GPT-5 mini, plus all Pro models |

Cost check: Free-plan traffic rides on provider free tiers; a Pro user at 300 requests/day on Groq/Gemini costs you well under $1/month at current prices; Business users on Claude Sonnet 5 cost roughly $0.01–0.05 per request, so $39 leaves margin at typical usage.

## Deploy online on free tiers (Vercel Hobby + Neon Postgres)

Vercel Hobby is free but for **non-commercial** use — fine for testing and the beta; move to Vercel Pro ($20/mo) or a $5 VPS when you start charging.

1. **Database (free)**: create a project at https://neon.tech → copy the connection string (`postgres://…?sslmode=require`). (Supabase Free also works: Project → Settings → Database → URI. It pauses after 7 idle days.)
2. **Repository**: push `civil-ai/` to GitHub.
3. **Vercel**: https://vercel.com/new → import the repo → Root Directory `civil-ai` → Environment Variables:

   | Variable | Value |
   |---|---|
   | `CIVIL_AI_MODE` | `saas` |
   | `DATABASE_URL` | the Neon/Supabase connection string |
   | `CIVIL_AI_SECRET` | a long random string (`openssl rand -hex 32`) — encrypts stored API keys |
   | `ADMIN_EMAILS` | `you@example.com` (comma-separated) |
   | `GEMINI_API_KEY`, `GROQ_API_KEY`, … | optional; you can also add keys later in /admin |

4. Deploy → open the URL → **Sign up** with an admin email → **/admin → Provider API keys** → paste your Gemini/Groq (free) and any paid keys → **Plans** (optional edits). Done: users can sign up, get the Free plan, and you upgrade them after payment.
5. Tables are created automatically on first request (`users`, `sessions`, `settings`, `usage`).

Domain: buy a `.com` at Cloudflare (~$10/yr) and add it in Vercel → Domains.

### Free-tier limits to know
- Vercel Hobby: 100 GB bandwidth, 300 s function limit (streaming answers fit), non-commercial.
- Neon Free: 0.5 GB storage, auto-suspend after inactivity (first request after idle takes ~1 s).
- Provider free tiers are per *your* account: Gemini Flash-Lite ≈ 500 req/day, Groq ≈ 1,000 req/day. Enough for a beta; buy credits (Groq/Gemini pay-as-you-go, DeepSeek) before opening Pro widely.

## Desktop app pointing at your service

Build with the backend URL baked in so users only type email + password:

```bash
NEXT_PUBLIC_CLOUD_BACKEND_URL=https://your-civil-ai.vercel.app npm run build
cd desktop && npm run dist:win
```

Users: install → the local model downloads automatically → *Settings → Civil AI cloud account → Link* → cloud models appear in the chat selector with their remaining daily quota.

## Accounts, verification, payments, support (what you asked)

**Admin password** — none is preset. The **first account that signs up becomes superadmin**; any address listed in `ADMIN_EMAILS` also becomes superadmin on sign-up. Create further admin/support accounts from Admin → Users. Change your password from the admin Users tab (set password) if needed.

**How users create accounts** — `/signup` with name, email and password (8+ chars). Then a 6-digit code is emailed; the AI assistant is locked until the code is entered (`/verify`). Calculators, drawings and the code library work without verification.

**Email sending (verification codes, plan activation, ticket replies)** — set one of:
- **Gmail** (simplest): Google Account → Security → 2-Step Verification → *App passwords* → create one → `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<app password>`, `EMAIL_FROM="Civil AI <you@gmail.com>"`. Limit ≈ 500 mails/day (2,000 on Google Workspace). Fine for thousands of users at sign-up rates of a few hundred per day.
- **Resend** (3,000/month free) `RESEND_API_KEY`, or **Brevo** (300/day free) `BREVO_API_KEY` — these need a domain you own for the sender.
- A Proton mailbox can receive support mail, but cannot send app emails (no SMTP/API on free plans). Use Gmail/Workspace or a domain mailbox (Zoho Mail free) for `support@`.
- Admin → *Site & payment settings* → *Email verification*: `auto` (on only when sending is configured), `always`, `never`.

**Payments: bKash / Nagad / Rocket / Bangla QR / bank** — no public self-serve APIs exist without a merchant agreement, so the built-in flow is manual and works from day one:
1. Admin → *Site & payment settings*: enter your bKash/Nagad/Rocket numbers, bank details, upload your Bangla QR image, set the BDT conversion rate (price × rate).
2. User → *Plans* → *Subscribe*: sees the amount and your numbers/QR, pays, submits the **Transaction ID** and sender number.
3. Admin → *Payments*: verify the TrxID in your bKash/Nagad app, click **Approve** → the plan is activated for the plan period (30 days; an approval while still active extends it). The user gets an email. **Reject** asks for a reason that is shown/emailed to the user.
4. Automation later: SSLCommerz / ShurjoPay / aamarPay aggregators (bKash, Nagad, Rocket, cards) or the bKash Merchant PGW need a registered business (trade licence); their webhook can call the same approve logic.

**Help, cancellations, FAQ** — `/help` shows the FAQ and cancellation policy (both editable in Admin → *Site*), support email/phone/WhatsApp, and a ticket form (works signed-out too). Tickets appear in Admin → *Support tickets*; replies are emailed and shown to the user. Plans are prepaid and don't auto-renew, so "cancel" = don't renew; refunds are handled via tickets.

**Renewals and auto-renewal** — with manual bKash/Nagad/Rocket transfers there is nothing to charge automatically, so the app makes renewal frictionless instead:
- Reminder emails 7 days before expiry, 1 day before, and when the grace period starts, each with a one-click *Renew* link to the Subscribe page (pre-selected plan). Sent once per stage. Runs daily: on Vercel through the cron job in `vercel.json` (set `CRON_SECRET`), on a VPS/desktop server by the built-in scheduler; admins can also press *Run reminders now* (Admin → Usage).
- Grace period (`graceDays`, default 3) after expiry during which the plan keeps working and a red banner asks to renew; then the account returns to Free (data kept). An approval or webhook while the plan is still active **extends from the current expiry**, so renewing early never loses days.
- **Automatic renewal** becomes possible once you have a payment gateway that can charge or notify without the user typing a transaction ID. Configure `PAYMENT_WEBHOOK_SECRET` and point the gateway's success callback (SSLCommerz IPN, aamarPay/ShurjoPay callback, bKash merchant API, Stripe webhook via a tiny adapter, or a Zapier/Make rule on payment SMS/emails) at `POST /api/webhooks/payment` with `{ email, plan, txnId, amount, currency, method }`. The plan is activated/extended instantly, idempotently per transaction ID, and the user is emailed. Stripe card subscriptions (for international users) can call the same endpoint on every successful invoice.

**Local model only for paid plans** — each plan has `localAI: true/false` (Free: no; Pro/Business: yes). The desktop app installs the offline model only after the user links an account whose plan includes it; the entitlement is cached so the model keeps working offline and is re-checked every 14 days when online. For your own testing set `CIVIL_AI_LOCAL_AI_FREE=1`.

## Plans and models (admin decides)

Admin → *Plans* is a visual editor: for each plan tick the exact models its subscribers may pick (grouped by provider, with a "no key" warning if that provider has no API key yet), set the daily request limit, price (৳ and USD for Stripe), period, grace days, image input and offline-model entitlement, and the feature lines shown on the Plans page. Users only ever see the models of their plan in the chat selector.

## Team / Enterprise accounts (per-seat pricing)

- The **Team** plan is per user per month (default ৳800/user, minimum 3 users; editable). The buyer chooses the number of seats on the Subscribe page (manual or online payment = price × seats) and becomes the **team owner**.
- Owner → *Team* page: add members by their account email (they sign up free first), remove members, see seats used and expiry. Every member gets the team plan's models, limits and offline-model entitlement while the team subscription is active; removed members fall back to their own plan.
- Renewing extends the team's expiry; buying again with a different seat count resizes the team. Admin/support → *Teams* tab: create teams manually (enterprise invoices), change seats/expiry, delete.

## Chat data: what is stored where

- Conversations are stored **only on the user's device** (browser IndexedDB, or the desktop app's profile). The server stores accounts, plans, payments, tickets and usage counters — never chat content. Model providers are stateless: each request resends the needed history and they keep nothing for us, so there is no storage cost on your side.
- Long conversations are **compressed before sending**: images and old tool outputs are summarised, and if the history is still above the model budget the oldest turns are dropped with a note (the user's stored chat is untouched).
- Users can delete any chat, delete all chats, **export** all chats to a JSON file (keep on their PC / move to another device) and **import** them back. Chats not opened for 30 days are deleted automatically (user-adjustable in Settings: 7 days … never).
- Trade-off: web users switching browsers/devices do not see old chats unless they export/import. Server-side sync for paid plans can be added later (it would then cost storage).

## Online payment gateways (built in — add credentials when you have them)

Admin → *Payment gateways*: enable, choose sandbox/live, paste credentials. Customers then see "Pay online" buttons on the Subscribe page and plans activate instantly; the manual bKash/Nagad/Rocket flow stays as fallback.

| Gateway | Customer can pay with | Your cost (live) | Notes |
|---|---|---|---|
| Manual bKash / Nagad / Rocket / bank (default) | wallets, bank | **0 %** (sender pays the transfer fee) | you verify the TrxID in Admin → Payments |
| bKash merchant API | bKash | ≈ 1.85 % | needs bKash merchant account (trade licence); sandbox tested ✓ |
| aamarPay | bKash, Nagad, Rocket, Upay, cards, banks | ≈ 2–3 % | sandbox tested ✓ (store `aamarpaytest`) |
| shurjoPay | bKash, Nagad, Rocket, Upay, cards, banks | ≈ 2–3 % | sandbox tested ✓ (`sp_sandbox`) |
| SSLCommerz | bKash, Nagad, Rocket, Upay, Bangla QR, cards, banks | ≈ 2.5–3.5 % (+ possible setup fee) | sandbox tested ✓ (demo store `testbox`) |
| Stripe | international cards, Apple/Google Pay | 2.9 % + $0.30 | not available to Bangladeshi entities directly; use a Stripe Atlas/foreign entity; supports **recurring monthly auto-renewal** via webhook |

### Using the partner company's existing SSLCommerz account (recommended)

They already have a live SSLCommerz merchant account, so nothing new has to be applied for. Steps:

1. In the SSLCommerz merchant panel (merchant.sslcommerz.com) → **My Stores**: either use the existing store or create an additional store for Civil AI (recommended, so payouts and reports stay separate). Copy the **Store ID** and **Store Password**.
2. In the same panel, whitelist the new site: add `https://YOUR-DOMAIN` as the store's website/URL and set the **IPN URL** to `https://YOUR-DOMAIN/api/checkout/ipn/sslcommerz` (Settings → IPN).
3. Enter the credentials in **Admin → Payment gateways → SSLCommerz**, untick *sandbox*, tick *enabled*, Save — or set `GATEWAY_SSLCOMMERZ_STORE_ID`, `GATEWAY_SSLCOMMERZ_STORE_PASSWD` and `GATEWAY_SSLCOMMERZ_LIVE=1` in the hosting environment.
4. Make a ৳10 test purchase (a Pro plan with a temporary ৳10 price or a test plan), confirm it appears as *approved* in Admin → Payments and the plan activated, then restore the price.
5. Fees are charged by SSLCommerz per the partner's existing agreement; payouts go to the partner company's settlement bank account. Agree the revenue split with them separately.

The three legal pages (`/terms`, `/privacy`, `/refund-policy`) must be reachable on the new domain — SSLCommerz checks them when adding a site.

### Debit/credit cards in Bangladesh (with the partner company's trade licence)

Local and international Visa / Mastercard / Amex are accepted through any of the three Bangladeshi aggregators — no separate card gateway is needed. Recommended setup once the merged company's trade licence is available:

1. **SSLCommerz** as the primary gateway (largest, cards + bKash + Nagad + Rocket + Upay + Bangla QR + internet banking on one page; card fee ≈ 2.5–3 %). Apply at sslcommerz.com → Merchant registration.
2. Optional **bKash merchant API** for the lowest bKash fee (≈ 1.85 %).
3. **Stripe** only for customers outside Bangladesh (requires a foreign entity).

Merchant onboarding checklist (asked by all gateways): trade licence, TIN certificate, bank account in the company name, NID of the signatory, company address and phone, and a **live website with Terms of Service, Privacy Policy, Refund policy and contact pages** — these three pages are built in (`/terms`, `/privacy`, `/refund-policy`, editable in Admin → *Site & payment settings* → Legal pages; put the company name and address there). Approval typically takes 3–10 working days; use sandbox mode until live credentials arrive.

Cheapest path at ৳300/৳1000 prices: keep manual transfers (0 %) and add the bKash merchant API (≈1.85 %) once volume justifies it; aggregators only if you need cards. Your dominant cost is AI usage, not fees — that is why Pro is 100 requests/day and Max 300/day by default (raise in Admin → Plans when margins allow).

Return/IPN/webhook URLs the gateways need (replace the domain): `https://YOUR-DOMAIN/api/checkout/return/<gateway>` (set automatically per checkout), `https://YOUR-DOMAIN/api/checkout/ipn/sslcommerz`, `https://YOUR-DOMAIN/api/webhooks/stripe`.

## Security (what is enforced)

- Passwords hashed with scrypt; 8+ characters; sessions are random 256-bit tokens in HttpOnly, SameSite=Lax, Secure cookies (30 days) or Bearer tokens for the desktop app; password reset signs out all sessions.
- Email verification (6-digit code, 30 min, 8 attempts) before the AI assistant can be used; password reset codes (30 min, 5 attempts); generic responses never reveal whether an email exists.
- Login lockout: 8 failed attempts lock the account for 15 minutes; IP rate limits on login, sign-up, verification, tickets, password reset.
- **Two-factor authentication** (TOTP, Google/Microsoft Authenticator, Authy) — Account page; strongly recommended for superadmin/admin/support.
- Role-based access on every admin API; audit log of admin actions (user changes, key/gateway changes, payment approvals).
- CSRF protection: cookie-authenticated state-changing API calls must originate from the site; gateway callbacks and webhooks are secret- or signature-verified (Stripe HMAC, SSLCommerz validation API, bKash execute/query, aamarPay/shurjoPay verification calls).
- Security headers: Content-Security-Policy, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed.
- Secrets: provider API keys and gateway credentials encrypted at rest (AES-256-GCM, `CIVIL_AI_SECRET`); env vars never sent to browsers; users never see any key.
- Recommended before launch: HTTPS only (Vercel/Render provide), daily database backups (Neon/Render have them), a privacy policy + terms page, and enabling 2FA on all staff accounts.

## Deploy on Render (alternative to Vercel, also free)

`render.yaml` is included: Render → New → Blueprint → pick the repo → it creates the free web service **and** a free Postgres database and wires `DATABASE_URL`, secrets and cron-less scheduling (the in-process daily scheduler runs on Render). Fill `ADMIN_EMAILS`, `NEXT_PUBLIC_APP_URL`, SMTP and provider keys in the dashboard. Free web services sleep after 15 min idle (first request ~30 s). A `Dockerfile` is included for any VPS.

## Security notes
- Passwords: scrypt; sessions: random 256-bit tokens, HttpOnly cookie (30 days) or Bearer token (desktop).
- Login attempts are rate-limited per IP (20 / 15 min per server instance).
- Set `CIVIL_AI_SECRET` on any hosted deployment; without it a random secret is written to the data folder (fine for single-server, not for serverless).
- Add HTTPS (Vercel does), backups of the Postgres DB, and a privacy policy before launch.
