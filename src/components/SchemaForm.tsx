"use client";
/**
 * Form generated from a (zod-derived) JSON schema, usable without knowing JSON:
 *  - numbers, text, yes/no, choices (select)
 *  - nested objects → grouped fields
 *  - lists of objects (rooms, bars, BOQ items, activities) → editable table with add / remove rows
 *  - lists of alternatives (point load / UDL / moment) → one card per item with a type chooser
 *  - lists of numbers or short text (areas, predecessors, holidays) → comma-separated box
 *  - grids of numbers (levels, corner points) → number grid with add row / column
 * Anything else falls back to a JSON box. "Edit as JSON" is available for power users.
 */
import { useState } from "react";
import { Plus, Trash2, Braces } from "lucide-react";

export type JSONSchema = { type?: string | string[]; properties?: Record<string, JSONSchema>; required?: string[]; enum?: unknown[]; description?: string; default?: unknown; items?: JSONSchema; anyOf?: JSONSchema[]; oneOf?: JSONSchema[]; const?: unknown; minimum?: number; maximum?: number; minItems?: number; maxItems?: number; additionalProperties?: unknown };

const typeOf = (s: JSONSchema) => (Array.isArray(s.type) ? s.type.find((t) => t !== "null") : s.type);
const variants = (s: JSONSchema) => s.anyOf ?? s.oneOf;
/** Engineering symbols keep their spelling (Mu, fck, e0, Cc); other keys read as words: "unsupportedLength" → "Unsupported length". */
const SYMBOLS = /^([A-Z][a-z]?\d*[a-z]?|[A-Z]{1,2}\d+|f[a-z]{0,2}|e0|sigma0|k|b)$/;
const ACRONYMS = new Set(["spt", "cbr", "esal", "boq", "vat", "ait", "rc", "id", "far", "dxf", "psi", "aadt"]);
export const humanize = (k: string) => {
  if (SYMBOLS.test(k)) return k;
  const words = k.replace(/_/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim().split(/\s+/).map((w) => w.toLowerCase());
  return words.map((w, i) => (ACRONYMS.has(w) ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
};
/** Choice labels: "simply_supported" → "Simply supported"; codes like "BNBC2020" or "1:2:4" stay as they are. */
const choiceLabel = (v: unknown) => { const s = String(v); return /[A-Z0-9:]/.test(s) ? s : (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " "); };
/** Short descriptions ("mm", "m per bar") make good column sub-headings; long ones go into a tooltip. */
const shortHelp = (s: JSONSchema) => (s.description && s.description.length <= 26 ? s.description : "");
/** Discriminator of a list of alternatives: the property whose value is a constant in every variant (e.g. "type"). */
function discriminator(vs: JSONSchema[]): string | null {
  const first = vs[0]?.properties ?? {};
  return Object.keys(first).find((k) => vs.every((v) => v.properties?.[k]?.const !== undefined)) ?? null;
}

export function example(s: JSONSchema): unknown {
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const vs = variants(s);
  if (vs) return example(vs[0]);
  const t = typeOf(s);
  if (t === "number" || t === "integer") return s.minimum ?? 0;
  if (t === "string") return "";
  if (t === "boolean") return false;
  if (t === "array") return s.minItems ? Array.from({ length: s.minItems }, () => example(s.items ?? {})) : [];
  if (t === "object") { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s.properties ?? {})) if (s.required?.includes(k) || v.default !== undefined) o[k] = example(v); return o; }
  return null;
}
/** A fresh list row: required fields and defaults filled, numbers left blank so the user types them. */
function blankRow(s: JSONSchema): unknown {
  const t = typeOf(s);
  if (t !== "object") return example(s);
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    if (v.const !== undefined) o[k] = v.const;
    else if (v.default !== undefined) o[k] = v.default;
    else if (s.required?.includes(k)) { const vt = typeOf(v); o[k] = vt === "number" || vt === "integer" ? undefined : example(v); }
  }
  return o;
}

