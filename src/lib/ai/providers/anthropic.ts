import Anthropic from "@anthropic-ai/sdk";
import { toolJsonSchema } from "@/lib/tools";
import { ProviderRequest, ProviderTurn, Provider, ProviderUnavailableError, ChatMessage, documentAsText } from "../types";

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const content = m.parts.flatMap<Anthropic.Beta.BetaContentBlockParam>((p) => {
        if (p.type === "text") return [{ type: "text", text: p.text } as Anthropic.Beta.BetaTextBlockParam];
        if (p.type === "document") return [{ type: "text", text: documentAsText(p) } as Anthropic.Beta.BetaTextBlockParam];
        if (p.type === "image") return [{ type: "image", source: { type: "base64", media_type: p.mimeType as "image/png", data: p.data } } as Anthropic.Beta.BetaImageBlockParam];
        return [];
      });
      out.push({ role: "user", content: content.length ? content : [{ type: "text", text: "(empty)" }] });
    } else if (m.role === "assistant") {
      const content = m.parts.flatMap<Anthropic.Beta.BetaContentBlockParam>((p) => {
        if (p.type === "text" && p.text.trim()) return [{ type: "text", text: p.text } as Anthropic.Beta.BetaTextBlockParam];
        if (p.type === "tool_call") return [{ type: "tool_use", id: p.id, name: p.name, input: p.args } as Anthropic.Beta.BetaToolUseBlockParam];
        return [];
      });
      if (content.length) out.push({ role: "assistant", content });
    } else {
      const content: Anthropic.Beta.BetaToolResultBlockParam[] = m.parts.flatMap((p) => p.type === "tool_result" ? [{ type: "tool_result" as const, tool_use_id: p.id, content: p.content, is_error: p.isError }] : []);
      if (content.length) out.push({ role: "user", content });
    }
  }
  return out;
}

export const anthropicProvider: Provider = {
  async streamTurn(req: ProviderRequest): Promise<ProviderTurn> {
    const client = new Anthropic({ apiKey: req.apiKey, baseURL: req.baseUrl });
    const tools: Anthropic.Beta.BetaToolUnion[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toolJsonSchema(t, "anthropic") as Anthropic.Beta.BetaTool.InputSchema,
      eager_input_streaming: true,
    }));
    // Server-side refusal fallbacks are enabled by default for Opus 5 / Fable so a safety decline is retried on a fallback model.
    const useFallbacks = /^claude-(opus-5|fable)/.test(req.model);
    try {
      const stream = client.beta.messages.stream(
        {
          model: req.model,
          max_tokens: req.maxTokens ?? 16000,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: toAnthropicMessages(req.messages),
          tools,
          ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
        },
        { signal: req.signal },
      );
      stream.on("text", (delta) => req.onText(delta));
      const msg = await stream.finalMessage();
      let text = "";
      const toolCalls: ProviderTurn["toolCalls"] = [];
      for (const b of msg.content) {
        if (b.type === "text") text += b.text;
        else if (b.type === "tool_use") {
          const t = req.tools.find((x) => x.name === b.name);
          // The SDK's tolerant parser can return truncated input under eager streaming — validate before use.
          const parsed = t ? t.schema.safeParse(b.input) : { success: true as const, data: b.input };
          toolCalls.push({ id: b.id, name: b.name, args: (parsed.success ? parsed.data : b.input) as Record<string, unknown> });
        }
      }
      const stop: ProviderTurn["stop"] = msg.stop_reason === "tool_use" ? "tool" : msg.stop_reason === "max_tokens" ? "length" : msg.stop_reason === "refusal" ? "refusal" : msg.stop_reason === "end_turn" ? "end" : "other";
      if (stop === "length" && toolCalls.length) throw new Error("Tool input was truncated by max_tokens; please retry.");
      return { text, toolCalls: stop === "refusal" ? [] : toolCalls, usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens }, stop, servedBy: msg.model };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) throw new ProviderUnavailableError(`Anthropic rate limit: ${e.message}`, "anthropic", "rate_limit");
      if (e instanceof Anthropic.AuthenticationError) throw new ProviderUnavailableError("Anthropic API key invalid", "anthropic", "auth");
      if (e instanceof Anthropic.NotFoundError) throw new ProviderUnavailableError(`Anthropic model not found: ${req.model}`, "anthropic", "model");
      if (e instanceof Anthropic.APIConnectionError) throw new ProviderUnavailableError("Cannot reach Anthropic API", "anthropic", "network");
      throw e;
    }
  },
};
