"use client";

import { useState } from "react";
import { localDateInput, savedDateRange, SAVED_DATE_OPTIONS, type SavedDatePreset, type SavedDateRange } from "@/lib/saved-dates";

export default function SavedDateFilter({ onChange }: { onChange: (range: SavedDateRange, label: string) => void }) {
  const [preset, setPreset] = useState<SavedDatePreset>("");
  const [start, setStart] = useState(() => localDateInput(new Date()));
  const [end, setEnd] = useState(() => localDateInput(new Date()));
  const [error, setError] = useState("");

  function apply(value: SavedDatePreset) {
    try {
      const range = savedDateRange(value, start, end);
      onChange(range, value === "custom" ? `${start} – ${end}` : SAVED_DATE_OPTIONS.find(([key]) => key === value)?.[1] ?? "");
      setError("");
    } catch (error) { setError((error as Error).message); }
  }

  return <section className="saved-date-filter" aria-label="Saved date">
    <label className="side-section" htmlFor="saved-date-preset">Saved date</label>
    <select id="saved-date-preset" value={preset} onChange={(event) => {
      const value = event.target.value as SavedDatePreset;
      setPreset(value);
      setError("");
      if (value !== "custom") apply(value);
    }}>
      {SAVED_DATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {preset === "custom" && <form className="saved-date-inputs" onSubmit={(event) => { event.preventDefault(); apply("custom"); }}>
      <label>From<input aria-label="Saved from" type="date" required value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Through<input aria-label="Saved through" type="date" required value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} /></label>
      <button className="btn" type="submit">Apply date range</button>
      {error && <p role="alert">{error}</p>}
    </form>}
    <p className="hint">Local dates · Monday–Sunday weeks. The end date is included.</p>
  </section>;
}
