/** Topic guard: civil questions pass, off-topic ones are answered locally (no model call, no credits). */
import { describe, it, expect } from "vitest";
import { checkTopic } from "@/lib/ai/topic";
import type { ChatMessage } from "@/lib/ai/types";

const user = (text: string): ChatMessage => ({ role: "user", parts: [{ type: "text", text }] });
const bot = (text: string): ChatMessage => ({ role: "assistant", parts: [{ type: "text", text }] });
const decide = (msgs: ChatMessage[] | string, on = true) => checkTopic(typeof msgs === "string" ? [user(msgs)] : msgs, on);

describe("topic guard", () => {
  it.each([
    "Design an RC beam, 5 m span, 20 kN/m",
    "How many bags of cement for 100 cft of 1:2:4?",
    "What is the minimum cover for a footing per BNBC?",
    "Plan a 3-storey house on a 5 katha plot",
    "flexible pavement design AASHTO 93 for 2 million ESAL",
    "IRC egress window size for a bedroom",
    "What FAR is allowed on a 6 m road in Dhaka?",
    "ছাদ ঢালাইয়ে কত বস্তা সিমেন্ট লাগবে?",
    "convert 3000 psi to MPa",
    "area of a trapezoid with parallel sides 12 m and 8 m, height 5 m",
    "Prepare a Gantt chart for my project",
  ])("allows: %s", (q) => { expect(decide(q).action).toBe("allow"); });

  it.each([
    "Write a poem about the moon",
    "Tell me a joke",
    "Who will win the cricket match tomorrow?",
    "Give me a biryani recipe",
    "explain photosynthesis",
    "write python code to sort a list",
    "Which crypto should I buy?",
    "I like a lot of music, recommend songs",
    "how far is Chittagong from Dhaka",
  ])("refuses locally: %s", (q) => {
    const d = decide(q);
    expect(d.action).toBe("reply");
    if (d.action === "reply") { expect(d.reason).toBe("off_topic"); expect(d.text).toMatch(/none of your credits/); }
  });

  it("answers greetings and 'what can you do' without a model, even when the guard is off", () => {
    expect(decide("Hi!", false)).toMatchObject({ action: "reply", reason: "greeting" });
    expect(decide("আসসালামু আলাইকুম")).toMatchObject({ action: "reply", reason: "greeting" });
    expect(decide("what can you do?", false)).toMatchObject({ action: "reply", reason: "meta" });
    expect(decide("Write a poem", false)).toMatchObject({ action: "allow", reason: "disabled" });
  });

  it("allows follow-ups in a civil conversation but not a switch to an unrelated topic", () => {
    const convo = [user("Design a footing for 800 kN on 150 kPa soil"), bot("Use a 2.4 m square footing, 450 mm deep…")];
    expect(decide([...convo, user("why?")]).action).toBe("allow");
    expect(decide([...convo, user("and for 1000?")]).action).toBe("allow");
    expect(decide([...convo, user("thanks")])).toMatchObject({ action: "reply", reason: "thanks" });
    expect(decide([...convo, user("now write me a love letter")]).action).toBe("reply");
  });

  it("allows attached documents and photos unless the request is clearly off-topic", () => {
    const doc: ChatMessage = { role: "user", parts: [{ type: "document", name: "report.pdf", kind: "pdf", text: "Borehole BH-1: SPT N = 12 at 3 m, silty clay" }, { type: "text", text: "summarise" }] };
    expect(decide([doc]).action).toBe("allow");
    const photo: ChatMessage = { role: "user", parts: [{ type: "image", mimeType: "image/jpeg", data: "" }, { type: "text", text: "what is this?" }] };
    expect(decide([photo]).action).toBe("allow");
    const meme: ChatMessage = { role: "user", parts: [{ type: "image", mimeType: "image/jpeg", data: "" }, { type: "text", text: "write a funny poem about this" }] };
    expect(decide([meme]).action).toBe("reply");
  });
});
