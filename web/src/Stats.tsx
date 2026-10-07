import { useEffect, useState } from "react";
import { api, type Stats } from "./api";
import { formatBytes } from "./ui";

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

export function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty">Failed to load: {error}</div>;
  if (!stats) return <div className="empty">Loading...</div>;

  return (
    <>
      <div className="result-count">Statistics for the complete index</div>

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
      </div>

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
          <h2>Branches</h2>
          <Bars rows={stats.branches.map((b) => ({ label: b.branch, value: b.count }))} />
        </section>
      </div>
    </>
  );
}
