import { useEffect, useState } from "react";
import { api, type SessionDetail, type TimelineEntry } from "./api";
import { formatCount, formatDate, formatDuration, sessionTitle } from "./ui";

const ARTIFACT_LABEL: Record<string, string> = {
  plan: "Plan",
  checkpoint: "Checkpoint",
  completion: "Completion report",
};

function ToolLine({ entry }: { entry: Extract<TimelineEntry, { kind: "tool" }> }) {
  return (
    <div className={`tool-line${entry.success === 0 ? " tool-line--failed" : ""}`}>
      <span className="tool-line__name">{entry.toolName}</span>
      <span className="tool-line__target">{entry.target ?? ""}</span>
      {entry.success === 0 && <span>Failed</span>}
    </div>
  );
}

function Turn({ entry }: { entry: Extract<TimelineEntry, { kind: "message" }> }) {
  return (
    <div className={`turn turn--${entry.role}`}>
      <div className="turn__gutter">
        <div>{entry.role === "user" ? "Me" : "Copilot"}</div>
        <div>{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString("ja-JP") : ""}</div>
        {entry.isSubagent && <div>subagent</div>}
      </div>
      <div className="turn__body">
        <pre className="body">{entry.content}</pre>
      </div>
    </div>
  );
}

export function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [showTools, setShowTools] = useState(true);
  const [showSubagent, setShowSubagent] = useState(false);
  const [showInjected, setShowInjected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .session(id)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setEntries([]);
    setError(null);
    api
      .timeline(id, { tools: showTools ? "1" : "0", subagent: showSubagent ? "1" : "0", injected: showInjected ? "1" : "0" })
      .then((r) => {
        if (!cancelled) setEntries(r.entries);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, showTools, showSubagent, showInjected]);

  if (error) return <div className="empty">Failed to load: {error}</div>;
  if (!detail) return <div className="empty">Loading...</div>;

  const { session } = detail;

  return (
    <>
      <button className="back" onClick={onBack}>
        ← Back to sessions
      </button>

      <div className="detail__header">
        <h1 className="detail__title">{sessionTitle(session)}</h1>
        <div className="card__meta">
          {session.repository && <span className="badge">{session.repository}</span>}
          {session.branch && <span className="badge">{session.branch}</span>}
          {session.models.map((m) => (
            <span className="badge" key={m}>
              {m}
            </span>
          ))}
        </div>
        <dl className="kv">
          <dt>Period</dt>
          <dd>
            {formatDate(session.startedAt ?? session.createdAt)} – {formatDate(session.endedAt ?? session.updatedAt)} (
            {formatDuration(session.durationMs)})
          </dd>
          <dt>Working directory</dt>
          <dd>{session.cwd ?? "—"}</dd>
          <dt>Activity</dt>
          <dd>
            {formatCount(session.userMessageCount, "message")} from me /{" "}
            {formatCount(session.assistantMessageCount, "message")} from Copilot,{" "}
            {formatCount(session.toolCallCount, "tool call")}, {formatCount(session.fileCount, "file")}
          </dd>
          <dt>Session ID</dt>
          <dd>{session.id}</dd>
          <dt>Source data</dt>
          <dd>
            {session.dirPath}
            {session.malformedLines > 0 && ` (${session.malformedLines} malformed lines)`}
          </dd>
        </dl>
      </div>

      {detail.artifacts.length > 0 && (
        <section className="section">
          <h2>Summaries and plans</h2>
          {detail.artifacts.map((artifact, i) => (
            <details className="artifact" key={i} open={i === 0 && artifact.kind === "completion"}>
              <summary>
                {ARTIFACT_LABEL[artifact.kind] ?? artifact.kind}
                {artifact.title ? `: ${artifact.title}` : ""}
              </summary>
              <pre className="body">{artifact.body}</pre>
            </details>
          ))}
        </section>
      )}

      {detail.toolUsage.length > 0 && (
        <section className="section">
          <h2>Tool usage</h2>
          <div className="card__meta">
            {detail.toolUsage.map((tool) => (
              <span className="badge" key={tool.toolName}>
                {tool.toolName} {tool.count}
                {tool.failures > 0 ? ` (${tool.failures} failed)` : ""}
              </span>
            ))}
          </div>
        </section>
      )}

      {detail.files.length > 0 && (
        <section className="section">
          <h2>Files touched ({detail.files.length})</h2>
          <div className="bars">
            {detail.files.map((file) => (
              <div className="tool-line" key={file.path}>
                <span className="tool-line__name">{file.touchCount}×</span>
                <span className="tool-line__target">{file.path}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>Conversation</h2>
        <div className="toggles">
          <label>
            <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} />
            Tool calls
          </label>
          <label>
            <input type="checkbox" checked={showSubagent} onChange={(e) => setShowSubagent(e.target.checked)} />
            Subagents
          </label>
          <label>
            <input type="checkbox" checked={showInjected} onChange={(e) => setShowInjected(e.target.checked)} />
            System- and skill-injected messages
          </label>
        </div>
        {entries.map((entry) =>
          entry.kind === "message" ? (
            <Turn key={`m${entry.seq}`} entry={entry} />
          ) : (
            <ToolLine key={`t${entry.seq}`} entry={entry} />
          ),
        )}
        {entries.length === 0 && <div className="empty">No conversation entries to display.</div>}
      </section>
    </>
  );
}
