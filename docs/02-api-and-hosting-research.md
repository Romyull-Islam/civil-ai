# Free / Low-Cost API, Hosting and Packaging Stack (verified 17 Sept 2026)

## Headline changes since 2025
- **GitHub Models retired** (30 July 2026).
- **Gemini free tier shrank and is unpublished.** Measured: Gemini 3.x Flash ≈ 5 RPM / **20 RPD**; Gemini 3.5 / 3.1 **Flash-Lite ≈ 15 RPM / 500 RPD**; gemini-embedding-2 100 RPM / 1,000 RPD. Free-tier prompts may be used to improve Google products.
- **Groq** dropped Llama 3.x from free tier; free tier centres on `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen/qwen3.6-27b` (vision).
- **Cerebras** free tier is now a 30-day $5 trial. **Together AI** needs a $5 minimum purchase.
- **Cloudflare D1** free limits hard-enforced since 1 Sept 2026.

## 1. LLM APIs

| Provider | Free tier | Limits | Tools | Vision | Get key | Card? |
|---|---|---|---|---|---|---|
| **Google Gemini** | Yes | Flash ~20 RPD; Flash-Lite ~500 RPD | Yes | Yes (image, PDF) | https://aistudio.google.com/apikey | No |
| **Groq** | Yes | 30 RPM, 1,000 RPD, 200K TPD | Yes | qwen3.6-27b | https://console.groq.com/keys | No |
| **OpenRouter `:free`** | Yes | 20 RPM; 50 RPD (1,000 RPD after one-time $10) | Yes | Some | https://openrouter.ai/settings/keys | No |
| **Mistral** | Experiment tier (rate-limited) | Not published | Yes | Yes | https://console.mistral.ai/api-keys | No |
| **Cerebras** | $5 / 30 days | 5 RPM | Yes | qwen-3.8-27b | https://cloud.cerebras.ai | No |
| **Anthropic Claude** | ~$5 trial credit (phone verification) | Tiered | Yes | Yes (image + PDF) | https://platform.claude.com | No for trial |
| **OpenAI** | None | Tiered | Yes | Yes | https://platform.openai.com/api-keys | Prepay |
| **DeepSeek** | None (prepaid) | generous | Yes | deepseek-flash | https://platform.deepseek.com/api_keys | Prepay |
| **Cloudflare Workers AI** | 10,000 Neurons/day | shared pool | Yes | llama-3.2-11b-vision, qwen3.8-27b | https://dash.cloudflare.com | No |
| **Ollama (local)** | Free, offline | hardware | Qwen3.5, Gemma 4, Phi-4-mini | Qwen3.5, Gemma 4 | https://ollama.com | No |

Cheapest paid ($/1M in/out): Gemini 2.5 Flash-Lite 0.10/0.40 · Groq gpt-oss-120b 0.15/0.60 · DeepSeek flash 0.15/0.60 off-peak · OpenAI gpt-5-nano 0.05/0.40 · Claude Haiku 4.5 1/5, Sonnet 5 2/10, Opus 5 5/25 · Mistral Small 4 0.15/0.60.

## 1b. Chinese providers (added 17 Sept 2026 — all OpenAI-compatible, no card)

| Provider | Free tier | Base URL | Signup | Notes |
|---|---|---|---|---|
| **Alibaba Model Studio (Qwen)** | 1,000,000 tokens **per model** for 90 days on new international accounts (qwen3.6-plus, qwen-plus, qwen3-max…) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (or the workspace URL shown in the console) | https://modelstudio.console.alibabacloud.com/ap-southeast-1/settings/api-key — phone must match the sign-up country | Tools **cannot** be combined with streaming; the app switches to non-streaming for this provider. Enable "Free quota only" to avoid charges. |
| **Zhipu GLM / Z.ai** | GLM Flash models free forever (glm-4.7-flash, glm-4.5-flash, glm-4.6v-flash vision) | intl `https://api.z.ai/api/paas/v4`; China `https://open.bigmodel.cn/api/paas/v4` | https://z.ai (email) / open.bigmodel.cn (Chinese phone) | 200K context, tool calling. |
| **SiliconFlow** | Qwen3-8B, DeepSeek-R1-Distill-7B free; ~$1 credit (.com) or ¥14 (.cn) | `https://api.siliconflow.com/v1` / `.cn` | https://cloud.siliconflow.com/account/ak | Free list rotates; DeepSeek capped ~30 req/hr. |
| **DeepSeek** | none (prepaid) | `https://api.deepseek.com/v1` | https://platform.deepseek.com | Very cheap ($0.15/$0.60 off-peak). |
| **Moonshot Kimi / MiniMax** | paid | — | — | Not added. |

