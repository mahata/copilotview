import { useEffect, useState } from "react";
import { api, type SearchHit, type SessionSummary } from "./api";
import type { Filters } from "./App";
import { Highlight, formatCount, formatDate, formatDuration, sessionTitle } from "./ui";

const PAGE_SIZE = 30;

const SCOPE_LABEL: Record<string, string> = {
  message: "Message",
  artifact: "Plan or summary",
  file: "File",
};

function SessionMeta({ session }: { session: SessionSummary }) {
  return (
    <div className="card__meta">
      {session.repository && <span className="badge">{session.repository}</span>}
      {session.branch && <span className="badge">{session.branch}</span>}
      {session.models[0] && <span className="badge">{session.models[0]}</span>}
      <span>{formatDate(session.updatedAt)}</span>
      <span>{formatDuration(session.durationMs)}</span>
      <span>
        {formatCount(session.userMessageCount, "user message")} / {formatCount(session.toolCallCount, "tool call")}
      </span>
    </div>
  );
}

function HitCard({ hit, onOpen }: { hit: SearchHit; onOpen: () => void }) {
  const roleLabel = hit.kind === "message" ? (hit.role === "user" ? "Me" : "Copilot") : SCOPE_LABEL[hit.kind];
  const badgeClass = hit.kind === "message" ? `badge--${hit.role}` : `badge--${hit.kind}`;
  return (
    <button type="button" className="card" onClick={onOpen}>
      <div className="card__title">{sessionTitle(hit.session)}</div>
      <div className="card__meta">
        <span className={`badge ${badgeClass}`}>{roleLabel}</span>
        {hit.session.repository && <span className="badge">{hit.session.repository}</span>}
        <span>{formatDate(hit.timestamp ?? hit.session.updatedAt)}</span>
      </div>
      <div className="card__snippet">
        <Highlight snippet={hit.snippet} />
      </div>
    </button>
  );
}

export function Browse({ filters, onOpen }: { filters: Filters; onOpen: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [fallbackTerms, setFallbackTerms] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = filters.q.trim();
  const searching = query.length > 0;

  useEffect(
    () => {
      setPage(0);
      setSessions([]);
      setHits([]);
    },
    [filters.q, filters.scope, filters.repository, filters.model, filters.sort, filters.nonEmpty],
  );

  useEffect(() => {
    let cancelled = false;
    const params = {
      repository: filters.repository,
      model: filters.model,
      branch: filters.branch,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    };
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      const request = searching
        ? api.search({ ...params, q: query, scope: filters.scope }).then((result) => {
            if (cancelled) return;
            setHits((current) => (page === 0 ? result.hits : [...current, ...result.hits]));
            setTotal(result.total);
            setFallbackTerms(result.fallbackTerms);
          })
        : api.sessions({ ...params, sort: filters.sort, nonEmpty: filters.nonEmpty ? "1" : "" }).then((result) => {
            if (cancelled) return;
            setSessions((current) => (page === 0 ? result.sessions : [...current, ...result.sessions]));
            setTotal(result.total);
            setFallbackTerms([]);
          });

      request
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, searching ? 200 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, searching, filters.scope, filters.repository, filters.model, filters.branch, filters.sort, filters.nonEmpty, page]);

  if (error) return <div className="empty">Failed to load: {error}</div>;

  const shown = searching ? hits.length : sessions.length;

  return (
    <>
      <div className="result-count">
        {loading && shown === 0
          ? "Loading..."
          : searching
            ? `${total.toLocaleString()} matches`
            : `${total.toLocaleString()} sessions`}
        {fallbackTerms.length > 0 && (
          <> · Short terms ({fallbackTerms.join(", ")}) were matched with a sequential scan</>
        )}
      </div>

      {searching
        ? hits.map((hit, i) => (
            <HitCard key={`${hit.session.id}-${hit.kind}-${hit.role ?? ""}-${hit.seq ?? ""}-${i}`} hit={hit} onOpen={() => onOpen(hit.session.id)} />
          ))
        : sessions.map((session) => (
            <button type="button" className="card" key={session.id} onClick={() => onOpen(session.id)}>
              <div className="card__title">{sessionTitle(session)}</div>
              <SessionMeta session={session} />
            </button>
          ))}

      {!loading && shown === 0 && <div className="empty">No results found.</div>}

      {shown > 0 && shown < total && (
        <button className="more" onClick={() => setPage((n) => n + 1)} disabled={loading}>
          Load more
        </button>
      )}
    </>
  );
}
