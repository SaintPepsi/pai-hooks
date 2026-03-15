import { describe, it, expect } from "bun:test";
import { BashWriteGuard } from "@hooks/contracts/BashWriteGuard";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import type { ContinueOutput, BlockOutput } from "@hooks/core/types/hook-outputs";
import type { Result } from "@hooks/core/result";
import type { PaiError } from "@hooks/core/error";

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function result(input: ToolHookInput): Result<ContinueOutput | BlockOutput, PaiError> {
  return BashWriteGuard.execute(input, BashWriteGuard.defaultDeps) as Result<ContinueOutput | BlockOutput, PaiError>;
}

describe("BashWriteGuard", () => {
  it("has correct name and event", () => {
    expect(BashWriteGuard.name).toBe("BashWriteGuard");
    expect(BashWriteGuard.event).toBe("PreToolUse");
  });

  // ─── accepts() ──────────────────────────────────────────────────────────

  it("rejects non-Bash tools", () => {
    const input: ToolHookInput = { session_id: "s", tool_name: "Edit", tool_input: {} };
    expect(BashWriteGuard.accepts(input)).toBe(false);
  });

  it("rejects Bash commands without .ts file references", () => {
    expect(BashWriteGuard.accepts(makeInput("git status"))).toBe(false);
    expect(BashWriteGuard.accepts(makeInput("ls -la"))).toBe(false);
    expect(BashWriteGuard.accepts(makeInput("echo hello"))).toBe(false);
  });

  it("accepts Bash commands that reference .ts files", () => {
    expect(BashWriteGuard.accepts(makeInput("sed -i '' 's/foo/bar/' file.ts"))).toBe(true);
    expect(BashWriteGuard.accepts(makeInput("echo 'code' > output.ts"))).toBe(true);
    expect(BashWriteGuard.accepts(makeInput("cat file.ts"))).toBe(true);
  });

  // ─── Blocks: output redirection ─────────────────────────────────────────

  it("blocks echo redirect to .ts file", () => {
    const r = result(makeInput("echo 'const x = 1' > file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  it("blocks append redirect to .ts file", () => {
    const r = result(makeInput("echo 'export {}' >> module.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  it("blocks cat heredoc redirect to .ts file", () => {
    const r = result(makeInput("cat <<'EOF' > component.tsx\nimport React from 'react'\nEOF"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  // ─── Blocks: sed in-place ───────────────────────────────────────────────

  it("blocks sed -i on .ts file", () => {
    const r = result(makeInput("sed -i '' 's/old/new/g' agent.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  it("blocks sed -i on .tsx file", () => {
    const r = result(makeInput("sed -i 's/foo/bar/' component.tsx"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  // ─── Blocks: tee ────────────────────────────────────────────────────────

  it("blocks tee to .ts file", () => {
    const r = result(makeInput("echo 'code' | tee output.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  it("blocks tee -a to .ts file", () => {
    const r = result(makeInput("echo 'code' | tee -a output.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  // ─── Blocks: cp/mv ─────────────────────────────────────────────────────

  it("blocks cp to .ts destination", () => {
    const r = result(makeInput("cp template.txt new-file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  it("blocks mv to .ts destination", () => {
    const r = result(makeInput("mv draft.txt final.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("block");
    }
  });

  // ─── Allows: read-only operations ───────────────────────────────────────

  it("allows cat reading .ts file", () => {
    const r = result(makeInput("cat file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows grep on .ts file", () => {
    const r = result(makeInput("grep -n 'function' utils.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows wc on .ts file", () => {
    const r = result(makeInput("wc -l file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows bun test on .ts file", () => {
    const r = result(makeInput("bun test hooks/contracts/BashWriteGuard.test.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows bun run on .ts file", () => {
    const r = result(makeInput("bun run script.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows tsc --noEmit", () => {
    const r = result(makeInput("tsc --noEmit"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows git diff on .ts file", () => {
    const r = result(makeInput("git diff file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  // ─── Allows: writing to non-.ts files ───────────────────────────────────

  it("allows redirect to .js file", () => {
    const r = result(makeInput("echo 'code' > output.js"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  it("allows redirect to .json file", () => {
    const r = result(makeInput("echo '{}' > config.json"));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.type).toBe("continue");
    }
  });

  // ─── Block message ──────────────────────────────────────────────────────

  it("block message tells AI to use Edit/Write tools", () => {
    const r = result(makeInput("sed -i '' 's/foo/bar/' file.ts"));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.type === "block") {
      const reason = (r.value as BlockOutput).reason;
      expect(reason).toContain("Edit");
      expect(reason).toContain("Write");
    }
  });
});
