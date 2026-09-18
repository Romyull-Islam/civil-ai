# AI Software for Civil / Structural / Construction Engineers — Market Scan (September 2026)

Method: 22 web searches + 14 direct page fetches (vendor pricing pages, AEC Magazine, Architosh, Capterra, G2, GitHub). Community sentiment is triangulated from Capterra/G2 verified reviews, AEC-press coverage, and 2026 academic papers on LLM reliability in structural engineering. Prices are list prices as published on the date fetched; several vendors (Bentley, Buildots, Doxel, Augmenta, Swapp, Stru.ai) publish no pricing.

## 1. AI copilots / chat assistants for civil & structural engineering

| Product | What it actually does | Pricing | UX / speed |
|---|---|---|---|
| **Civils.ai** — https://civils.ai/pricing | Document-AI for construction: AI search & compliance checks over PDFs/CAD, AI takeoff, 32+ free calculators, MCP/API on Enterprise. Claims "97%+ accuracy on takeoffs"; data not used for training, can self-host | Free community tier (calculators); Starter **$90/mo**; Professional **$270/mo**; Enterprise custom | Web app; doc answers in seconds; takeoffs per sheet in minutes |
| **Genia** — https://genia.design/product | "Structural AI agent": upload DWG/BIM architectural plan → generates code-checked structural layouts → exports structural DWG + PDF calc sheets + takeoff. US light-frame residential | Free trial: 100 credits; credit-based | Web; "design options in minutes" |
| **Stru.ai** — https://stru.ai | Structural agent that drives ETABS/SAP2000/RISA-3D live, generates *editable* Excel/Mathcad calc sheets with ACI/AISC/Eurocode references | Not published | Desktop-connected agent + web |
| **SkyCiv AI** — https://skyciv.com , https://github.com/skyciv/skyciv-ai-skills | In-app AI assistant for model validation; open "AI Skills" repo so Claude/Copilot agents can build S3D models via API (load generators, 150+ calculators, CAD drawing generation) | Free student tier; Structural 3D ~$109/mo; API metered | Browser; cloud solve seconds–minutes |
| **ClearCalcs** — https://clearcalcs.com | Templated, code-aware member calculators with AI-assisted input extraction | From **$79/mo**; free trial | Browser; instant |
| **Autodesk Assistant** (AutoCAD, Civil 3D, Revit, Forma) | Conversational help + prompt-driven workflows; Revit autocomplete, Drawing Compliance Review, Drawing Change Analysis (AU2026) | Bundled with subscriptions (AutoCAD ~$2.4k/yr, AEC Collection) | In-product panel |
| **Bentley Copilot / OpenSite+** | Generative site grading/drainage; Copilot answers doc questions and chains modelling commands in OpenRoads/OpenRail | Enterprise/quote | Desktop (MicroStation) |
| **TestFit** | Real-time feasibility: parking, massing, unit mix | ~$100/mo to $8–15k/yr | Desktop; instant |
| **Hypar** | Space-planning/stacking; earlier text-to-BIM feature removed in 2.0 | Free trial; $25/mo | Browser |
| **Snaptrude** | AI-assisted concept BIM with Revit sync | 3 free projects; from $60/mo | Browser |
| **Qonic / Swapp / Augmenta** | Cloud BIM + AI IFC classification / DD-CD automation in Revit / autonomous electrical routing | Quote | Browser / Revit |
| **Arkdesign.ai / Maket / Finch 3D / Forma** | Architect-facing generative floor plans/massing | Maket $20/mo; Finch free–$49/mo; Forma in AEC Collection | Browser |

Verdict: the only products a civil/structural engineer can chat with about their own calcs/codes today are Civils.ai, Stru.ai, Genia (narrow), SkyCiv, and the AISC "Clark" bot. The rest are architect/developer tools.

## 2. AI CAD generation / text-to-CAD / DXF

| Product | What it does | Pricing | Notes |
|---|---|---|---|
| **Zoo (KittyCAD) Text-to-CAD** — https://zoo.dev | Prompt → B-Rep solid (STEP/glTF/STL); API/MCP metered | Free tier (~1,205 credits/mo); PAYG | Mechanical-oriented, no 2D DXF drafting intelligence |
| **Adam (AdamCAD)** — https://adamcad.com | Prompt → parametric CadQuery/OpenSCAD code | Freemium | Requires debugging generated code |
| **CADGPT** | Generates AutoCAD/BricsCAD scripts from text | Paid | Niche |
| **AutoCAD 2026 AI** | Smart Blocks, Markup Assist, Autodesk Assistant chat | Included | No generative drafting from text |
| **BricsCAD V26.2** | BricsCAD Assist chat, AI Predict, Blockify, Drawing Health, Bimify | Included (Lite ~$300/yr) | Productivity AI |
| **Autodesk Forma** | Generative massing/site analysis | AEC Collection | Concept phase |

Gap: no mainstream tool takes "draw a 6 m RC beam section with 4T20 bottom bars and T10@150 links" and returns a code-compliant 2D DXF detail.

## 3. AI quantity take-off / estimation / BOQ

| Product | What it does | Pricing | Praise / complaints |
|---|---|---|---|
| **Togal.AI** | OCR+ML auto-detects rooms/areas/counts; Togal.CHAT | Growth $299/user/mo | Fast, accurate; weak on civil/sitework and MEP; plan changes force full re-run |
| **Kreo** | Cloud 2D/BIM takeoff; Auto Measure, Auto Count, AI Scale | Lite $35, Plus $70, Pro $175/user/mo | Cheapest entry; AI only on Pro |
| **Beam AI** | AI takeoff service (24–72 h) / ~$49/mo self-serve | Per project | Accuracy unproven at scale |
| **Bluebeam Revu + Max** | Revu $260–440/user/yr; Max adds Claude-powered prompts, AI-REVIEW, MagicWand takeoff | Paid | Ubiquitous markup tool |
| **Buildots / Doxel** | 360°/LiDAR progress tracking | Custom | Contractor tools |

