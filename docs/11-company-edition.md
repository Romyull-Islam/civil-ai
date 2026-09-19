# CivilMate company edition (self-hosted)

The company edition is the same CivilMate app installed on a company's own server or PC. The company runs it, manages its own users and uses its own AI keys. **No data is sent to CivilMate.**

| | Online service | Company edition |
|---|---|---|
| Where it runs | CivilMate's servers | The company's server or PC (office network or its own cloud account) |
| Accounts | Anyone signs up | The company's administrator adds, disables and deletes users |
| AI models | CivilMate's plans and credits | The company's own API keys, or a private model server (Ollama / vLLM) |
| Payments, plans, ads | Yes | None |
| Questions allowed | Civil / construction (admin setting) | Civil / construction only (`CIVIL_AI_TOPIC_GUARD=on`) |
| Data | Accounts on CivilMate's database | Everything stays on the company's machine |
| Licence | Subscription | Signed licence file: number of users + maintenance period |

## What leaves the company's network

- **Nothing to CivilMate.** There is no telemetry, analytics, licence server, update check, Gravatar or cloud link. The licence is verified offline with a public key built into the app.
- **Questions go to the AI provider the company chooses** (Anthropic, OpenAI, Google, DeepSeek…), under the company's own account and contract.
  - With a private model server (Ollama / vLLM on the company's GPU), nothing leaves the building at all.
- **Optional:** password-reset emails through the company's own SMTP server.

Where data is stored:
- **Chats:** in each user's browser on their own PC. Users can also back chats up to the company server.
- **Server data:** accounts, settings, encrypted API keys and backups are in one SQLite file in the `civilmate-data` Docker volume.
- **Encryption:** API keys are encrypted with `CIVIL_AI_SECRET`.

## Requirements

- **Server:** any 64-bit Linux, Windows or macOS machine with Docker. 2 CPU cores, 4 GB RAM and 10 GB disk serve about 50 users when a cloud AI provider is used.
- **For a private model:** an NVIDIA GPU with 24 GB or more (e.g. RTX 4090, L4, L40S, A100). See `12-domain-model-plan.md`.
- **Network:** users reach it at `http://<server>:3000`. Put it behind the company's reverse proxy for HTTPS; this is recommended.

## Install (IT staff)

```bash
cd deploy/company
cp company.env.example company.env
openssl rand -hex 32          # paste the result into CIVIL_AI_SECRET in company.env
docker compose up -d          # or: docker compose --profile local-ai up -d   (adds a private Ollama server)
```

Then open `http://<server>:3000`. The first visitor sees **"create the administrator account"**. That account owns the installation; nobody else can sign up.

### Offline or air-gapped sites

The vendor ships the image as a file:
1. The vendor builds and saves it: `docker build -t civilmate/company:1.0 . && docker save civilmate/company:1.0 | gzip > civilmate-company-1.0.tar.gz`
2. The customer loads it: `docker load < civilmate-company-1.0.tar.gz`
3. The customer sets `CIVILMATE_VERSION=1.0` and runs `docker compose up -d`.

## Administrator tasks

**Admin → Company**
- Paste the licence.
- Set AI limits per user (0 = unlimited; 1 credit ≈ US$0.002 of provider cost).
- Choose the allowed models and the default model.
- Add models served by your own server, e.g. `ollama/qwen3:32b`.

**Admin → AI provider keys**
- Enter the company's API keys. They are stored encrypted on this server.
- For a private model server, set the Ollama address, e.g. `http://ollama:11434/v1`.

**Admin → Users**
- Add a user with an email and a temporary password.
- Disable a user to free a licence seat while keeping their history.
- Delete users and reset passwords.
- Only the owner (superadmin) can create other admins.

**Admin → Usage**
- AI use per user, so the company can see what its API account is spending.

## Licences (vendor)

```bash
node scripts/license.mjs keygen                 # once; private key → ~/.civilmate/license-private.pem (back it up offline)
node scripts/license.mjs issue --company "ABC Construction Ltd" --seats 25 --expires 2027-12-31
```

- **The licence:** send the printed `CM1.…` text to the customer's administrator.
  - `--seats` is the maximum number of active users.
  - `--expires` is the end of the maintenance period. Omit it for a perpetual licence.
- **Without a licence:**
  - A 30-day evaluation for 3 users.
  - After expiry, the AI assistant keeps working for 30 days of grace, then stops until the licence is renewed.
  - Calculators, drawings and the code library always keep working.
- **Changing these rules:** edit `TRIAL_DAYS`, `TRIAL_SEATS` and `GRACE_DAYS` in `src/lib/company/license.ts`.
- **Key safety:** never commit or share the private key. Anyone holding it can issue licences.

## Maintenance service (vendor checklist)

- **Updates:** ship a new image version.
  1. The customer backs up the volume.
  2. They pull (or `docker load`) the new version.
  3. They run `docker compose up -d`.

  The database schema migrates itself on start.
- **Backup:**
  ```bash
  docker run --rm -v civilmate_civilmate-data:/d -v $PWD:/b alpine tar czf /b/civilmate-backup.tgz -C /d .
  ```
  Restore it the same way into an empty volume.
- **Health check:** `GET /api/health`.
- **Remote support:** only through the customer's own remote-access tool, when they ask. The app has no remote-access channel.
