import { describe, expect, it } from "vitest";
import { parseWorkspaceYaml } from "../src/indexer/workspace";

const SAMPLE = `id: 000d18d6-8fcc-4de3-b290-4f7881f03b8b
cwd: /Users/me/projects/demo
git_root: /Users/me/projects/demo
repository: acme/demo
host_type: github
branch: feature/ci
name: Github actions CI
user_named: true
summary: Github actions CI
summary_count: 0
created_at: 2026-05-08T13:04:03.603Z
updated_at: 2026-05-08T13:04:11.099Z
`;

describe("parseWorkspaceYaml", () => {
  it("maps snake_case keys to the session record", () => {
    const ws = parseWorkspaceYaml(SAMPLE, "fallback");
    expect(ws).toMatchObject({
      id: "000d18d6-8fcc-4de3-b290-4f7881f03b8b",
      repository: "acme/demo",
      hostType: "github",
      branch: "feature/ci",
      name: "Github actions CI",
      userNamed: true,
      gitRoot: "/Users/me/projects/demo",
      createdAt: "2026-05-08T13:04:03.603Z",
    });
  });

  it("falls back to the directory name when id is missing", () => {
    expect(parseWorkspaceYaml("repository: acme/demo\n", "dir-id")?.id).toBe("dir-id");
  });

  it("returns null for malformed yaml", () => {
    expect(parseWorkspaceYaml("\tid: [unclosed", "dir-id")).toBeNull();
  });

  it("returns null for a non-object document", () => {
    expect(parseWorkspaceYaml("just a string", "dir-id")).toBeNull();
  });
});