Qwen models are also reachable free through Groq (`qwen/qwen3.6-27b`) and OpenRouter, which needs no Chinese account.

Sources: https://www.alibabacloud.com/help/en/model-studio/new-free-quota · https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope · https://itsfree.ai/provider/zai/ · https://freellm.net/blog/china-free-llm-ecosystem · https://pricepertoken.com/endpoints/siliconflow/free · https://yangmao.ai/en/providers/siliconflow/free-tier/

## 2. Vision / OCR
Gemini Flash-Lite (native PDF, free) → Groq qwen3.6-27b (5 images/req) → tesseract.js local → Mistral OCR ($2–4 / 1,000 pages) for scans → Claude Haiku 4.5 for tables/reasoning.

## 3. Image generation
Cloudflare `flux-1-schnell` (~250 images/day free) → Pollinations (key required) → Gemini image ($0.039/img).

## 4. Text-to-CAD
Zoo.dev has a free monthly allowance (mechanical parts, 3D only). Zero-cost alternative used in this app: generate 2D DXF deterministically from parametric templates + LLM-specified entities.

## 5. Embeddings / RAG
gemini-embedding-2 (1,000 RPD free) · Cloudflare bge-m3 · local transformers.js MiniLM (offline) · Supabase pgvector (500 MB free). This app ships a keyword-scored local code knowledge base (no embedding API needed) and can be extended with pgvector.

## 6. Hosting / DB / domains

| Service | Free tier | Gotchas |
|---|---|---|
| **Vercel Hobby** | 300 s functions, 100 GB transfer, 1M invocations | **Non-commercial only**; use Pro ($20/mo) when selling |
| **Cloudflare Workers Free** | 100K req/day, commercial OK, + Workers AI 10K Neurons/day, D1, R2 | Best free home for a key-proxy |
| **Supabase Free** | 500 MB Postgres, 1 GB storage, 50K MAU auth | Pauses after 1 week inactivity; Pro $25/mo |
| **Neon Free** | 0.5 GB/project, scale-to-zero | Good Postgres alternative |
| **Turso Free** | 5 GB, 500M row reads | Embedded replicas work offline |
| **Upstash Redis Free** | 256 MB, 500K cmds/mo | Rate limiting |
| **Render Free** | 750 h/mo, spins down after 15 min | DB expires after 30 days |

Domains: Cloudflare Registrar at cost — .com $10.46, .app $14.20, .dev $12.20, .ai $80. Porkbun .app $8.75 first year.

## 7. Desktop packaging
- **Tauri v2**: needs Rust + webkit2gtk; Next.js must be static export (no API routes). 3–10 MB bundles.
- **Electron**: all-JS, ~100 MB installers, can run the real Next.js server (API routes, streaming) inside. **Chosen for v1** (no Rust on the dev machine, offline tool execution, local Ollama access). Revisit Tauri later.

## 8. Local models (Ollama)
Qwen3.5 4B/9B (tools, vision, math), Gemma 4 E4B (tools, vision), Phi-4-mini (tools, math), Llama 3.2 3B. Viable for offline drafting, unit conversion, calculator tool calls on 8–16 GB machines. Not reliable for unverified structural checks — computations stay in deterministic tools.

## Recommended stack (implemented in this repo)
- **Primary free chain:** Gemini Flash-Lite → Groq gpt-oss-120b → OpenRouter free → Cloudflare Workers AI → Ollama.
- **Paid quality tier (opt-in):** Claude (Opus 5 default in the Anthropic adapter; Haiku 4.5 for lowest cost), DeepSeek flash for bulk extraction.
- **Backend:** Next.js route handlers (Vercel Hobby for testing, Cloudflare/Vercel Pro for commercial), Supabase/Neon when multi-user sync is needed.
- **Storage:** local-first (IndexedDB in browser / Electron) so the app works offline.
- **Rough monthly cost at hobby scale:** $0 infra, $0–10 optional model credits, ~$1 domain.
