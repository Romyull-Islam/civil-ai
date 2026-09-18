"use client";
import type { Conversation, UIMessage } from "@/lib/db";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "chat";

function toolLines(m: UIMessage, id: string, name: string): string {
  const out = m.toolOutputs?.[id];
  if (!out) return `> ${name}`;
  if (out.error) return `> ${name}: error, ${out.error}`;
  const d = out.display;
  const extra = d?.kind === "steps" ? "\n" + d.steps.map((s) => `>   - ${s}`).join("\n") + (d.checks?.length ? "\n" + d.checks.map((c) => `>   - ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}`).join("\n") : "")
    : d?.kind === "table" ? "\n\n" + [`| ${d.columns.join(" | ")} |`, `|${d.columns.map(() => "---").join("|")}|`, ...d.rows.map((r) => `| ${r.map(String).join(" | ")} |`)].join("\n") + "\n"
    : d?.kind === "drawing" ? `\n>   (drawing: ${d.drawing.title}; open the share link or the app to view/download DXF)` : "";
  return `> **${name}:** ${out.summary ?? ""}${extra}`;
}

/** Readable Markdown transcript (questions, answers, calculator results and tables). */
export function conversationToMarkdown(c: Conversation): string {
  const lines = [`# ${c.title}`, "", `_Exported from CivilMate on ${new Date().toLocaleString()}. Preliminary results; verify with a licensed engineer._`, ""];
  for (const m of c.messages) {
    if (m.role === "tool") continue;
    lines.push(m.role === "user" ? "## You" : "## CivilMate", "");
    for (const p of m.parts) {
      if (p.type === "text") lines.push(p.text, "");
      else if (p.type === "image") lines.push("_[image attached]_", "");
      else if (p.type === "tool_call") lines.push(toolLines(m, p.id, p.name), "");
    }
    if (m.meta?.error) lines.push(`_Error: ${m.meta.error}_`, "");
  }
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, type = "text/markdown") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export const downloadMarkdown = (c: Conversation) => downloadText(`${slug(c.title)}.md`, conversationToMarkdown(c));
export const downloadJson = (c: Conversation) => downloadText(`${slug(c.title)}.json`, JSON.stringify({ app: "civil-ai", version: 1, exportedAt: new Date().toISOString(), conversations: [c] }, null, 1), "application/json");
