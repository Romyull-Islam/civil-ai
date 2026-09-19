import { describe, it, expect } from "vitest";
import { toContents, SKIP_SIGNATURE } from "@/lib/ai/providers/gemini";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runAgent } from "@/lib/ai/agent";
import type { ChatMessage, AgentEvent } from "@/lib/ai/types";

const call = (id: string, signature?: string) => ({ type: "tool_call" as const, id, name: "convert_units", args: { value: 100 }, ...(signature ? { signature } : {}) });

describe("gemini thought signatures", () => {
  it("echoes the signature Gemini returned on a function call", () => {
    const msgs: ChatMessage[] = [{ role: "user", parts: [{ type: "text", text: "hi" }] }, { role: "assistant", parts: [call("a", "sig123")] }];
    expect(toContents(msgs)[1].parts?.[0].thoughtSignature).toBe("sig123");
  });
  it("adds the documented placeholder to the first call when history has none", () => {
    const [, model] = toContents([{ role: "user", parts: [{ type: "text", text: "hi" }] }, { role: "assistant", parts: [{ type: "text", text: "ok" }, call("a"), call("b")] }]);
    expect(model.parts?.[1].thoughtSignature).toBe(SKIP_SIGNATURE);
    expect(model.parts?.[2].thoughtSignature).toBeUndefined();
  });
  it("leaves parallel calls alone when the first already has a real signature", () => {
    const [model] = toContents([{ role: "assistant", parts: [call("a", "real"), call("b")] }]);
    expect(model.parts?.map((p) => p.thoughtSignature)).toEqual(["real", undefined]);
  });
});

/** Full agent round trip against a local mock of the Gemini streaming API. */
async function roundTrip(firstChunks: object[]) {
  const bodies: { contents: { role: string; parts: Record<string, unknown>[] }[] }[] = [];
  const srv = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      bodies.push(JSON.parse(b));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const chunks = bodies.length === 1 ? firstChunks : [{ candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP" }] }];
      res.end(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(""));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address() as AddressInfo;
  const events: AgentEvent[] = [];
  try {
    await runAgent({ messages: [{ role: "user", parts: [{ type: "text", text: "convert 16 ft to m" }] }], provider: "gemini", model: "gemini-3.5-flash-lite", keys: { gemini: { apiKey: "test", baseUrl: `http://127.0.0.1:${port}` } }, emit: (e) => events.push(e) });
  } finally { srv.close(); }
  expect(events.some((e) => e.type === "error")).toBe(false);
  expect(bodies).toHaveLength(2);
  return bodies[1].contents.find((c) => c.role === "model")!.parts[0];
}

const fcChunk = (part: object) => ({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "convert_units", args: { value: 16, from: "ft", to: "m" } }, ...part }] } }] });

describe("gemini agent round trip", () => {
  it("returns the signature on the next request", async () => {
    expect((await roundTrip([fcChunk({ thoughtSignature: "REAL" })])).thoughtSignature).toBe("REAL");
  });
  it("picks up a signature streamed on a separate part", async () => {
    const sigOnly = { candidates: [{ content: { role: "model", parts: [{ text: "", thoughtSignature: "LATE" }] }, finishReason: "STOP" }] };
    expect((await roundTrip([fcChunk({}), sigOnly])).thoughtSignature).toBe("LATE");
  });
});

describe("empty model replies", () => {
  it("nudges once, then reports an error instead of ending silently", async () => {
    let calls = 0;
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => { calls++; res.writeHead(200, { "content-type": "text/event-stream" }); res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP" }] })}\n\n`); });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as AddressInfo;
    const events: AgentEvent[] = [];
    try {
      await runAgent({ messages: [{ role: "user", parts: [{ type: "text", text: "how many bags of cement" }] }], provider: "gemini", model: "gemini-3.5-flash-lite", keys: { gemini: { apiKey: "test", baseUrl: `http://127.0.0.1:${port}` } }, emit: (e) => events.push(e) });
    } finally { srv.close(); }
    expect(calls).toBe(2);
    expect(events.find((e) => e.type === "error")).toMatchObject({ message: expect.stringMatching(/empty reply/) });
  });
});

describe("grounding retry", () => {
  it("asks for a rewrite when the answer has a figure no tool produced", async () => {
    const replies = [
      [fcChunk({ thoughtSignature: "S" })],
      [{ candidates: [{ content: { role: "model", parts: [{ text: "16 ft is 4.88 m, which is 5.2 yards." }] }, finishReason: "STOP" }] }],
      [{ candidates: [{ content: { role: "model", parts: [{ text: "16 ft is 4.88 m." }] }, finishReason: "STOP" }] }],
    ];
    const bodies: { contents: { role: string; parts: { text?: string }[] }[] }[] = [];
    const srv = http.createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => { bodies.push(JSON.parse(b)); res.writeHead(200, { "content-type": "text/event-stream" }); res.end(replies[bodies.length - 1].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("")); });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as AddressInfo;
    const events: AgentEvent[] = [];
    try {
      await runAgent({ messages: [{ role: "user", parts: [{ type: "text", text: "convert 16 ft to m" }] }], provider: "gemini", model: "gemini-3.5-flash-lite", keys: { gemini: { apiKey: "test", baseUrl: `http://127.0.0.1:${port}` } }, emit: (e) => events.push(e) });
    } finally { srv.close(); }
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies[2].contents.at(-1))).toContain("5.2");
    expect(events.some((e) => e.type === "text_replace" && e.text === "")).toBe(true);
    expect(events.some((e) => e.type === "notice" && /did not come from a calculation/.test(e.message))).toBe(false);
  });
});

describe("overloaded provider", () => {
  it("retries the same model once after a 503, then answers", async () => {
    let calls = 0;
    const srv = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        calls++;
        if (calls === 1) { res.writeHead(503, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: 503, message: "This model is currently experiencing high demand.", status: "UNAVAILABLE" } })); return; }
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "Hello there, how can I help with your project today?" }] }, finishReason: "STOP" }] })}\n\n`);
      });
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const { port } = srv.address() as AddressInfo;
    const events: AgentEvent[] = [];
    try {
      await runAgent({ messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }], provider: "gemini", model: "gemini-3.5-flash-lite", keys: { gemini: { apiKey: "test", baseUrl: `http://127.0.0.1:${port}` } }, emit: (e) => events.push(e) });
    } finally { srv.close(); }
    expect(calls).toBe(2);
    expect(events.some((e) => e.type === "notice" && /busy; retrying/.test(e.message))).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
  }, 15000);
});