export function defaultValues(schema: JSONSchema, seed: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema.properties ?? {})) {
    if (seed[k] !== undefined) out[k] = seed[k];
    else if (v.default !== undefined) out[k] = v.default;
    else if (schema.required?.includes(k)) out[k] = example(v);
  }
  return out;
}

// ---------- small inputs (also used inside table cells) ----------
function NumberInput({ value, onChange, schema, compact }: { value: unknown; onChange: (v: unknown) => void; schema: JSONSchema; compact?: boolean }) {
  return <input className={`input ${compact ? "py-1 px-2 text-xs min-w-[4.5rem]" : "mt-1"}`} type="number" step="any" inputMode="decimal" min={schema.minimum} max={schema.maximum} placeholder={schema.default !== undefined ? String(schema.default) : ""} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
}
function TextInput({ value, onChange, schema, compact }: { value: unknown; onChange: (v: unknown) => void; schema: JSONSchema; compact?: boolean }) {
  return <input className={`input ${compact ? "py-1 px-2 text-xs min-w-[7rem]" : "mt-1"}`} placeholder={schema.default !== undefined ? String(schema.default) : ""} value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)} />;
}
function Choice({ value, onChange, schema, compact }: { value: unknown; onChange: (v: unknown) => void; schema: JSONSchema; compact?: boolean }) {
  return <select className={`select ${compact ? "py-1 px-2 text-xs" : "mt-1"}`} value={String(value ?? "")} onChange={(e) => { const o = schema.enum!.find((x) => String(x) === e.target.value); onChange(e.target.value === "" ? undefined : o); }}><option value="">Select…</option>{schema.enum!.map((o) => <option key={String(o)} value={String(o)}>{choiceLabel(o)}</option>)}</select>;
}
/** Comma-separated list of numbers or short texts: "12.5, 14, 16" or "A, B SS+2". */
function ListInput({ value, onChange, itemType, compact, placeholder }: { value: unknown; onChange: (v: unknown) => void; itemType: string; compact?: boolean; placeholder?: string }) {
  const [text, setText] = useState(Array.isArray(value) ? value.join(", ") : "");
  const numeric = itemType === "number" || itemType === "integer";
  const bad = numeric && text.split(/[,\s;]+/).filter(Boolean).some((x) => Number.isNaN(Number(x)));
  return <input className={`input ${compact ? "py-1 px-2 text-xs min-w-[6rem]" : "mt-1"} ${bad ? "border-err" : ""}`} placeholder={placeholder ?? (numeric ? "e.g. 12.5, 14, 16" : "separate with commas")} value={text} onChange={(e) => {
    setText(e.target.value);
    const parts = e.target.value.split(numeric ? /[,\s;]+/ : /[,;]/).map((x) => x.trim()).filter(Boolean);
    onChange(parts.length ? (numeric ? parts.map(Number) : parts) : undefined);
  }} />;
}

/** Value editor for one schema node, without a label (tables use it for cells). */
function Editor({ schema, value, onChange, compact }: { schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; compact?: boolean }) {
  const t = typeOf(schema);
  if (schema.enum) return <Choice schema={schema} value={value} onChange={onChange} compact={compact} />;
  if (t === "number" || t === "integer") return <NumberInput schema={schema} value={value} onChange={onChange} compact={compact} />;
  if (t === "boolean") return <input type="checkbox" className="mt-1" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  if (t === "string") return <TextInput schema={schema} value={value} onChange={onChange} compact={compact} />;
  if (t === "array" && schema.items && ["number", "integer", "string"].includes(typeOf(schema.items) ?? "") && !schema.items.enum) return <ListInput value={value} onChange={onChange} itemType={typeOf(schema.items)!} compact={compact} />;
  return <JsonBox schema={schema} value={value} onChange={onChange} compact={compact} />;
}

