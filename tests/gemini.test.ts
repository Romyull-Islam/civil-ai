import { describe, it, expect } from "vitest";
import { toContents, SKIP_SIGNATURE } from "@/lib/ai/providers/gemini";
import type { ChatMessage } from "@/lib/ai/types";

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
