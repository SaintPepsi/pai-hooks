import { describe, expect, it } from "bun:test";
import { transcriptHasToolCall } from "./transcript-tool-scan";

let counter = 0;
function writeTranscript(lines: object[]): string {
  const fs = require("node:fs");
  const dir = `/tmp/pai-transcript-tool-scan-${Date.now()}-${counter++}`;
  fs.mkdirSync(dir, { recursive: true });
  const path = `${dir}/transcript.jsonl`;
  fs.writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

describe("transcriptHasToolCall", () => {
  it("returns false when transcriptPath is undefined", () => {
    expect(transcriptHasToolCall(undefined, ["Write"])).toBe(false);
  });

  it("returns false when file does not exist", () => {
    expect(transcriptHasToolCall("/nonexistent/path.jsonl", ["Write"])).toBe(false);
  });

  it("returns true when listed tool was used after last user message", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "do the thing" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit", "Write"])).toBe(true);
  });

  it("returns false when no listed tool was used after last user message", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "look at the code" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit", "Write"])).toBe(false);
  });

  it("does not look past the last real user message", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      { type: "user", message: { content: "now just look at this" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });

  it("treats user lines whose content starts with tool_result as synthetic", () => {
    const path = writeTranscript([
      { type: "user", message: { content: "real prompt" } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }],
        },
      },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(true);
    expect(transcriptHasToolCall(path, ["Bash"])).toBe(true);
  });

  it("treats user content array starting with text block as real boundary", () => {
    const path = writeTranscript([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Edit", input: {} }] },
      },
      { type: "user", message: { content: [{ type: "text", text: "real msg" }] } },
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "Read", input: {} }] },
      },
    ]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });

  it("returns false on empty transcript file", () => {
    const path = writeTranscript([]);
    expect(transcriptHasToolCall(path, ["Edit"])).toBe(false);
  });
});