// ---------- lists ----------
/** List of objects with simple fields → table with add / remove row. */
function RowTable({ schema, value, onChange }: { schema: JSONSchema; value: unknown; onChange: (v: unknown) => void }) {
  const item = schema.items!;
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const cols = Object.entries(item.properties ?? {});
  const set = (i: number, k: string, v: unknown) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const canRemove = rows.length > (schema.minItems ?? 0);
  return (
    <div className="mt-1">
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="w-full text-xs border-collapse">
          <thead><tr className="bg-elev2">
            <th className="px-2 py-1 text-left w-8">#</th>
            {cols.map(([k, v]) => <th key={k} className="px-2 py-1 text-left font-medium whitespace-nowrap" title={v.description}>{humanize(k)}{item.required?.includes(k) && <span className="text-accent">*</span>}{shortHelp(v) && <div className="font-normal text-muted">{shortHelp(v)}</div>}</th>)}
            <th className="w-8" />
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-border align-top">
              <td className="px-2 py-1.5 text-muted">{i + 1}</td>
              {cols.map(([k, v]) => <td key={k} className="px-1 py-1"><Editor schema={v} value={r[k]} onChange={(nv) => set(i, k, nv)} compact /></td>)}
              <td className="px-1 py-1"><button type="button" className="btn btn-sm px-1.5" disabled={!canRemove} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove row" aria-label={`Remove row ${i + 1}`}><Trash2 size={13} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm mt-2" disabled={schema.maxItems !== undefined && rows.length >= schema.maxItems} onClick={() => onChange([...rows, blankRow(item)])}><Plus size={13} /> Add row</button>
    </div>
  );
}

/** List of alternatives (e.g. point load / UDL / moment) → a card per item with a type chooser. */
function VariantList({ schema, value, onChange }: { schema: JSONSchema; value: unknown; onChange: (v: unknown) => void }) {
  const vs = variants(schema.items!)!;
  const key = discriminator(vs)!;
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const variantOf = (r: Record<string, unknown>) => vs.find((v) => v.properties![key].const === r[key]) ?? vs[0];
  const canRemove = rows.length > (schema.minItems ?? 0);
  return (
    <div className="mt-1 grid gap-2">
      {rows.map((r, i) => {
        const v = variantOf(r);
        return (
          <div key={i} className="border border-border rounded-lg p-2 flex flex-wrap items-end gap-2">
            <div><div className="text-[11px] text-muted">{humanize(key)}</div>
              <select className="select py-1 px-2 text-xs" value={String(r[key])} onChange={(e) => { const nv = vs.find((x) => String(x.properties![key].const) === e.target.value)!; onChange(rows.map((x, j) => (j === i ? (blankRow(nv) as Record<string, unknown>) : x))); }}>
                {vs.map((x) => <option key={String(x.properties![key].const)} value={String(x.properties![key].const)}>{choiceLabel(x.properties![key].const)}</option>)}
              </select>
            </div>
            {Object.entries(v.properties ?? {}).filter(([k]) => k !== key).map(([k, p]) => (
              <div key={k}><div className="text-[11px] text-muted" title={p.description}>{humanize(k)}{v.required?.includes(k) && <span className="text-accent">*</span>}{shortHelp(p) && <span> ({shortHelp(p)})</span>}</div><Editor schema={p} value={r[k]} onChange={(nv) => onChange(rows.map((x, j) => (j === i ? { ...x, [k]: nv } : x)))} compact /></div>
            ))}
            <button type="button" className="btn btn-sm px-1.5 ml-auto" disabled={!canRemove} onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove" aria-label={`Remove item ${i + 1}`}><Trash2 size={13} /></button>
          </div>
        );
      })}
      <div className="flex flex-wrap gap-2">{vs.map((x) => <button type="button" key={String(x.properties![key].const)} className="btn btn-sm" onClick={() => onChange([...rows, blankRow(x)])}><Plus size={13} /> {choiceLabel(x.properties![key].const)}</button>)}</div>
    </div>
  );
}

