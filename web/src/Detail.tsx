import { useEffect, useState } from "react";
import { api, type SessionDetail, type TimelineEntry } from "./api";
import { formatDate, formatDuration, sessionTitle } from "./ui";

const ARTIFACT_LABEL: Record<string, string> = {
  plan: "計画",
  checkpoint: "チェックポイント",
  completion: "完了レポート",
};

function ToolLine({ entry }: { entry: Extract<TimelineEntry, { kind: "tool" }> }) {
  return (
    <div className={`tool-line${entry.success === 0 ? " tool-line--failed" : ""}`}>
      <span className="tool-line__name">{entry.toolName}</span>
      <span className="tool-line__target">{entry.target ?? ""}</span>
      {entry.success === 0 && <span>失敗</span>}
    </div>
  );
}

function Turn({ entry }: { entry: Extract<TimelineEntry, { kind: "message" }> }) {
  return (
    <div className={`turn turn--${entry.role}`}>
      <div className="turn__gutter">
        <div>{entry.role === "user" ? "自分" : "Copilot"}</div>
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
    setDetail(null);
    api.session(id).then(setDetail).catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    api
      .timeline(id, { tools: showTools ? "1" : "0", subagent: showSubagent ? "1" : "0", injected: showInjected ? "1" : "0" })
      .then((r) => setEntries(r.entries))
      .catch((e: Error) => setError(e.message));
  }, [id, showTools, showSubagent, showInjected]);

  if (error) return <div className="empty">読み込みに失敗しました: {error}</div>;
  if (!detail) return <div className="empty">読み込み中…</div>;

  const { session } = detail;

  return (
    <>
      <button className="back" onClick={onBack}>
        ← 一覧に戻る
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
          <dt>期間</dt>
          <dd>
            {formatDate(session.startedAt ?? session.createdAt)} 〜 {formatDate(session.endedAt ?? session.updatedAt)}（
            {formatDuration(session.durationMs)}）
          </dd>
          <dt>作業ディレクトリ</dt>
          <dd>{session.cwd ?? "—"}</dd>
          <dt>規模</dt>
          <dd>
            自分 {session.userMessageCount} / Copilot {session.assistantMessageCount} メッセージ、ツール実行{" "}
            {session.toolCallCount} 回、ファイル {session.fileCount} 件
          </dd>
          <dt>セッション ID</dt>
          <dd>{session.id}</dd>
          <dt>データ</dt>
          <dd>
            {session.dirPath}
            {session.malformedLines > 0 && `（解析できなかった行: ${session.malformedLines}）`}
          </dd>
        </dl>
      </div>

      {detail.artifacts.length > 0 && (
        <section className="section">
          <h2>要約・計画</h2>
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
          <h2>ツール使用</h2>
          <div className="card__meta">
            {detail.toolUsage.map((tool) => (
              <span className="badge" key={tool.toolName}>
                {tool.toolName} {tool.count}
                {tool.failures > 0 ? ` (失敗 ${tool.failures})` : ""}
              </span>
            ))}
          </div>
        </section>
      )}

      {detail.files.length > 0 && (
        <section className="section">
          <h2>触れたファイル（{detail.files.length}）</h2>
          <div className="bars">
            {detail.files.slice(0, 40).map((file) => (
              <div className="tool-line" key={file.path}>
                <span className="tool-line__name">{file.touchCount}×</span>
                <span className="tool-line__target">{file.path}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <h2>やり取り</h2>
        <div className="toggles">
          <label>
            <input type="checkbox" checked={showTools} onChange={(e) => setShowTools(e.target.checked)} />
            ツール実行
          </label>
          <label>
            <input type="checkbox" checked={showSubagent} onChange={(e) => setShowSubagent(e.target.checked)} />
            サブエージェント
          </label>
          <label>
            <input type="checkbox" checked={showInjected} onChange={(e) => setShowInjected(e.target.checked)} />
            システム・スキル由来の入力
          </label>
        </div>
        {entries.map((entry) =>
          entry.kind === "message" ? (
            <Turn key={`m${entry.seq}`} entry={entry} />
          ) : (
            <ToolLine key={`t${entry.seq}`} entry={entry} />
          ),
        )}
        {entries.length === 0 && <div className="empty">表示できるやり取りがありません。</div>}
      </section>
    </>
  );
}
