# Setup guide — keys, hosting, desktop

> **Modes.** The app starts in **subscription (SaaS) mode by default**: users sign up, admins hold the API keys, plans decide models and quotas — see [08-saas-and-free-hosting.md](08-saas-and-free-hosting.md). The desktop build runs in **desktop** mode (local model + optional link to your service). Set `CIVIL_AI_MODE=byok` only for a personal/developer instance where each user pastes their own keys; sections A–B below describe that developer mode and where *you* as operator get keys.

Civil AI works in these modes:

| | Online (web app) | Desktop app (Windows / Linux / macOS) |
|---|---|---|
| AI models | Cloud APIs (free tiers or paid) | Built-in **offline** model installed automatically on first run **plus** cloud APIs if a key is added |
| Cost | $0 with free tiers | $0 forever for the local model |
| Data | Sent to the chosen provider | Stays on the PC when the local model is used |

## A. Get free API keys (2 minutes each, no credit card)

1. **Google Gemini** (recommended first key)
   1. Open https://aistudio.google.com/apikey and sign in with a Google account.
   2. Click **Create API key** → choose or create a project → copy the key (starts with `AIza`).
   3. Free tier: Flash-Lite ≈ 500 requests/day. A paid Google Cloud billing account raises limits and stops Google using your prompts for training.
2. **Groq** (fastest free tier)
   1. https://console.groq.com/keys → **Create API Key** → copy (starts with `gsk_`).
   2. Free: 1,000 requests/day, 30/min. Models `openai/gpt-oss-120b` (best) and `qwen/qwen3.6-27b` (vision).
3. **Alibaba Qwen (Model Studio)** — 1,000,000 free tokens per model for 90 days
   1. https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key (international/Singapore account; phone must match your country).
   2. Create key → in Settings set provider *Alibaba Qwen*, key, and (if the console shows a workspace URL) paste it as Base URL.
   3. Turn on **Free quota only** in the console so it never bills.
4. **Zhipu GLM (z.ai)** — GLM Flash models free forever: https://z.ai → API keys → copy.
5. **OpenRouter** — free models: https://openrouter.ai/settings/keys (50 req/day; $10 one-time top-up raises it to 1,000/day).
6. Paid, best quality when you need it: **Anthropic Claude** https://platform.claude.com (Sonnet 5 / Opus 5), **OpenAI**, **DeepSeek**.

### Where to put the keys
- **Users**: Settings page → paste under the provider → saved in the browser/app only.
- **You (operator of the online version)**: put them in `.env.local` (copy `.env.example`) locally, or as Environment Variables in Vercel → they become defaults for everyone. Add rate limiting before making a public site with your own keys.

## B. Run the web app

```bash
cd civil-ai
npm install
npm run dev -- -p 3001        # http://localhost:3001
npm test                      # 37 unit tests
npm run eval -- --provider gemini   # civil benchmark against a provider (see docs/07-model-evaluation.md)
```

## C. Deploy online (Vercel)

1. Push the repo to GitHub, import at https://vercel.com/new, root directory `civil-ai`.
2. Add environment variables (any of `GEMINI_API_KEY`, `GROQ_API_KEY`, …). `CIVIL_AI_LOCAL_AI` is forced off on Vercel automatically.
3. Deploy. Hobby plan is free for non-commercial use; switch to Pro ($20/mo) when charging users.

## D. Build the desktop app

```bash
cd civil-ai && npm run build          # Next.js standalone server
cd desktop && npm install
npm run dist:win     # → desktop/release/Civil AI Setup x.y.z.exe
npm run dist:linux   # → AppImage + .deb
npm run dist:mac     # → .dmg (build on macOS)
```

### What happens on the user's first launch
1. The app starts its bundled server on a random localhost port and opens the window (≈ 2 s).
2. It reads the PC configuration: RAM, CPU cores, GPU vendor and VRAM (NVIDIA via `nvidia-smi`; AMD/Intel via Linux sysfs or the Windows registry; Apple Silicon unified memory).
3. It picks a model tier so the PC never becomes slow:

   | Detected | Model | Download | RAM used while running |
   |---|---|---|---|
   | Discrete GPU ≥ 12 GB VRAM and ≥ 16 GB RAM | Qwen 3.5 9B | 5.7 GB | ~7 GB (on GPU) |
   | ≥ 8 GB RAM, no GPU or 4–8 GB GPU (most laptops) | **Qwen 3.5 4B** | 2.7 GB | ~3.5 GB |
   | 5–8 GB RAM | Qwen 3.5 2B | 1.3 GB | ~2 GB |
   | < 5 GB RAM | Qwen 3.5 0.8B | 0.5 GB | ~1 GB |

4. It downloads the engine (llama.cpp `llama-server`, 16 MB CPU build; 30 MB Vulkan build only for discrete NVIDIA/AMD; Metal on Mac) and the model file to the app's data folder, with resume support. The chat page shows a progress bar; the user can already chat with a cloud key meanwhile.
5. The engine starts on port 8765 with threads = cores − 2 so the OS stays responsive, reasoning tokens off, and prompt caching on. The app uses it whenever no cloud provider is configured or reachable (provider **auto**), or always when the user selects **Local first**.
6. Advanced users can pick bigger models under *Settings → Local AI → Show advanced models*.

All local models are Apache-2.0 (Qwen 3.5, Gemma 4) and the engine is MIT — no restrictions on commercial use.

## E. Model choice by job

| Task | Best free | Best paid | Local (desktop) |
|---|---|---|---|
| Design conversations, tool use | Groq gpt-oss-120b, Gemini 3.8 Flash, Qwen 3.6 Plus | Claude Sonnet 5 / Opus 5 | Qwen 3.5 4B (9B on strong GPUs) |
| Reading site photos / drawings | Gemini Flash-Lite, Groq Qwen 3.6-27B | Claude Sonnet 5 | Qwen 3.5 4B (vision) |
| Quick calculators / unit conversion | any | any | Qwen 3.5 2B or 0.8B |

Remember: every number comes from the app's own tested engineering code; the model only chooses and fills the calculators. The benchmark in `docs/07-model-evaluation.md` measures how reliably each model does that.
