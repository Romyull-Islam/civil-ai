@AGENTS.md

# Civil AI — project notes for AI assistants

- Engineering math lives in `src/lib/eng/*` (pure, unit-tested with vitest: `npm test`). Never put formulas in React components or prompts.
- Tools exposed to the LLM are registered in `src/lib/tools/index.ts` (zod schema → JSON schema for Anthropic/Gemini/OpenAI-compatible).
- AI providers: `src/lib/ai/providers/*`; the loop is `src/lib/ai/agent.ts`; the SSE protocol is `AgentEvent` in `src/lib/ai/types.ts`.
- Drawings: neutral model in `src/lib/drawing/types.ts`; DXF writer (R12) and SVG renderer; templates in `templates.ts`.
- Desktop shell: `desktop/` (Electron runs `.next/standalone/server.js`). Build web first (`npm run build`), then `cd desktop && npm run dist:<os>`.
- Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
