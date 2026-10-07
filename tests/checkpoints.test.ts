import { describe, expect, it } from "vitest";
import { flattenCheckpointBody, parseCheckpointIndex } from "../src/indexer/checkpoints";

const INDEX = `# Checkpoint History

Checkpoints are listed in chronological order.

| # | Title | File |
|---|-------|------|
| 1 | Adding LiteLLM comparison doc | 001-adding-litellm-comparison-doc.md |
| 2 | Fixing the renderer | 002-fixing-the-renderer.md |
`;

describe("parseCheckpointIndex", () => {
  it("reads data rows and skips the header separator", () => {
    expect(parseCheckpointIndex(INDEX)).toEqual([
      { number: 1, title: "Adding LiteLLM comparison doc", file: "001-adding-litellm-comparison-doc.md" },
      { number: 2, title: "Fixing the renderer", file: "002-fixing-the-renderer.md" },
    ]);
  });

  it("returns nothing when there is no table", () => {
    expect(parseCheckpointIndex("# Checkpoint History\n\nNo checkpoints yet.\n")).toEqual([]);
  });
});

describe("flattenCheckpointBody", () => {
  it("turns xml-ish sections into markdown headings", () => {
    const out = flattenCheckpointBody("<overview>\nDid a thing.\n</overview>\n<next_steps>\nDo more.\n</next_steps>\n");
    expect(out).toBe("## overview\n\nDid a thing.\n\n## next steps\n\nDo more.");
  });

  it("passes through plain text unchanged", () => {
    expect(flattenCheckpointBody("  just prose  ")).toBe("just prose");
  });
});
