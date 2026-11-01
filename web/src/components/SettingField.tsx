"use client";

import type { SettingDef } from "@/lib/settings-schema";

export function Field({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: string;
  onChange: (v: string) => void;
}) {
  if (def.type === "boolean") {
    return (
      <label className="setting-toggle">
        <input type="checkbox" checked={value !== "false"} onChange={(e) => onChange(e.target.checked ? "true" : "false")} />
        <span>{value !== "false" ? "On" : "Off"}</span>
      </label>
    );
  }
  if (def.type === "select") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {(def.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (def.type === "textarea") {
    return (
      <textarea
        value={value}
        placeholder={def.placeholder}
        rows={3}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      type={def.type === "password" ? "password" : def.type === "number" ? "number" : "text"}
      value={value}
      placeholder={def.placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SettingRow({
  def,
  value,
  onChange,
}: {
  def: SettingDef;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="setting-row">
      <label htmlFor={def.key}>
        {def.label}
        <code>{def.key}</code>
      </label>
      <div className="setting-input">
        <Field def={def} value={value} onChange={onChange} />
        {def.hint && (
          <p className="hint">
            {def.hint}
            {def.link && (
              <>
                {" "}
                <a href={def.link.href} target="_blank" rel="noopener noreferrer">{def.link.label}</a>
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
