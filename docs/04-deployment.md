# Deployment, hosting and cost plan

## Option A — Vercel (fastest)

1. Push the repo to GitHub. Import in https://vercel.com/new (framework: Next.js, root `civil-ai`).
2. Add env vars from `.env.example` (only the ones you have). Users can still paste their own keys in Settings.
3. Deploy. `/api/chat` is a Node function with `maxDuration = 300` (Hobby allows up to 300 s).

Limits: Vercel **Hobby is free but non-commercial**. When you start charging, move to **Pro ($20/mo)** or Option B.

## Option B — Cloudflare / VPS (commercial, still ~free)

- Cloudflare Workers Free allows commercial use (100k req/day). Deploy Next.js with `@opennextjs/cloudflare` (needs small adapter work) or
- any $4–6/mo VPS (Hetzner CX22, Oracle free ARM) running `node .next/standalone/server.js` behind Caddy/Nginx. The standalone build is already produced by `npm run build`.

## Database (when you add accounts, sync, teams)

| Need | Free choice | Notes |
|---|---|---|
| Auth + Postgres + storage | Supabase Free (500 MB, 50k MAU) | pauses after 7 idle days → Pro $25/mo for production |
| Postgres only | Neon Free (0.5 GB) | scale-to-zero, no pause deletion |
| Edge SQLite w/ offline replicas | Turso Free (5 GB) | good fit for the desktop app |
| Files (PDF drawings) | Cloudflare R2 (10 GB, zero egress) | |

v1 stores everything locally (IndexedDB) so no DB cost. Migration path: add `projects`, `conversations`, `drawings` tables (same shapes as `src/lib/db/index.ts`) and sync on login.

## Domain

Cloudflare Registrar at cost: `.com` ≈ $10.46/yr, `.app` ≈ $14.20/yr, `.dev` ≈ $12.20/yr. Porkbun `.app` $8.75 first year.

## Monthly cost estimate

| Scale | Infra | AI usage | Total |
|---|---|---|---|
| Hobby / testing | $0 (Vercel Hobby) | $0 (free tiers) | **≈ $1/mo** (domain) |
| Small commercial (≤ 200 users) | $20 Vercel Pro or $5 VPS | $0–30 (Gemini Flash-Lite / Groq paid overflow, Claude Haiku for design checks) | **$25–50/mo** |
| Team product | + Supabase Pro $25 | usage-based; pass through via BYO-key or credits | **$50–100/mo + usage** |

Pricing strategy from the market research: free tier with calculators + limited AI queries/day, single paid tier at $15–25/mo (undercuts ClearCalcs $79, SkyCiv $109, Kreo $35). Consider "bring your own key" as the free path — users' own free Gemini/Groq quotas cost you nothing.

## Desktop distribution

`cd desktop && npm run dist:win|linux|mac` → installers in `desktop/release/`. Code-signing (Windows EV cert / Apple notarization) is needed to avoid SmartScreen warnings; budget ~$100–300/yr when you go public.

## Security notes

- Never commit `.env.local`. Keys pasted in Settings are stored in the user's browser only and forwarded to your server per request over HTTPS.
- If you host publicly with your own server keys, add rate limiting (Upstash Redis free tier) and an auth layer before launch, or the free quotas will be consumed by strangers.
