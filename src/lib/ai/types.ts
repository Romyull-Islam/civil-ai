import type { ToolDef, ToolOutput } from "@/lib/tools";

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string /* base64 */ }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown>; /** opaque provider token (Gemini thought signature) that must be echoed back */ signature?: string }
  | { type: "tool_result"; id: string; name: string; content: string; isError?: boolean };

export interface ChatMessage { role: "user" | "assistant" | "tool"; parts: ContentPart[] }

export interface ProviderRequest {
  model: string;
  apiKey: string;
  baseUrl?: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  maxTokens?: number;
}

export interface ToolCall { id: string; name: string; args: Record<string, unknown>; signature?: string }

export interface ProviderTurn {
  text: string;
  toolCalls: ToolCall[];
  usage?: { input: number; output: number };
  stop: "end" | "tool" | "length" | "refusal" | "other";
  servedBy?: string;
}

export interface Provider { streamTurn(req: ProviderRequest): Promise<ProviderTurn> }

/** Error thrown by adapters when the request should fall through to the next provider in the chain. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, public readonly provider: string, public readonly reason: "no_key" | "rate_limit" | "auth" | "network" | "model" | "other") { super(message); this.name = "ProviderUnavailableError"; }
}

/** Server-sent events emitted by the agent loop to the UI. */
export type AgentEvent =
  | { type: "provider"; provider: string; model: string }
  | { type: "text"; delta: string }
  /** replaces all text streamed so far in the current assistant turn (e.g. after stripping leaked reasoning) */
  | { type: "text_replace"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; output: ToolOutput & { error?: string } }
  | { type: "notice"; message: string }
  | { type: "done"; usage?: { input: number; output: number }; provider: string; model: string }
  | { type: "error"; message: string };
