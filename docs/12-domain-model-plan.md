# A CivilMate model of our own (plan)

**Goal:** an open-licence model, fine-tuned for civil, construction and architecture work. It runs on one affordable GPU, on our servers or in the company edition.

## What a fine-tuned model can and cannot do

- **It should not try to replace the calculators.** Numbers come from the verified calculators (`src/lib/eng`) and code facts from retrieval (`search_code_clauses`). No model is reliable at arithmetic or at quoting code tables from memory.
- **Where it can match or beat general models:**
  - choosing the right calculator and filling its inputs
  - reading soil reports, BOQs, drawings and site photos
  - Bangladesh and US conventions (katha, cft, psi, #5 bars, BNBC/ACI/IRC)
  - Bangla and Banglish
  - answering in our format
- **Where it will not beat frontier models:** open-ended reasoning. Claim "better" only after it beats them on our benchmark (section 5).

## 1. Base model (open licence, commercial use allowed)

Pick the newest release of these families when training starts. Check each licence file again at that time.

| Use | Family | Licence | Why |
|---|---|---|---|
| **Main choice: multimodal** | **Qwen3-VL** (8B to start, then the ~30B class) | Apache 2.0 | Reads drawings, photos and scanned PDFs; strong tool calling; good Bangla and English; well supported by vLLM, Unsloth and LLaMA-Factory |
| Text reasoning | **gpt-oss-20b / gpt-oss-120b** | Apache 2.0 | Strong reasoning and tool use; 120b runs on a single 80 GB GPU; we already use gpt-oss-120b in the product |
| Alternative | Mistral Small (24B, vision) | Apache 2.0 | Good quality per GPU-GB |
| Avoid for a product we sell | Llama, Gemma | Custom licences with use restrictions | Legal review needed before commercial redistribution |

## 2. Data (built from what we already have; licence-clean)

Every item below is built from sources we are allowed to use; see "Rules" at the end of this section.

1. **Tool-use conversations generated from our calculators.** This is the main source: unlimited and always correct.
   - Random realistic inputs for BD and US practice go through the calculator to produce the true result.
   - A teacher model writes varied questions (English, Bangla, Banglish, US units) and the final answer around the tool result.
   - The grounding check rejects any answer whose numbers are not in the tool output.
   - Target: 30–50k conversations covering every tool.
2. **Code questions.** The model learns to call `search_code_clauses` and cite, not to memorise clauses.
   - Clause summaries are written in our own words (`src/lib/eng/codes.ts`).
   - `docs/sources/sources.json` records what each source may be used for:
     - `text`: public domain or open licence.
     - `facts`: restate the facts in our own words only.
     - Copyrighted codes (ACI, AISC, IBC, ASCE, AASHTO) are never copied into training data.
3. **Documents.** Synthetic soil reports, BOQs, rate schedules and proposals, generated from templates with random but consistent values. Targets are the extracted values and the next tool call.
4. **Drawings and photos.**
   - Our own rendered plans and sections (DXF → PNG) with their known dimensions.
   - Public image sets only if their licence allows commercial training. For example, CC BY crack-image sets are fine; CubiCasa5k (CC BY-NC) is not.
5. **Real user data only with explicit opt-in.** Online chats are not stored today, and company-edition data never leaves the company. A consent switch is needed before any user conversation is used.

**Rules:**
- Keep a separate engineer-checked gold set of 300+ questions for evaluation only; it is never used in training.
- Record provenance for every training example.

## 3. Training

- Use LoRA / QLoRA with Unsloth, LLaMA-Factory or Axolotl, starting from the instruct model.
- **8B model:** a few hours on one rented A100 80 GB. Cloud GPUs cost roughly US$1–3 per hour; check current prices.
- **~30B model:** about a day on one A100/H100 80 GB with QLoRA.
- Keep the tool schemas identical to production (`toolJsonSchema`), so the fine-tuned model is a drop-in provider.

## 4. Serving (our servers or the company edition)

| Office size | GPU (approximate) | Model | Notes |
|---|---|---|---|
| Up to ~10 users | 1 × 24 GB (RTX 4090, L4) | 8B, 4–8 bit | Cheapest; good for tool calling |
| 10–50 users | 1 × 48 GB (L40S, RTX 6000 Ada) | ~30B AWQ/FP8 | Best value for a company server |
| 50+ users, or our own cloud | 1–2 × 80 GB (A100/H100) | ~30B FP8, or gpt-oss-120b | High concurrency with vLLM batching |

- Serve with **vLLM**, which is OpenAI-compatible.
- **Company edition:** set the server address under Admin → AI provider keys → Ollama, then add the model name in Admin → Company, e.g. `ollama/civilmate-30b`. Nothing leaves the building.
- **Our SaaS:** a self-hosted model lowers the cost per question once usage is steady. Keep cloud models as the fallback chain.

## 5. Acceptance test before any release

- **Engineering benchmark:** extend the 21-question benchmark (`docs/07-model-evaluation.md`) to the gold set.
- **Pass rule:** at least 90% correct (`QUALITY_PASS_RATE`), with zero invented numbers (grounding check). It must also be no worse than the current production model on every category: design, geotech, quantities, planning, documents and Bangla.
- **Then roll out gradually:**
  1. Offer it as one model in the chooser.
  2. Compare answers and user ratings.
  3. Make it the default only when it wins.

## 6. Later (desktop and integrated software, not the web app)

Drone measurement, photogrammetry and 3D mapping (point clouds, orthophotos, volumes) are planned for the desktop and integrated software. They will need their own models and GPU pipelines, and are out of scope for the web app for now.
