import type { Snippet } from "./api";

export function Highlight({ snippet }: { snippet: Snippet }) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  snippet.ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(snippet.text.slice(cursor, start));
    parts.push(<mark key={i}>{snippet.text.slice(start, end)}</mark>);
    cursor = end;
  });
  parts.push(snippet.text.slice(cursor));
  return <>{parts}</>;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms <= 0) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours} ${hours === 1 ? "hr" : "hrs"}${remainder > 0 ? ` ${remainder} min` : ""}`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function sessionTitle(session: { name: string | null; summary: string | null; id: string }): string {
  const candidate = session.name ?? session.summary;
  if (!candidate) return session.id.slice(0, 8);
  const firstLine = candidate
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /[\p{L}\p{N}]/u.test(line));
  return firstLine ? firstLine.slice(0, 120) : session.id.slice(0, 8);
}
