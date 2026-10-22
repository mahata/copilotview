const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const PERIODS: { value: string; label: string; days?: number }[] = [
  { value: "", label: "All time" },
  { value: "24h", label: "Past 24 hours", days: 1 },
  { value: "7d", label: "Past 7 days", days: 7 },
  { value: "30d", label: "Past 30 days", days: 30 },
  { value: "90d", label: "Past 90 days", days: 90 },
  { value: "1y", label: "Past year", days: 365 },
];

export function periodStart(period: string, now: number): string | undefined {
  const days = PERIODS.find((preset) => preset.value === period)?.days;
  return days === undefined ? undefined : new Date(now - days * MS_PER_DAY).toISOString();
}
