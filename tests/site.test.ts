import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const siteDirectory = path.resolve("site");
const publicUrl = new URL("https://copilotview.mahata.org/");
const siteRoots = [publicUrl.href, "https://mahata.github.io/copilotview/", "http://127.0.0.1:8080/"];
const readSite = (file: string) => readFileSync(path.join(siteDirectory, file), "utf8");

interface PagesWorkflow {
  on: {
    push: { branches: string[]; paths: string[] };
    workflow_dispatch: unknown;
  };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    deploy: {
      if: string;
      permissions: Record<string, string>;
      environment: { name: string; url: string };
      steps: { uses: string; id?: string; with?: Record<string, string | boolean> }[];
    };
  };
}

describe("product website", () => {
  it("provides an English document with canonical metadata for the custom domain", () => {
    const html = readSite("index.html");

    expect(html).toMatch(/<html lang="en">/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1">/);
    expect(html).toMatch(/<title>copilotview[^<]*<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).toContain(`<link rel="canonical" href="${publicUrl.href}">`);
    expect(html).toContain(`<meta property="og:url" content="${publicUrl.href}">`);
    expect(html.match(/<h1(?:\s|>)/g)).toHaveLength(1);
    expect(html).toMatch(/<main(?:\s|>)/);
  });

  it("uses the documented installation commands and links to instructions and support", () => {
    const html = readSite("index.html");
    const readme = readFileSync("README.md", "utf8");

    for (const command of ["brew install mahata/tap/copilotview", "copilotview serve", "cv serve"]) {
      expect(html).toContain(`<code>${command}</code>`);
      expect(readme).toContain(command);
    }
    expect(html).toContain('href="http://127.0.0.1:4178"');
    expect(html).toContain('href="https://github.com/mahata/copilotview#readme"');
    expect(html).toContain('href="https://github.com/mahata/copilotview/issues"');
  });

  it("links the README to the custom domain", () => {
    const readme = readFileSync("README.md", "utf8");

    expect(readme).toContain(`[Visit the website](${publicUrl.href})`);
    expect(readme).toContain(`[${publicUrl.hostname}](${publicUrl.href})`);
  });

  it.each(siteRoots)("resolves every local link, asset, and anchor from %s", (siteRoot) => {
    const siteRootUrl = new URL(siteRoot);
    const html = readSite("index.html");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    const references = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)];

    expect(new Set(ids).size).toBe(ids.length);
    expect(references.length).toBeGreaterThan(0);
    for (const [, reference] of references) {
      const url = new URL(reference!, siteRootUrl);
      if (url.origin !== siteRootUrl.origin) continue;

      expect(url.pathname.startsWith(siteRootUrl.pathname), reference).toBe(true);
      const file = url.pathname.slice(siteRootUrl.pathname.length) || "index.html";
      expect(existsSync(path.join(siteDirectory, file)), reference).toBe(true);
      if (url.hash) expect(ids, reference).toContain(url.hash.slice(1));
    }
    expect(html).toMatch(/<link rel="stylesheet" href="styles\.css">/);
    expect(html).toMatch(/<link rel="icon" href="favicon\.svg" type="image\/svg\+xml">/);
    expect(readSite("favicon.svg")).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("needs no scripts, forms, external styles, or fonts", () => {
    const html = readSite("index.html");
    const css = readSite("styles.css");

    expect(html).not.toMatch(/<(?:script|iframe|form|input|button)\b/i);
    expect(html).not.toMatch(/\bon(?:click|load|error)\s*=/i);
    expect(html).not.toMatch(/<img\b[^>]*src="(?:https?:)?\/\//i);
    expect(html).not.toMatch(/<link\b[^>]*rel="(?:stylesheet|preload|preconnect|dns-prefetch|icon)"[^>]*href="(?:https?:)?\/\//i);
    expect(css).not.toMatch(/@import|@font-face|url\s*\(/i);
  });

  it("identifies illustrative data and documents the app's local storage", () => {
    const html = readSite("index.html");

    expect(html).toContain("Illustrative example");
    expect(html).toContain("~/.copilot/session-state/");
    expect(html).toContain("~/.copilotview/index.db");
    expect(html).toContain("GitHub Pages");
  });

  it("lists only the public landing page in its sitemap", () => {
    const sitemap = readSite("sitemap.xml");
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(locations).toEqual([publicUrl.href]);
  });
});

describe("Pages deployment", () => {
  it("publishes only site/ from main using pinned official actions", () => {
    const workflow: PagesWorkflow = parse(readFileSync(".github/workflows/pages.yml", "utf8"));
    const deploy = workflow.jobs.deploy;

    expect(workflow.on.push.branches).toEqual(["main"]);
    expect(workflow.on.push.paths).toEqual(["site/**", ".github/workflows/pages.yml"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
    expect(deploy.if).toBe("github.ref == 'refs/heads/main'");
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(deploy.permissions).toEqual({ contents: "read", pages: "write", "id-token": "write" });
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
    expect(deploy.environment.name).toBe("github-pages");
    expect(deploy.environment.url).toBe("${{ steps.deployment.outputs.page_url }}");

    expect(deploy.steps.map((step) => step.uses.split("@")[0])).toEqual([
      "actions/checkout",
      "actions/configure-pages",
      "actions/upload-pages-artifact",
      "actions/deploy-pages",
    ]);
    for (const step of deploy.steps) expect(step.uses).toMatch(/^actions\/[\w-]+@[a-f0-9]{40}$/);
    const upload = deploy.steps.find((step) => step.uses.startsWith("actions/upload-pages-artifact@"));
    expect(upload?.with?.path).toBe("site");
    const checkout = deploy.steps.find((step) => step.uses.startsWith("actions/checkout@"));
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
    expect(deploy.steps.find((step) => step.id === "deployment")?.uses).toMatch(/^actions\/deploy-pages@/);
  });
});
