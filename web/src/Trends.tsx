import { memo, useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { api, type TrendBucket, type TrendInterval, type Trends } from "./api";
import {
  bucketAxisLabel,
  bucketIndexAt,
  describeSpan,
  formatAxisMax,
  niceAxisMax,
  tickIndexes,
  totalByModel,
} from "./chart";
import { describePeriod, periodRange, type PeriodSelection } from "./period";
import { formatAiCredits, formatCount } from "./ui";

export type IntervalChoice = TrendInterval | "auto";

const INTERVAL_CHOICES: { value: IntervalChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
];

/** The narrowest space an axis label of each interval needs, in pixels. */
const AXIS_LABEL_SPACING: Record<TrendInterval, number> = { hour: 104, day: 64, week: 64, month: 80 };

interface Series {
  title: string;
  values: number[];
  formatValue: (value: number) => string;
}

function chartSeries(buckets: TrendBucket[]): Series[] {
  return [
    { title: "AI credits", values: buckets.map((b) => b.aiCredits ?? 0), formatValue: formatAiCredits },
    { title: "Active sessions", values: buckets.map((b) => b.sessions), formatValue: (n) => n.toLocaleString() },
    {
      title: "Messages",
      values: buckets.map((b) => b.userMessages + b.assistantMessages),
      formatValue: (n) => n.toLocaleString(),
    },
  ];
}

function useElementWidth(): [(element: HTMLElement | null) => void, number] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return [setElement, width];
}

function barGap(count: number): number {
  return count > 120 ? 0.1 : 0.25;
}

/** In hundredths of the chart's height; the smallest values stay visible as a sliver. */
function barHeight(value: number, axisMax: number): number {
  return Math.max((value / axisMax) * 100, 1);
}

const Bars = memo(function Bars({ values, axisMax }: { values: number[]; axisMax: number }) {
  const gap = barGap(values.length);
  return (
    <g className="chart__bars">
      {values.map((value, index) => {
        if (value <= 0) return null;
        const height = barHeight(value, axisMax);
        return <rect key={index} x={index + gap / 2} y={100 - height} width={1 - gap} height={height} />;
      })}
    </g>
  );
});

function TrendChart({
  series,
  buckets,
  interval,
  timeZone,
  selected,
}: {
  series: Series;
  buckets: TrendBucket[];
  interval: TrendInterval;
  timeZone: string;
  selected: number | null;
}) {
  const { title, values, formatValue } = series;
  const count = values.length;
  const peak = values.reduce((best, value, index) => (value > (values[best] ?? 0) ? index : best), 0);
  const peakValue = values[peak] ?? 0;
  const peakBucket = buckets[peak];
  const axisMax = niceAxisMax(peakValue);
  const selectedValue = selected === null ? 0 : (values[selected] ?? 0);
  const gap = barGap(count);
  const description =
    peakBucket && peakValue > 0
      ? `${title} by ${interval}, highest ${formatValue(peakValue)} on ${describeSpan(peakBucket.start, peakBucket.end, interval, timeZone)}`
      : `${title} by ${interval}, none in this period`;

  return (
    <section className="chart">
      <h2 className="chart__title">{title}</h2>
      <div className="chart__area">
        <span className="chart__max" aria-hidden="true">
          {formatAxisMax(axisMax)}
        </span>
        <svg
          className="chart__plot"
          viewBox={`0 0 ${count} 100`}
          preserveAspectRatio="none"
          role="img"
          aria-label={description}
          data-selection={selected === null ? undefined : ""}
        >
          <line className="chart__gridline" x1={0} x2={count} y1={0} y2={0} vectorEffect="non-scaling-stroke" />
          {selected !== null && <rect className="chart__band" x={selected} y={0} width={1} height={100} />}
          <Bars values={values} axisMax={axisMax} />
          {selected !== null && selectedValue > 0 && (
            <rect
              className="chart__bar--selected"
              x={selected + gap / 2}
              y={100 - barHeight(selectedValue, axisMax)}
              width={1 - gap}
              height={barHeight(selectedValue, axisMax)}
            />
          )}
          <line className="chart__baseline" x1={0} x2={count} y1={100} y2={100} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
    </section>
  );
}