/** Grid of numbers (levels, corner points). Fixed width when every row must have the same length (e.g. x, y). */
function NumberGrid({ schema, value, onChange }: { schema: JSONSchema; value: unknown; onChange: (v: unknown) => void }) {
  const inner = schema.items!;
  const fixed = inner.minItems !== undefined && inner.minItems === inner.maxItems ? inner.minItems : null;
  const rows = Array.isArray(value) ? (value as (number | undefined)[][]) : [];
  const width = fixed ?? Math.max(2, ...rows.map((r) => r.length));
  const headers = fixed === 2 ? ["x", "y"] : fixed === 3 ? ["x", "y", "z"] : Array.from({ length: width }, (_, j) => `${j + 1}`);
  const set = (i: number, j: number, v: number | undefined) => onChange(rows.map((r, a) => (a === i ? Array.from({ length: width }, (_, b) => (b === j ? v : r[b])) : r)));
  return (
    <div className="mt-1">
      <div className="overflow-x-auto border border-border rounded-lg">
        <table className="text-xs border-collapse">
          <thead><tr className="bg-elev2"><th className="px-2 py-1 w-8">#</th>{headers.map((h) => <th key={h} className="px-2 py-1 font-medium">{h}</th>)}<th /></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-border">
              <td className="px-2 text-muted">{i + 1}</td>
              {headers.map((_, j) => <td key={j} className="px-1 py-1"><NumberInput schema={{}} value={r[j]} onChange={(v) => set(i, j, v as number | undefined)} compact /></td>)}
              <td className="px-1"><button type="button" className="btn btn-sm px-1.5" onClick={() => onChange(rows.filter((_, a) => a !== i))} aria-label={`Remove row ${i + 1}`}><Trash2 size={13} /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex gap-2 mt-2">
        <button type="button" className="btn btn-sm" onClick={() => onChange([...rows, new Array(width).fill(undefined)])}><Plus size={13} /> Add row</button>
        {!fixed && <button type="button" className="btn btn-sm" onClick={() => onChange(rows.length ? rows.map((r) => [...r, undefined]) : [[undefined, undefined, undefined]])}><Plus size={13} /> Add column</button>}
      </div>
    </div>
  );
}

function JsonBox({ schema, value, onChange, compact }: { schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; compact?: boolean }) {
  const [text, setText] = useState(JSON.stringify(value ?? example(schema), null, 1));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <textarea className={`textarea mt-1 font-mono text-xs ${compact ? "min-h-10" : "min-h-24"} ${err ? "border-err" : ""}`} value={text} onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setErr(null); } catch (x) { setErr((x as Error).message); } }} />
      {err && <div className="text-[11px] text-err">{err}</div>}
    </div>
  );
}

/** One object that can take several forms (e.g. plot shape): a chooser, then only that form's fields. */
function VariantObject({ name, schema, value, onChange, required }: { name: string; schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; required: boolean }) {
  const vs = variants(schema)!;
  const key = discriminator(vs)!;
  const obj = (value as Record<string, unknown>) ?? {};
  const v = vs.find((x) => x.properties![key].const === obj[key]) ?? vs[0];
  return (
    <fieldset className="border border-border rounded-lg p-2 col-span-full">
      <legend className="label px-1">{humanize(name)}{required && <span className="text-accent">*</span>}</legend>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div><label className="label">{humanize(key)}</label>
          <select className="select mt-1" value={String(v.properties![key].const)} onChange={(e) => { const nv = vs.find((x) => String(x.properties![key].const) === e.target.value)!; onChange(blankRow(nv)); }}>
            {vs.map((x) => <option key={String(x.properties![key].const)} value={String(x.properties![key].const)}>{choiceLabel(x.properties![key].const)}</option>)}
          </select>
          {v.description && <div className="text-[11px] text-muted mt-0.5">{v.description}</div>}
        </div>
        {Object.entries(v.properties ?? {}).filter(([k]) => k !== key).map(([k, p]) => <Field key={`${String(v.properties![key].const)}.${k}`} name={k} schema={p} value={obj[k]} required={!!v.required?.includes(k)} onChange={(nv) => onChange(nv === undefined ? Object.fromEntries(Object.entries(obj).filter(([kk]) => kk !== k)) : { ...obj, [k]: nv })} />)}
      </div>
    </fieldset>
  );
}