## 4. Structural analysis & design (web-based / AI-touched)

| Product | AI? | Pricing | Notes |
|---|---|---|---|
| **SkyCiv Structural 3D** | AI validation + LLM "skills" | Free (students), ~$109/mo+ | Capterra 4.6/5: "unbeatable value", "easy to learn"; cons: limited analysis types, DXF import weak |
| **ClearCalcs** | Light | $79/mo | Fast member calcs |
| **ENERCALC SEL** | No | ~$119–139/mo | Trusted US library |
| **IDEA StatiCa 2026** | "AI-assisted" connection checks | thousands/yr | Links to ETABS/Revit/Tekla |
| **ETABS / SAP2000 / RISA-3D** | None native | Paid desktop | "Predictable and auditable" is the selling point |
| **AISC "Clark"** | Chatbot restricted to AISC library | Free for members | Praised because it only cites peer-reviewed AISC content |

## 5. Site / measurement AI

| Product | AI features | Pricing |
|---|---|---|
| **Pix4D** | Photogrammetry, cloud AI progress/volumes | PIX4Dcloud from $49.20/mo; mapper $3,990/yr |
| **DroneDeploy** | AI progress tracking, Safety AI | $329/mo+ |
| **Propeller Aero** | Survey-grade volumes, earthworks tracking | $99/mo annual |

Complaints: expensive for occasional use, drone/pilot heavy; none do "photo → member dimensions".

## 6. Code compliance / building-code Q&A

| Product | What it does | Pricing | Accuracy |
|---|---|---|---|
| **UpCodes Copilot** — https://up.codes/features/ai | Jurisdiction-fenced RAG over adopted US codes; every answer links the code section | Free: 3 questions; Pro ~$25/mo | Claims 93% on compliance benchmark vs <45% for generic LLMs |
| **Civils.ai compliance checks** | Checks docs against uploaded codes | $90/mo+ | — |
| **Helonic** | Reviews structural PDF sets for missing details | Undisclosed | Drawing review |
| **Eurocode / IS chatbots** | No commercial product found | — | Clear whitespace outside US codes |

## Summary

### (a) Features engineers value most
1. Verifiable answers with code citations (UpCodes, AISC Clark, Stru.ai editable sheets).
2. Speed on tedious repetitive tasks (takeoffs, block conversion, drawing compare).
3. Low price and no learning curve (SkyCiv "unbeatable value", Kreo $35).
4. Data privacy ("your data never trains our model", self-host).
5. Export into tools they already use (DWG/DXF, Excel, PDF calc sheets, Revit).

### (b) Common gaps / complaints
- Hallucination / wrong formulas from generic LLMs (unit mix-ups, method swaps); generic LLMs below 50% on code questions.
- No code references → unusable for sealed work.
- US-centric (IBC/ACI/AISC); Eurocode, IS 456/800, BS, AS coverage thin.
- No CAD output from chatbots; text-to-CAD tools are mechanical/3D only.
- Expensive per seat ($79–$329/mo); fragmentation across subscriptions; cloud-only.

### (c) What a new low-cost all-in-one desktop AI assistant should include (ranked)
1. Grounded code Q&A with clause citations (IS, ACI, Eurocode, BS, AS) — refuse to answer without a source.
2. Deterministic calculation engine behind the chat — LLM fills validated calculators, never does arithmetic; step-by-step working shown.
3. 2D CAD/DXF output — sections, details, bar schedules, plan sketches, generated from calc results.
4. Drawing/document ingestion — PDF/image reading, dimension extraction, BOQ to Excel.
5. Offline / local-first desktop app with optional local model.
6. Transparent low pricing — useful free tier, single paid tier ≤ $20–30/mo.
7. Model validation / sanity checks (unrealistic loads, missing cases).
8. Interop (SkyCiv/ETABS APIs, IFC, PDF markups) rather than replacement.
9. Unit and region awareness; block silent unit changes.
10. Photo measurement with scale bar is enough for v1; drones optional.

## Key sources
- https://civils.ai/pricing · https://genia.design/product · https://stru.ai/blog/stru-ai-vs-chatgpt-engineering
- https://github.com/skyciv/skyciv-ai-skills · https://www.capterra.com/p/147474/SkyCiv-Structural-3D/reviews/
- https://helonic.com/compare/best-ai-tools-for-structural-engineering
- https://architosh.com/2026/09/au2026-autodesk-expands-forma-and-leverages-ai/ · https://www.autodesk.com/blogs/autocad/autocad-2026/
- https://aecmag.com/ai/bentley-systems-shapes-its-ai-future/ · https://bricscad.octave.com/bricscad/features/ai-driven-tools
- https://www.getleo.ai/blog/text-to-cad-tools-comparison-guide · https://www.ruh.ai/blogs/takeoff-tool-comparison-2026
- https://www.kreo.net/pricing · https://www.g2.com/products/togal-ai/pricing · https://www.bluebeam.com/pricing/
- https://www.buildingenclosureonline.com/articles/94432-upcodes-unveils-copilot-intelligence
- https://www.mdpi.com/2075-5309/16/3/534 (LLM reliability in structural engineering)