function BucketAxis({ buckets, interval, timeZone }: { buckets: TrendBucket[]; interval: TrendInterval; timeZone: string }) {
  const [measure, width] = useElementWidth();
  const maxTicks = Math.max(2, Math.floor(width / AXIS_LABEL_SPACING[interval]));
  return (
    <div className="chart-axis" ref={measure} aria-hidden="true">
      {width > 0 &&
        tickIndexes(buckets.length, maxTicks).map((index) => {
          const center = (index + 0.5) / buckets.length;
          const align = center < 0.06 ? "start" : center > 0.94 ? "end" : "middle";
          return (
            <span
              key={index}
              className={`chart-axis__label chart-axis__label--${align}`}
              style={{ left: `${(align === "start" ? index / buckets.length : center) * 100}%` }}
            >
              {bucketAxisLabel(buckets[index]!.start, interval, timeZone)}
            </span>
          );
        })}
    </div>
  );
}

const MAX_LISTED_MODELS = 5;

function Readout({ trends, selected }: { trends: Trends; selected: number | null }) {
  const { buckets, interval, timeZone } = trends;
  const periodModels = useMemo(() => totalByModel(buckets), [buckets]);
  const bucket = selected === null ? undefined : buckets[selected];
  const first = buckets[0]!;
  const last = buckets[buckets.length - 1]!;
  const counts = bucket ?? trends.totals;
  const models = bucket ? bucket.models : periodModels;
  const otherModels = models.slice(MAX_LISTED_MODELS);
  const otherModelsCredits = otherModels.reduce<number | null>(
    (sum, model) => (model.aiCredits === null ? sum : (sum ?? 0) + model.aiCredits),
    null,
  );
  const messages = counts.userMessages + counts.assistantMessages;

  return (
    <aside className="readout" aria-live="polite">
      <div className="readout__span">
        {bucket
          ? describeSpan(bucket.start, bucket.end, interval, timeZone)
          : describeSpan(first.start, last.end, interval, timeZone)}
      </div>
      <dl className="readout__values">
        <dt>AI credits</dt>
        <dd>{counts.aiCredits === null ? "Not recorded" : formatAiCredits(counts.aiCredits)}</dd>
        <dt>Requests</dt>
        <dd>{counts.requests.toLocaleString()}</dd>
        <dt>Active sessions</dt>
        <dd>{counts.sessions.toLocaleString()}</dd>
        <dt>Messages</dt>
        <dd>{messages.toLocaleString()}</dd>
        <dt className="readout__detail">From you</dt>
        <dd className="readout__detail">{counts.userMessages.toLocaleString()}</dd>
        <dt className="readout__detail">From Copilot</dt>
        <dd className="readout__detail">{counts.assistantMessages.toLocaleString()}</dd>
      </dl>
      {models.length > 0 && (
        <>
          <h3 className="readout__heading">AI credits by model</h3>
          <ul className="readout__models">
            {models.slice(0, MAX_LISTED_MODELS).map((model) => (
              <li key={model.model}>
                <span className="readout__model" title={model.model}>
                  {model.model}
                </span>
                <span>{model.aiCredits === null ? "Not recorded" : formatAiCredits(model.aiCredits)}</span>
              </li>
            ))}
            {otherModels.length > 0 && (
              <li>
                <span className="readout__model">{formatCount(otherModels.length, "other model")}</span>
                <span>{otherModelsCredits === null ? "Not recorded" : formatAiCredits(otherModelsCredits)}</span>
              </li>
            )}
          </ul>
        </>
      )}
      {!bucket && (
        <p className="readout__hint">
          Point at the charts, or focus them and use the arrow keys, to see a single {interval}.
        </p>
      )}
    </aside>
  );
}

