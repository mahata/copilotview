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
    if (route.view !== "browse") go("/");
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
              Sessions
            </button>
            <button aria-current={route.view === "stats"} onClick={() => go("/stats")}>
              Statistics
            </button>
          </nav>
        </div>

        <div className="search-row">
          <input
            type="search"
            placeholder="Search all sessions (space-separated terms use AND)"
            value={filters.q}
            onChange={(e) => update({ q: e.target.value })}
          />
          <select value={filters.scope} onChange={(e) => update({ scope: e.target.value })}>
            <option value="all">All content</option>
            <option value="user">My messages</option>
            <option value="assistant">Copilot responses</option>
            <option value="artifact">Plans and summaries</option>
            <option value="file">File names</option>
          </select>
          <select value={filters.repository} onChange={(e) => update({ repository: e.target.value })}>
            <option value="">All repositories</option>
            {facets?.repositories.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={filters.model} onChange={(e) => update({ model: e.target.value })}>
            <option value="">All models</option>
            {facets?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {filters.q.trim() === "" && (
            <select value={filters.sort} onChange={(e) => update({ sort: e.target.value })}>
              <option value="recent">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="longest">Longest first</option>
              <option value="busiest">Most tool calls</option>
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
              Hide unused sessions
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
