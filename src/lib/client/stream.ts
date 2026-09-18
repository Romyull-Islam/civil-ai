"use client";
import type { AgentEvent, ChatMessage } from "@/lib/ai/types";
import type { AppSettings } from "./settings";

/** POST to /api/chat and yield parsed SSE events. */
export async function* streamChat(messages: ChatMessage[], settings: AppSettings, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, provider: settings.provider, model: settings.model, keys: settings.keys, preferences: settings.preferences }),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `${res.status} ${res.statusText}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* ignore */ }
    yield { type: "error", message: msg };
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try { yield JSON.parse(line.slice(6)) as AgentEvent; } catch { /* skip */ }
        }
      }
    }
  }
}