function IntervalSwitch({ value, onChange }: { value: IntervalChoice; onChange: (value: IntervalChoice) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Interval">
      {INTERVAL_CHOICES.map((choice) => (
        <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

export function TrendsView({
  period,
  periodFrom,
  periodTo,
  interval,
  onIntervalChange,
}: PeriodSelection & { interval: IntervalChoice; onIntervalChange: (interval: IntervalChoice) => void }) {
  const [trends, setTrends] = useState<Trends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .trends({
        ...periodRange({ period, periodFrom, periodTo }, Date.now()),
        interval,
        tz: new Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      .then((result) => {
        if (cancelled) return;
        setTrends(result);
        setSelected(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, periodFrom, periodTo, interval]);

  const series = useMemo(() => (trends ? chartSeries(trends.buckets) : []), [trends]);
  const count = trends?.buckets.length ?? 0;

  const selectAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (count > 0 && bounds.width > 0) setSelected(bucketIndexAt(event.clientX - bounds.left, bounds.width, count));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, (current: number | null) => number | null> = {
      ArrowLeft: (current) => (current === null ? count - 1 : Math.max(current - 1, 0)),
      ArrowRight: (current) => (current === null ? 0 : Math.min(current + 1, count - 1)),
      Home: () => 0,
      End: () => count - 1,
      Escape: () => null,
    };
    const move = moves[event.key];
    if (!move || count === 0) return;
    event.preventDefault();
    setSelected(move);
  };

  const selection = { period, periodFrom, periodTo };
  const describedPeriod = describePeriod(selection);
  const coversWholeIndex = Object.values(periodRange(selection, Date.now())).every((bound) => bound === undefined);
  const coarsened = trends !== null && interval !== "auto" && trends.interval !== interval;
  const hasActivity = trends !== null && trends.totals.sessions > 0;

  let content: ReactNode;
  if (error) {
    content = <div className="empty">Failed to load: {error}</div>;
  } else if (!trends) {
    content = <div className="empty">Loading...</div>;
  } else if (!hasActivity) {
    content = (
      <div className="empty">
        No activity {coversWholeIndex ? "has been indexed yet" : "in this period"}. Sessions that changed after
        copilotview started appear once you run <code>copilotview index</code> or restart <code>serve</code>.
      </div>
    );
  } else {
    content = (
      <>
        <div className="trends" aria-busy={loading}>
          <div
            className="trends__charts"
            role="group"
            aria-label={`Charts by ${trends.interval}. Use the left and right arrow keys to inspect each ${trends.interval}.`}
            tabIndex={0}
            onPointerDown={selectAt}
            onPointerMove={selectAt}
            onPointerLeave={(event) => {
              if (event.pointerType === "mouse") setSelected(null);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => setSelected(null)}
          >
            {series.map((s) => (
              <TrendChart
                key={s.title}
                series={s}
                buckets={trends.buckets}
                interval={trends.interval}
                timeZone={trends.timeZone}
                selected={selected}
              />
            ))}
            <BucketAxis buckets={trends.buckets} interval={trends.interval} timeZone={trends.timeZone} />
          </div>
          <Readout trends={trends} selected={selected} />
        </div>
        {trends.totals.requestsWithoutAiCredits > 0 && (
          <div className="stat-note trends__note">
            AI credits don't include {formatCount(trends.totals.requestsWithoutAiCredits, "request")} recorded by CLI
            versions that didn't report AI credits.
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="trends-toolbar">
        <div className="result-count">
          Trends {describedPeriod}
          {trends && hasActivity && `, by ${trends.interval}`}
        </div>
        <IntervalSwitch value={interval} onChange={onIntervalChange} />
      </div>
      {coarsened && hasActivity && (
        <div className="hint trends__hint">
          There are too many {interval}s in this period to chart, so it's shown by {trends.interval}.
        </div>
      )}
      {content}
    </>
  );
}
