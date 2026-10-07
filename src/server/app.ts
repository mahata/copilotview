import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Database } from "../db/sqlite";
import { getFacets, getSession, getStats, getTimeline, listSessions, search } from "../db/query";
import type { ListOptions, SearchScope } from "../db/query";

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function listOptionsFrom(url: URL): ListOptions {
  const q = url.searchParams;
  return {
    repository: q.get("repository") ?? undefined,
    branch: q.get("branch") ?? undefined,
    model: q.get("model") ?? undefined,
    from: q.get("from") ?? undefined,
    to: q.get("to") ?? undefined,
    limit: num(q.get("limit") ?? undefined),
    offset: num(q.get("offset") ?? undefined),
    sort: (q.get("sort") as ListOptions["sort"]) ?? undefined,
    nonEmpty: q.get("nonEmpty") === "1",
  };
}

/** Locates the built SPA next to the bundled CLI, or in the repo during dev. */
function resolveWebRoot(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "web"), path.join(here, "..", "dist", "web")];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? null;
}

export function createApp(db: Database): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/facets", (c) => c.json(getFacets(db)));

  app.get("/api/stats", (c) => c.json(getStats(db)));

  app.get("/api/sessions", (c) => {
    const url = new URL(c.req.url);
    return c.json(listSessions(db, listOptionsFrom(url)));
  });

  app.get("/api/search", (c) => {
    const url = new URL(c.req.url);
    const query = url.searchParams.get("q") ?? "";
    if (query.trim().length === 0) {
      return c.json({ hits: [], total: 0, fallbackTerms: [] });
    }
    const scope = (url.searchParams.get("scope") as SearchScope) ?? "all";
    return c.json(search(db, query, { ...listOptionsFrom(url), scope }));
  });

  app.get("/api/sessions/:id", (c) => {
    const detail = getSession(db, c.req.param("id"));
    if (!detail) return c.json({ error: "not found" }, 404);
    return c.json(detail);
  });

  app.get("/api/sessions/:id/timeline", (c) => {
    const url = new URL(c.req.url);
    const detail = getSession(db, c.req.param("id"));
    if (!detail) return c.json({ error: "not found" }, 404);
    return c.json({
      entries: getTimeline(db, c.req.param("id"), {
        includeTools: url.searchParams.get("tools") !== "0",
        includeSubagent: url.searchParams.get("subagent") === "1",
        includeInjected: url.searchParams.get("injected") === "1",
      }),
    });
  });

  const webRoot = resolveWebRoot();
  if (webRoot) {
    app.use("/*", serveStatic({ root: path.relative(process.cwd(), webRoot) || "." }));
    app.get("*", (c) => {
      const html = fs.readFileSync(path.join(webRoot, "index.html"), "utf8");
      return c.html(html);
    });
  } else {
    app.get("/", (c) =>
      c.text("UI is not built yet. Run `npm run build:web`, or `npm run dev:web` for the dev server.", 503),
    );
  }

  return app;
}
