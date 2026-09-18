# Model evaluation for civil-engineering tasks

Why this exists: the market research showed the #1 complaint about AI in engineering is wrong numbers. Civil AI avoids that structurally — every number is produced by tested code in `src/lib/eng/*`, and the language model only chooses calculators and fills their inputs. So the question for any model is not "can it do structural maths" but **"does it call the right tool with the right inputs and explain the result?"** That is what `scripts/eval.mjs` measures.

## The benchmark (12 tasks)

| id | Task | Pass criterion |
|---|---|---|
| beam-udl | SS beam 6 m, 25 kN/m → Mmax, Vmax | `analyze_beam` called; Mmax = 112.5 kN·m, V = 75 kN |
| cantilever | 3 m cantilever, 10 kN tip + 4 kN/m | MA = 48 kN·m, R = 22 kN |
| rc-beam | 300×500, M25/Fe500, Mu 112.5 | Ast ≈ 619 mm² (±5 %) |
| column | 300×450, Pu 1800 kN | Asc between 1,000 and 1,500 mm² |
| footing | 400×400 column, 900 kN, SBC 180 | side ≈ 2.35 m |
| slab | one-way 3.5 m, LL 3 kN/m² | thickness 120–180 mm |
| concrete-qty | 12 m³ M20 | 96–110 cement bags |
| units | 4.5 kN/m² → psf | 93.98 |
| code | min tension steel per IS 456 | cites cl. 26.5.1.1 |
| bearing | Terzaghi strip footing | safe q 300–600 kPa |
| house-plan | 2-bedroom house on 10×12 m plot with setbacks | `plan_layout` arranged 5 rooms inside the buildable area |
| drawing | beam section 4Ø16 + 2Ø12 | `draw_beam_section` produced entities |

Run it against any provider (uses the same `/api/chat` path as the UI):

```bash
npm run eval -- --provider local --model qwen3.5-4b
npm run eval -- --provider ollama --model qwen3.5:9b
npm run eval -- --provider gemini --keys keys.json      # keys.json: {"gemini":{"apiKey":"..."}}
```

Results append to `docs/eval-results.json`. "PASS" = correct numbers; "PARTIAL" = right tools but wrong inputs; "FAIL" = no/incorrect tool use.

## Results (17 Sept 2026, this build machine: i9-14900K, CPU only)

See the table maintained below; it is regenerated from `docs/eval-results.json` after each run.

<!-- results-table -->
| Provider / model | Score | Avg s/task | beam-udl | cantilever | rc-beam | column | footing | slab | concrete-qty | units | code | bearing | drawing | house-plan |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| local/qwen3.5-4b (2026-09-17) | **12/12** | 60 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ollama/qwen3.5:9b (2026-09-17) | **12/12** | 18 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

✅ correct numbers · ⚠️ right tool, wrong inputs · ❌ no/incorrect tool use. Timings are wall-clock on the build machine (i9-14900K; local model CPU-only, Ollama with its own runtime).
