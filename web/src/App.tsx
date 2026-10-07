import { useEffect, useState } from "react";
import { api, type Facets } from "./api";
import { Browse } from "./Browse";
import { Detail } from "./Detail";
import { StatsView } from "./Stats";

type Route = { view: "browse" } | { view: "stats" } | { view: "session"; id: string };

function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("session/")) return { view: "session", id: hash.slice("session/".length) };
  if (hash === "stats") return { view: "stats" };
  return { view: "browse" };
}

export interface Filters {
  q: string;
  scope: string;
  repository: string;
  branch: string;
  model: string;
  sort: string;
  nonEmpty: boolean;
}

const EMPTY_FILTERS: Filters = {
  q: "",
  scope: "all",
  repository: "",
  branch: "",
  model: "",
  sort: "recent",
  nonEmpty: true,
};

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [facets, setFacets] = useState<Facets | null>(null);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    api.facets().then(setFacets).catch(() => setFacets(null));
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  const update = (patch: Partial<Filters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    if (route.view === "session") go("/");
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header__top">
          <button className="brand" onClick={() => go("/")}>
            copilotview
          </button>
          <nav className="nav">
            <button aria-current={route.view !== "stats"} onClick={() => go("/")}>
              セッション
            </button>
            <button aria-current={route.view === "stats"} onClick={() => go("/stats")}>
              統計
            </button>
          </nav>
        </div>

        <div className="search-row">
          <input
            type="search"
            placeholder="全文検索（スペース区切りで AND）"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
          />
          <select value={filters.scope} onChange={(e) => update({ scope: e.target.value })}>
            <option value="all">すべて</option>
            <option value="user">自分の発言</option>
            <option value="assistant">Copilot の応答</option>
            <option value="artifact">計画・要約</option>
            <option value="file">ファイル名</option>
          </select>
          <select value={filters.repository} onChange={(e) => update({ repository: e.target.value })}>
            <option value="">全リポジトリ</option>
            {facets?.repositories.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={filters.model} onChange={(e) => update({ model: e.target.value })}>
            <option value="">全モデル</option>
            {facets?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {filters.q.trim() === "" && (
            <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
              <option value="recent">新しい順</option>
              <option value="oldest">古い順</option>
              <option value="longest">長い順</option>
              <option value="busiest">ツール実行が多い順</option>
            </select>
          )}
        </div>

        {filters.q.trim() === "" && (
          <div className="toggles" style={{ marginTop: 8 }}>
            <label>
              <input
                type="checkbox"
                checked={filters.nonEmpty}
                onChange={(e) => update({ nonEmpty: e.target.checked })}
              />
              使われなかったセッションを隠す
            </label>
          </div>
        )}
      </header>

      {route.view === "stats" ? (
        <StatsView />
      ) : route.view === "session" ? (
        <Detail id={route.id} onBack={() => go("/")} />
      ) : (
        <Browse filters={filters} onOpen={(id) => go(`/session/${id}`)} />
      )}
    </div>
  );
}
