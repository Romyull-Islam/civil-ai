"use client";
/** Generic form generated from a (zod-derived) JSON schema. Handles number/string/boolean/enum, nested objects, arrays (as JSON), unions (as JSON). */
import { useState } from "react";

type JSONSchema = { type?: string | string[]; properties?: Record<string, JSONSchema>; required?: string[]; enum?: unknown[]; description?: string; default?: unknown; items?: JSONSchema; anyOf?: JSONSchema[]; oneOf?: JSONSchema[]; const?: unknown; minimum?: number; additionalProperties?: unknown };

function example(s: JSONSchema): unknown {
  if (s.default !== undefined) return s.default;
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  const variants = s.anyOf ?? s.oneOf;
  if (variants) return example(variants[0]);
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  if (t === "number" || t === "integer") return s.minimum ?? 0;
  if (t === "string") return "";
  if (t === "boolean") return false;
  if (t === "array") return [example(s.items ?? {})];
  if (t === "object") { const o: Record<string, unknown> = {}; for (const [k, v] of Object.entries(s.properties ?? {})) if (s.required?.includes(k) || v.default !== undefined) o[k] = example(v); return o; }
  return null;
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

function Field({ name, schema, value, onChange, required }: { name: string; schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; required: boolean }) {
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  const label = <label className="label flex items-center gap-1">{name}{required && <span className="text-accent">*</span>}</label>;
  const help = schema.description && <div className="text-[11px] text-muted mt-0.5">{schema.description}</div>;
  if (schema.enum) {
    return <div>{label}<select className="select mt-1" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{schema.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>{help}</div>;
  }
  if (t === "number" || t === "integer") {
    return <div>{label}<input className="input mt-1" type="number" step="any" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />{help}</div>;
  }
  if (t === "boolean") {
    return <div className="flex items-center gap-2 pt-5"><input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /> <span className="text-sm">{name}</span>{help}</div>;
  }
  if (t === "string") {
    return <div>{label}<input className="input mt-1" value={String(value ?? "")} onChange={(e) => onChange(e.target.value || undefined)} />{help}</div>;
  }
  if (t === "object" && schema.properties) {
    const obj = (value as Record<string, unknown>) ?? {};
    return (
      <fieldset className="border border-border rounded-lg p-2 col-span-full">
        <legend className="label px-1">{name}{required && <span className="text-accent">*</span>}</legend>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {Object.entries(schema.properties).map(([k, v]) => <Field key={k} name={k} schema={v} value={obj[k]} required={!!schema.required?.includes(k)} onChange={(nv) => onChange({ ...obj, [k]: nv })} />)}
        </div>
        {help}
      </fieldset>
    );
  }
  // arrays / unions → JSON editor
  return <JsonField name={name} schema={schema} value={value} onChange={onChange} required={required} />;
}

function JsonField({ name, schema, value, onChange, required }: { name: string; schema: JSONSchema; value: unknown; onChange: (v: unknown) => void; required: boolean }) {
  const [text, setText] = useState(JSON.stringify(value ?? example(schema), null, 1));
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="col-span-full">
      <label className="label">{name}{required && <span className="text-accent">*</span>} <span className="normal-case">(JSON)</span></label>
      <textarea className={`textarea mt-1 font-mono text-xs min-h-24 ${err ? "border-err" : ""}`} value={text} onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setErr(null); } catch (x) { setErr((x as Error).message); } }} />
      {schema.description && <div className="text-[11px] text-muted mt-0.5">{schema.description}</div>}
      {err && <div className="text-[11px] text-err">{err}</div>}
    </div>
  );
}

export function SchemaForm({ schema, values, onChange }: { schema: JSONSchema; values: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {Object.entries(schema.properties ?? {}).map(([k, v]) => (
        <Field key={k} name={k} schema={v} value={values[k]} required={!!schema.required?.includes(k)} onChange={(nv) => onChange({ ...values, [k]: nv })} />
      ))}
    </div>
  );
}
