# Architecture

```
┌──────────────────────────── Desktop (Electron) ─────────────────────────────┐
│  main.js spawns the bundled Next.js standalone server on 127.0.0.1:<port>   │
│  and opens it in a BrowserWindow. Same code as the web app.                 │
└─────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── Next.js 16 (App Router) ────────────────────────┐
│  UI (React 19, Tailwind 4)          │  API routes (Node runtime)            │
│  /            Chat (SSE streaming)   │  POST /api/chat   → agent loop (SSE)  │
│  /calculators schema-driven forms    │  GET/POST /api/tools → run a tool     │
│  /drawings    parametric → DXF/SVG   │  POST /api/models → live model list   │
│  /codes       clause search          │  GET /api/health                      │
│  /settings    keys, provider, prefs  │  GET/POST /api/local → local model mgr │
│  Local state: IndexedDB (Dexie) for conversations, localStorage for settings│
└─────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────── src/lib ────────────────────────────────────────┐
│  ai/agent.ts        provider-agnostic loop: stream → tool calls → results   │
│  ai/providers/*     anthropic (official SDK), gemini (@google/genai),        │
│                     openaiCompat (openai SDK: Groq, OpenRouter, Cerebras,    │
│                     Mistral, DeepSeek, Cloudflare, Ollama, OpenAI)           │
│  ai/registry.ts     provider catalogue, free-tier notes, key resolution      │
│  ai/prompt.ts       system prompt (rules: tools for math, cite clauses…)     │
│  tools/index.ts     zod-typed tool registry → JSON schema for every provider │
│  eng/*              pure engineering modules (unit-tested):                  │
│                     beam, rc (IS 456 / ACI 318), steel, soil, quantity,      │
│                     earthwork, units, calc, codes (knowledge base)           │
│  local/index.ts     hardware detection, model tiers, llama.cpp download,      │
│                     server lifecycle (port 8765, OpenAI-compatible)           │
│  drawing/*          neutral drawing model → DXF R12 writer, SVG renderer,    │
│                     parametric templates                                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key decisions

- **LLM never does arithmetic.** Every number in an answer comes from a tool (`calculate`, `analyze_beam`, `design_rc_beam`…). This directly addresses the #1 complaint about generic LLMs in engineering (hallucinated formulas/units).
- **Provider-agnostic with auto-fallback.** Free tiers are small and change often (Gemini Flash-Lite ≈ 500 req/day, Groq 1,000/day, OpenRouter 50/day). `auto` mode walks a chain and moves on when a provider returns a rate-limit / auth / network error before any text has streamed.
- **Anthropic via the official SDK** with prompt caching on the system prompt and server-side refusal fallbacks for Opus 5 / Fable models; other providers via their official or OpenAI-compatible SDKs.
- **Local-first data.** Conversations live in the browser's IndexedDB; API keys in localStorage; no database required for v1. Adding Supabase later is additive (see deployment doc).
- **DXF R12** output for maximum compatibility; dimensions are exploded (lines + text) so no DIMSTYLE dependency.
- **Standalone Next server inside Electron** instead of static export, so API routes, streaming and server-side SDK calls work identically on desktop and web.

## Local model design

- Engine: prebuilt `llama-server` from ggml-org/llama.cpp releases (pinned tag in `LLAMA_TAG`). CPU builds are 16–17 MB; Vulkan builds (~30 MB) cover NVIDIA, AMD and Intel GPUs without a CUDA runtime download; macOS uses Metal. If the GPU build fails to start (missing driver), the manager re-downloads the CPU build automatically.
- Models: unsloth Q4_K_M GGUF quantizations of Qwen 3.5 (0.8B/2B/4B/9B/35B-A3B) and Gemma 4 E2B. Hardware detection: RAM/CPU from Node `os`; GPU name + VRAM from `nvidia-smi`, Linux sysfs (`/sys/class/drm/card*/device/mem_info_vram_total`, AMD/Intel), `lspci`, the Windows registry (`HardwareInformation.qwMemorySize` via PowerShell) or Apple Silicon unified memory. Selection: discrete GPU ≥ 12 GB VRAM and ≥ 16 GB RAM → 9B; otherwise ≥ 8 GB RAM (no GPU or 4–8 GB GPU) → 4B; 5–8 GB → 2B; else 0.8B. 35B-A3B is opt-in only.
- Runtime flags: `--jinja` (tool calling), `-c 16384`, threads = cores − 2 (max 16), `-ngl 999` only with a GPU build.
- Storage: `CIVIL_AI_USER_DATA` (Electron user-data dir) or `~/.civil-ai`. Downloads resume with HTTP Range.
- Hosted deployments set `CIVIL_AI_LOCAL_AI=0` (Vercel is detected automatically) so the route is inert.

## Architecture planning

`src/lib/eng/layout.ts`: `planLayout` packs rooms into two bands around a central passage inside the setback lines (rows fill left→right; overflowing bands are narrowed proportionally; rooms stretch to their band depth), assigns doors towards the passage, windows on outer walls and the main entrance on the front wall, and checks NBC 2016 minimum room sizes. `planBuilding` turns a brief (plot shape, direction, building type, storeys, bedrooms, garage, shops…) into a room programme per floor and runs `planLayout` for each floor; the tool draws all floors side by side in one DXF. Irregular plots are planned on an inscribed rectangle and flagged. It is a concept-sketch generator, not a code-compliant architectural design.

## Adding a tool

1. Implement a pure function in `src/lib/eng/` (add a test in `tests/`).
2. Register it in `src/lib/tools/index.ts` with a zod schema, `run()` and optionally a `display` payload (`beam`, `drawing`, `table`, `steps`).
3. It is instantly available to every AI provider, the Calculators page and `POST /api/tools`.

## Adding a provider

- OpenAI-compatible endpoints: add an entry to `PROVIDERS` in `src/lib/ai/registry.ts` (kind `openai`, `baseUrl`, models). No code needed.
- Other APIs: implement `Provider.streamTurn` in `src/lib/ai/providers/`.
