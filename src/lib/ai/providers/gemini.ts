import { GoogleGenAI, type Content, type Part, type FunctionDeclaration } from "@google/genai";
import { toolJsonSchema } from "@/lib/tools";
import { ProviderRequest, ProviderTurn, Provider, ProviderUnavailableError, ChatMessage } from "../types";

export function toContents(messages: ChatMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const parts = m.parts.flatMap<Part>((p) => p.type === "text" ? [{ text: p.text }] : p.type === "image" ? [{ inlineData: { mimeType: p.mimeType, data: p.data } }] : []);
      out.push({ role: "user", parts: parts.length ? parts : [{ text: "(empty)" }] });
    } else if (m.role === "assistant") {
      const parts = m.parts.flatMap<Part>((p) => p.type === "text" && p.text.trim() ? [{ text: p.text }] : p.type === "tool_call" ? [{ functionCall: { id: p.id, name: p.name, args: p.args }, ...(p.signature ? { thoughtSignature: p.signature } : {}) }] : []);
      // Gemini 3 rejects a step whose first function call has no thought signature (e.g. history from another provider). Google's documented placeholder skips the check.
      const firstCall = parts.find((p) => p.functionCall);
      if (firstCall && !parts.some((p) => p.functionCall && p.thoughtSignature)) firstCall.thoughtSignature = SKIP_SIGNATURE;
      if (parts.length) out.push({ role: "model", parts });
    } else {
      const parts: Part[] = m.parts.flatMap((p) => p.type === "tool_result" ? [{ functionResponse: { id: p.id, name: p.name, response: p.isError ? { error: p.content } : { result: safeJson(p.content) } } }] : []);
      if (parts.length) out.push({ role: "user", parts });
    }
  }
  return out;
}

export const SKIP_SIGNATURE = "skip_thought_signature_validator";

const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };

export const geminiProvider: Provider = {
  async streamTurn(req: ProviderRequest): Promise<ProviderTurn> {
    const ai = new GoogleGenAI({ apiKey: req.apiKey, ...(req.baseUrl ? { httpOptions: { baseUrl: req.baseUrl } } : {}) });
    const functionDeclarations: FunctionDeclaration[] = req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: toolJsonSchema(t, "openai") }));
    let text = "";
    const toolCalls: ProviderTurn["toolCalls"] = [];
    let usage: ProviderTurn["usage"];
    let finish: string | undefined;
    let looseSig: string | undefined;
    try {
      const stream = await ai.models.generateContentStream({
        model: req.model,
        contents: toContents(req.messages),
        config: { systemInstruction: req.system, tools: [{ functionDeclarations }], maxOutputTokens: req.maxTokens ?? 16000, abortSignal: req.signal },
      });
      for await (const chunk of stream) {
        const t = chunk.text;
        if (t) { text += t; req.onText(t); }
        for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
          const fc = part.functionCall;
          // When streaming, the signature can arrive on a part of its own (before or after the call); keep it for the first call.
          if (!fc) { if (part.thoughtSignature) looseSig ??= part.thoughtSignature; continue; }
          toolCalls.push({ id: fc.id ?? `call_${toolCalls.length}_${Date.now()}`, name: fc.name ?? "", args: (fc.args ?? {}) as Record<string, unknown>, ...(part.thoughtSignature ? { signature: part.thoughtSignature } : {}) });
        }
        if (chunk.usageMetadata) usage = { input: chunk.usageMetadata.promptTokenCount ?? 0, output: chunk.usageMetadata.candidatesTokenCount ?? 0 };
        finish = chunk.candidates?.[0]?.finishReason ?? finish;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new ProviderUnavailableError(`Gemini quota/rate limit: ${msg.slice(0, 200)}`, "gemini", "rate_limit");
      if (/API key|401|403|PERMISSION_DENIED|UNAUTHENTICATED/i.test(msg)) throw new ProviderUnavailableError("Gemini API key invalid", "gemini", "auth");
      if (/404|not found|NOT_FOUND/i.test(msg)) throw new ProviderUnavailableError(`Gemini model not found: ${req.model}`, "gemini", "model");
      if (/fetch failed|ECONN|ENOTFOUND/i.test(msg)) throw new ProviderUnavailableError("Cannot reach Gemini API", "gemini", "network");
      throw e;
    }
    if (looseSig && toolCalls[0] && !toolCalls.some((c) => c.signature)) toolCalls[0].signature = looseSig;
    const stop: ProviderTurn["stop"] = toolCalls.length ? "tool" : finish === "MAX_TOKENS" ? "length" : finish === "SAFETY" || finish === "PROHIBITED_CONTENT" ? "refusal" : "end";
    return { text, toolCalls, usage, stop, servedBy: req.model };
  },
};
