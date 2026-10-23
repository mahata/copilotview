import { useEffect, useState } from "react";
import { api, type Stats } from "./api";
import { describePeriod, periodRange, type PeriodSelection } from "./period";
import {
  formatAiCredits,
  formatBytes,
  formatCount,
  formatMilliseconds,
  formatTokens,
} from "./ui";

function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="bars">
      {rows.map((row) => (
        <div className="bar" key={row.label}>
          <span className="bar__label" title={row.label}>
            {row.label}
          </span>
          <span className="bar__track">
            <span className="bar__fill" style={{ width: `${(row.value / max) * 100}%` }} />
          </span>
          <span>{row.note ?? row.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsView({ period, periodFrom, periodTo }: PeriodSelection) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStats(null);
    setError(null);
    api
      .stats(periodRange({ period, periodFrom, periodTo }, Date.now()))
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [period, periodFrom, periodTo]);

  if (error) return <div className="empty">Failed to load: {error}</div>;
  if (!stats) return <div className="empty">Loading...</div>;

  const { usage } = stats;
  const cachedShare = usage.inputTokens > 0 ? Math.round((usage.cacheReadTokens / usage.inputTokens) * 100) : null;
  const tokensByModel = [...stats.usageByModel].sort(
    (a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
  const toolDurations = stats.tools
    .flatMap((t) => (t.medianDurationMs === null ? [] : [{ toolName: t.toolName, ms: t.medianDurationMs }]))
    .sort((a, b) => b.ms - a.ms);

  return (
    <>
      <div className="result-count">Statistics {describePeriod({ period, periodFrom, periodTo })}</div>

      <div className="stat-grid">
        <div className="stat">
          <div className="stat__value">{stats.sessionCount.toLocaleString()}</div>
          <div className="stat__label">Sessions</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.messageCount.toLocaleString()}</div>
          <div className="stat__label">Messages</div>
        </div>
        <div className="stat">
          <div className="stat__value">{stats.toolCallCount.toLocaleString()}</div>
          <div className="stat__label">Tool calls</div>
        </div>
        <div className="stat">
          <div className="stat__value">{formatBytes(stats.indexedBytes)}</div>
          <div className="stat__label">Source data</div>
        </div>
        <div className="stat">
          <div className="stat__value">{usage.aiCredits === null ? "—" : formatAiCredits(usage.aiCredits)}</div>
          <div className="stat__label">AI credits</div>
        </div>
        <div className="stat">
          <div className="stat__value">{formatTokens(usage.inputTokens)}</div>
          <div className="stat__label">Input tokens{cachedShare !== null && ` (${cachedShare}% cached)`}</div>
        </div>
        <div className="stat">
          <div className="stat__value">{formatTokens(usage.outputTokens)}</div>
          <div className="stat__label">Output tokens</div>
        </div>
        <div className="stat">
          <div className="stat__value">+{stats.codeChanges.linesAdded.toLocaleString()}</div>
          <div className="stat__label">Lines added</div>
        </div>
        <div className="stat">
          <div className="stat__value">−{stats.codeChanges.linesRemoved.toLocaleString()}</div>
          <div className="stat__label">Lines removed</div>
        </div>
      </div>

      {stats.sessionsWithUnrecordedUsage > 0 && (
        <div className="stat-note">
          Usage doesn't include CLI runs in {formatCount(stats.sessionsWithUnrecordedUsage, "session")} that ended
          without recording it, for example because the CLI crashed.
        </div>
      )}

      {stats.sessionsWithoutAiCredits > 0 && (
        <div className="stat-note">
          AI credits don't include usage in {formatCount(stats.sessionsWithoutAiCredits, "session")} recorded by CLI
          versions that didn't report AI credits.
        </div>
      )}

      <div className="columns">
        <section className="section">
          <h2>Sessions by month</h2>
          <Bars rows={stats.monthly.map((m) => ({ label: m.month, value: m.count }))} />
        </section>

        <section className="section">
          <h2>Repositories</h2>
          <Bars rows={stats.repositories.map((r) => ({ label: r.repository, value: r.count }))} />
        </section>

        <section className="section">
          <h2>Models</h2>
          <Bars rows={stats.models.map((m) => ({ label: m.model, value: m.count }))} />
        </section>

        <section className="section">
          <h2>AI credits by model</h2>
          <Bars
            rows={stats.usageByModel.flatMap((m) =>
              m.aiCredits !== null && m.aiCredits > 0
                ? [
                    {
                      label: m.model,
                      value: m.aiCredits,
                      note: `${formatAiCredits(m.aiCredits)} (${formatCount(m.requests, "request")})`,
                    },
                  ]
                : [],
            )}
          />
        </section>

        <section className="section">
          <h2>Tokens by model</h2>
          <Bars
            rows={tokensByModel.map((m) => ({
              label: m.model,
              value: m.inputTokens + m.outputTokens,
              note: `${formatTokens(m.inputTokens)} in / ${formatTokens(m.outputTokens)} out`,
            }))}
          />
        </section>

        <section className="section">
          <h2>Tools</h2>
          <Bars
            rows={stats.tools.map((t) => ({
              label: t.toolName,
              value: t.count,
              note: t.failures > 0 ? `${t.count.toLocaleString()} (${t.failures.toLocaleString()} failed)` : undefined,
            }))}
          />
        </section>

        <section className="section">
          <h2>Median tool duration</h2>
          <Bars rows={toolDurations.map((t) => ({ label: t.toolName, value: t.ms, note: formatMilliseconds(t.ms) }))} />
        </section>

        <section className="section">
          <h2>Branches</h2>
          <Bars rows={stats.branches.map((b) => ({ label: b.branch, value: b.count }))} />
        </section>
      </div>
    </>
  );
}
