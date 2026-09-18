# Roadmap (prioritised from the market research gaps)

1. **PDF/drawing ingestion**: upload PDF drawing sets, extract dimensions, schedules and quantities (Gemini Flash-Lite handles PDFs natively; tesseract.js offline). → BOQ export to Excel.
2. **RAG over the user's own code PDFs** (IS/ACI/Eurocode/BS/AS) with page-cited answers; local embeddings (transformers.js) for offline.
3. **More calculators**: two-way slabs, continuous beams (moment distribution), retaining walls, staircases, pile capacity, combined footings, seismic base shear (IS 1893), wind loads (IS 875-3), steel connections, road pavement (IRC 37), drainage sizing, water supply.
3b. **Architecture 2.0**: stack upper floors on the ground footprint, adjacency rules (kitchen–dining, bath–bedroom), multiple entrances, stair geometry, elevations and 3D massing; local bye-law presets per city (RAJUK Dhaka, DDA Delhi, BBMP Bengaluru…).
4. **Drawing 2.0**: bar bending schedule sheet, multi-drawing sheets with title blocks, DWG via ODA converter, IFC export.
5. **Photo measurement** with scale bar; crack width estimation from site photos.
6. **Accounts + sync (Supabase)**, projects, sharing, PDF calculation reports with stamps/signature blocks.
7. **Interop**: SkyCiv/ETABS model export via their APIs; Revit plugin.
8. **Installer improvements**: bundle the CPU engine inside the installer so first run needs only the model download; delta updates for models; per-project model choice.
9. **Tauri build** once Rust is available on the build machine (10× smaller installer).
