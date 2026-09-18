"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/** House style: no em dashes or " -- " in displayed text (models sometimes add them despite the prompt). Code blocks untouched. */
export function tidyDashes(text: string): string {
  return text.split(/(```[\s\S]*?```|`[^`]*`)/g).map((seg, i) => (i % 2 ? seg : seg.replace(/\s+—\s+/g, ", ").replace(/—/g, "-").replace(/ -- /g, ", "))).join("");
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false, output: "html" }]]}>{tidyDashes(text)}</ReactMarkdown>
    </div>
  );
}