// ---------- labelled field ----------
function Field({ name, schema, value, onChange, required }: { name: string; schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; required: boolean }) {
  const t = typeOf(schema);
  const label = <label className="label flex items-center gap-1" title={schema.description}>{humanize(name)}{required && <span className="text-accent">*</span>}</label>;
  const help = schema.description && <div className="text-[11px] text-muted mt-0.5">{schema.description}</div>;
  { const vs = variants(schema); if (vs && t !== "array" && discriminator(vs)) return <VariantObject name={name} schema={schema} value={value} onChange={onChange} required={required} />; }
  if (t === "boolean") return <label className="flex items-start gap-2 pt-5 text-sm"><input type="checkbox" className="mt-1" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> <span>{humanize(name)}{help}</span></label>;
  if (t === "object" && schema.properties) {
    const obj = (value as Record<string, unknown>) ?? {};
    return (
      <fieldset className="border border-border rounded-lg p-2 col-span-full">
        <legend className="label px-1">{humanize(name)}{required && <span className="text-accent">*</span>}</legend>
        {help}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(schema.properties).map(([k, v]) => <Field key={k} name={k} schema={v} value={obj[k]} required={!!schema.required?.includes(k)} onChange={(nv) => onChange(nv === undefined ? Object.fromEntries(Object.entries(obj).filter(([kk]) => kk !== k)) : { ...obj, [k]: nv })} />)}
        </div>
      </fieldset>
    );
  }
  if (t === "array" && schema.items) {
    const it = schema.items, itT = typeOf(it), vs = variants(it);
    let body: React.ReactNode = null;
    if (itT === "object" && it.properties && Object.values(it.properties).every((p) => typeOf(p) !== "object" && typeOf(p) !== "array" || (typeOf(p) === "array" && ["number", "integer", "string"].includes(typeOf(p.items ?? {}) ?? "")))) body = <RowTable schema={schema} value={value} onChange={onChange} />;
    else if (vs && discriminator(vs)) body = <VariantList schema={schema} value={value} onChange={onChange} />;
    else if (itT === "array" && ["number", "integer"].includes(typeOf(it.items ?? {}) ?? "")) body = <NumberGrid schema={schema} value={value} onChange={onChange} />;
    if (body) return <div className="col-span-full">{label}{help}{body}</div>;
    if (["number", "integer", "string"].includes(itT ?? "")) return <div className="col-span-full md:col-span-2">{label}<Editor schema={schema} value={value} onChange={onChange} />{help}</div>;
  }
  if (schema.enum || t === "number" || t === "integer" || t === "string") return <div>{label}<Editor schema={schema} value={value} onChange={onChange} />{help}</div>;
  return <div className="col-span-full">{label}<JsonBox schema={schema} value={value} onChange={onChange} />{help}</div>;
}

export function SchemaForm({ schema, values, onChange }: { schema: JSONSchema; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  const [asJson, setAsJson] = useState(false);
  const [rev, setRev] = useState(0); // remount the form fields after a JSON edit so list boxes pick up the new values
  return (
    <div>
      <div className="flex justify-end -mt-1 mb-1">
        <button type="button" className="text-xs text-muted hover:text-fg flex items-center gap-1" onClick={() => { setAsJson((v) => !v); setRev((r) => r + 1); }}><Braces size={12} /> {asJson ? "Back to form" : "Edit as JSON"}</button>
      </div>
      {asJson ? (
        <JsonBox schema={schema} value={values} onChange={(v) => { if (v && typeof v === "object" && !Array.isArray(v)) onChange(v as Record<string, unknown>); }} />
      ) : (
        <div key={rev} className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(schema.properties ?? {}).map(([k, v]) => (
            <Field key={k} name={k} schema={v} value={values[k]} required={!!schema.required?.includes(k)} onChange={(nv) => onChange(nv === undefined ? Object.fromEntries(Object.entries(values).filter(([kk]) => kk !== k)) : { ...values, [k]: nv })} />
          ))}
        </div>
      )}
    </div>
  );
}
