export const SAVED_DATE_OPTIONS = [
  ["", "All dates"], ["today", "Saved today"], ["yesterday", "Saved yesterday"],
  ["this_week", "This week"], ["last_week", "Last week"], ["custom", "Date range…"],
] as const;
export type SavedDatePreset = typeof SAVED_DATE_OPTIONS[number][0];
export interface SavedDateRange { savedFrom?: string; savedBefore?: string }

export function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDay(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Choose a start and end date.");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (localDateInput(date) !== value) throw new Error("Choose a valid date.");
  return date;
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + count); // Calendar days, including DST changes.
  return result;
}

export function savedDateRange(preset: SavedDatePreset, start = "", end = "", now = new Date()): SavedDateRange {
  if (!preset) return {};
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from = today;
  let before = addDays(today, 1);
  switch (preset) {
    case "yesterday": from = addDays(today, -1); before = today; break;
    case "this_week":
    case "last_week": {
      const monday = addDays(today, -((today.getDay() + 6) % 7));
      from = preset === "last_week" ? addDays(monday, -7) : monday;
      before = addDays(from, 7);
      break;
    }
    case "custom":
      from = localDay(start);
      before = addDays(localDay(end), 1);
      if (from >= before) throw new Error("End date must be on or after start date.");
  }
  return { savedFrom: from.toISOString(), savedBefore: before.toISOString() };
}

/** API bounds are UTC instants; the exclusive upper bound includes the entire
 * locally selected end day without assuming that every day has 24 hours. */
export function parseSavedDateRange(params: URLSearchParams): SavedDateRange {
  function instant(name: string): string | undefined {
    const value = params.get(name);
    if (value === null) return undefined;
    const parsed = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
        || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== value.slice(0, 19)) {
      throw new Error(`${name} must be a valid UTC timestamp.`);
    }
    return parsed.toISOString();
  }
  const savedFrom = instant("saved_from"), savedBefore = instant("saved_before");
  if (savedFrom && savedBefore && savedFrom >= savedBefore) {
    throw new Error("Saved date range must end after it starts.");
  }
  return { savedFrom, savedBefore };
}

export function savedDateClauses(range: SavedDateRange, params: unknown[]): string[] {
  const clauses: string[] = [];
  if (range.savedFrom) {
    params.push(range.savedFrom);
    clauses.push(`b.saved_at >= $${params.length}::timestamptz`);
  }
  if (range.savedBefore) {
    params.push(range.savedBefore);
    clauses.push(`b.saved_at < $${params.length}::timestamptz`);
  }
  return clauses;
}
