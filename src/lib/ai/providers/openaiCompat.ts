/** Adapter for every OpenAI-compatible chat endpoint: Groq, OpenRouter, Cerebras, Mistral, DeepSeek, Cloudflare Workers AI, Ollama, OpenAI. */
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionContentPart } from "openai/resources/chat/completions";
import { toolJsonSchema } from "@/lib/tools";
import { PROVIDER_MAP } from "../registry";
import { ProviderRequest, ProviderTurn, Provider, ProviderUnavailableError, ChatMessage } from "../types";

function toMessages(system: string, messages: ChatMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      const parts = m.parts.flatMap<ChatCompletionContentPart>((p) => p.type === "text" ? [{ type: "text" as const, text: p.text }] : p.type === "image" ? [{ type: "image_url" as const, image_url: { url: `data:${p.mimeType};base64,${p.data}` } }] : []);
      const onlyText = parts.every((p) => p.type === "text");
      out.push({ role: "user", content: onlyText ? parts.map((p) => (p as { text: string }).text).join("\n") || "(empty)" : parts });
    } else if (m.role === "assistant") {
      const text = m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("");
      const calls = m.parts.filter((p) => p.type === "tool_call") as Extract<ChatMessage["parts"][number], { type: "tool_call" }>[];
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: "function" as const, function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}) });
    } else {
      for (const p of m.parts) if (p.type === "tool_result") out.push({ role: "tool", tool_call_id: p.id, content: p.content });
    }
  }
  return out;
}

export function makeOpenAICompatProvider(providerId: string): Provider {
  return {
    async streamTurn(req: ProviderRequest): Promise<ProviderTurn> {
      const client = new OpenAI({ apiKey: req.apiKey || "none", baseURL: req.baseUrl, defaultHeaders: providerId === "openrouter" ? { "HTTP-Referer": "https://civil-ai.local", "X-Title": "CivilMate" } : undefined });
      const tools: ChatCompletionTool[] = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: toolJsonSchema(t, "openai") } }));
      let text = "";
      const calls = new Map<number, { id: string; name: string; args: string }>();
      let finish: string | null | undefined;
      let usage: ProviderTurn["usage"];
      const streamOk = PROVIDER_MAP.get(providerId)?.streamWithTools !== false;
      try {
        if (!streamOk) {
          // Endpoint rejects tools + stream together: do a blocking request and emit the text once.
          const resp = await client.chat.completions.create({ model: req.model, messages: toMessages(req.system, req.messages), tools, max_tokens: req.maxTokens ?? 8000 }, { signal: req.signal });
          const msg = resp.choices?.[0]?.message;
          if (msg?.content) { text = msg.content; req.onText(msg.content); }
          for (const [i, tc] of (msg?.tool_calls ?? []).entries()) {
            if (tc.type !== "function") continue;
            calls.set(i, { id: tc.id, name: tc.function.name, args: tc.function.arguments });
          }
          finish = resp.choices?.[0]?.finish_reason;
          if (resp.usage) usage = { input: resp.usage.prompt_tokens, output: resp.usage.completion_tokens };
        } else {
        const stream = await client.chat.completions.create(
          { model: req.model, messages: toMessages(req.system, req.messages), tools, stream: true, max_tokens: req.maxTokens ?? 8000, stream_options: providerId === "ollama" ? undefined : { include_usage: true } },
          { signal: req.signal },
        );
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (choice?.delta?.content) { text += choice.delta.content; req.onText(choice.delta.content); }
          for (const tc of choice?.delta?.tool_calls ?? []) {
            const slot = calls.get(tc.index) ?? { id: tc.id ?? "", name: "", args: "" };
            if (tc.id) slot.id = tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
            calls.set(tc.index, slot);
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) usage = { input: chunk.usage.prompt_tokens, output: chunk.usage.completion_tokens };
        }
        }
      } catch (e) {
        if (e instanceof OpenAI.RateLimitError) throw new ProviderUnavailableError(`${providerId} rate limit: ${e.message.slice(0, 200)}`, providerId, "rate_limit");
        if (e instanceof OpenAI.AuthenticationError || e instanceof OpenAI.PermissionDeniedError) throw new ProviderUnavailableError(`${providerId} API key invalid`, providerId, "auth");
        if (e instanceof OpenAI.NotFoundError) throw new ProviderUnavailableError(`${providerId} model not found: ${req.model}`, providerId, "model");
        if (e instanceof OpenAI.APIConnectionError) throw new ProviderUnavailableError(`Cannot reach ${providerId} (${req.baseUrl ?? "default URL"})`, providerId, "network");
        if (e instanceof OpenAI.APIError && e.status === 413) throw new ProviderUnavailableError(`${providerId}: request larger than the account's token limit`, providerId, "rate_limit");
        if (e instanceof OpenAI.APIError && e.status === 400 && /tool_use_failed|tool call validation failed|parsing failed/i.test(e.message)) throw new ProviderUnavailableError(`${providerId}: the model produced an invalid tool call`, providerId, "other");
        if (e instanceof OpenAI.APIError && (e.status === 402 || e.status === 503 || e.status === 529)) throw new ProviderUnavailableError(`${providerId}: ${e.message.slice(0, 200)}`, providerId, "other");
        throw e;
      }
      const toolCalls: ProviderTurn["toolCalls"] = [];
      for (const [i, c] of calls) {
        let args: Record<string, unknown> = {};
        try { args = c.args ? JSON.parse(c.args) : {}; } catch { args = { __invalid_json: c.args }; }
        toolCalls.push({ id: c.id || `call_${i}_${Date.now()}`, name: c.name, args });
      }
      const stop: ProviderTurn["stop"] = toolCalls.length ? "tool" : finish === "length" ? "length" : finish === "content_filter" ? "refusal" : "end";
      return { text, toolCalls, usage, stop, servedBy: req.model };
    },
  };
}
