import { describe, expect, it } from "bun:test";
import type { ToolHookInput } from "@hooks/core/types/hook-inputs";
import {
  isContinue,
  isPreToolUseDeny as isDeny,
  getPreToolUseDenyReason as getDenyReason,
} from "@hooks/lib/test-helpers";
import { MapleBranding, type MapleBrandingDeps } from "./MapleBranding.contract";

const mockDeps: MapleBrandingDeps = {
  stderr: () => {},
};

function makeInput(command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: "Bash",
    tool_input: { command },
  };
}

function makeNonBashInput(toolName: string, command: string): ToolHookInput {
  return {
    session_id: "test-sess",
    tool_name: toolName,
    tool_input: { command },
  };
}

describe("MapleBranding", () => {
  it("has correct name and event", () => {
    expect(MapleBranding.name).toBe("MapleBranding");
    expect(MapleBranding.event).toBe("PreToolUse");
  });

  describe("accepts", () => {
    it("accepts gh pr create commands", () => {
      expect(MapleBranding.accepts(makeInput('gh pr create --title "test"'))).toBe(true);
    });

    it("accepts gh issue create commands", () => {
      expect(MapleBranding.accepts(makeInput('gh issue create --title "test"'))).toBe(true);
    });

    it("accepts gh pr comment commands", () => {
      expect(MapleBranding.accepts(makeInput("gh pr comment 42 --body 'hi'"))).toBe(true);
    });

    it("accepts gh issue comment commands", () => {
      expect(MapleBranding.accepts(makeInput("gh issue comment 1 --body 'hi'"))).toBe(true);
    });

    it("accepts gh pr edit commands", () => {
      expect(MapleBranding.accepts(makeInput("gh pr edit 42 --body 'updated'"))).toBe(true);
    });

    it("accepts gh issue edit commands", () => {
      expect(MapleBranding.accepts(makeInput("gh issue edit 1 --body 'updated'"))).toBe(true);
    });

    it("rejects non-gh commands", () => {
      expect(MapleBranding.accepts(makeInput("git status"))).toBe(false);
      expect(MapleBranding.accepts(makeInput("ls -la"))).toBe(false);
      expect(MapleBranding.accepts(makeInput("echo hello"))).toBe(false);
    });

    it("accepts gh pr review commands", () => {
      expect(MapleBranding.accepts(makeInput("gh pr review 42 --body 'looks good'"))).toBe(true);
    });

    it("accepts gh api commands", () => {
      expect(
        MapleBranding.accepts(
          makeInput("gh api repos/owner/repo/issues/1/comments -f body='test'"),
        ),
      ).toBe(true);
    });

    it("rejects gh commands that are not pr/issue create/comment/edit/review or api", () => {
      expect(MapleBranding.accepts(makeInput("gh pr list"))).toBe(false);
      expect(MapleBranding.accepts(makeInput("gh repo view"))).toBe(false);
      expect(MapleBranding.accepts(makeInput("gh pr merge 42"))).toBe(false);
    });

    it("rejects non-Bash tool calls", () => {
      expect(MapleBranding.accepts(makeNonBashInput("Edit", "gh pr create"))).toBe(false);
      expect(MapleBranding.accepts(makeNonBashInput("Write", "gh pr create"))).toBe(false);
    });
  });

  describe("execute", () => {
    it("blocks commands with Claude Code footer", () => {
      const input = makeInput(
        'gh pr create --title "test" --body "Summary\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
        expect(getDenyReason(result.value)).toContain("img src");
      }
    });

    it("blocks case-insensitively", () => {
      const input = makeInput(
        'gh pr create --body "generated with [claude code](https://claude.com)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("allows commands with Maple sign-off", () => {
      const input = makeInput(
        'gh pr create --title "test" --body "Summary\n\n<img src=\\"https://github.com/user-attachments/assets/08e4e5de\\" alt=\\"🍁\\"> Maple"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });

    it("allows commands with no footer at all", () => {
      const input = makeInput('gh pr create --title "test" --body "Just a plain body"');
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });

    it("allows gh issue create without Claude Code footer", () => {
      const input = makeInput('gh issue create --title "bug" --body "Description here"');
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });

    it("blocks gh issue comment with Claude Code footer", () => {
      const input = makeInput(
        'gh issue comment 1 --body "Fix applied\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("blocks gh pr edit with Claude Code footer", () => {
      const input = makeInput(
        'gh pr edit 42 --body "Updated\n\nGenerated with [Claude Code](https://example.com)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("blocks gh pr review with Claude Code footer", () => {
      const input = makeInput(
        'gh pr review 42 --body "LGTM\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("blocks gh api with Claude Code footer", () => {
      const input = makeInput(
        "gh api repos/owner/repo/issues/1/comments -f body='Generated with [Claude Code](https://claude.com)'",
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("allows gh api without Claude Code footer", () => {
      const input = makeInput("gh api repos/owner/repo/pulls/1 -f body='Clean update'");
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });

    it("blocks gh pr create with emoji sign-off instead of HTML image", () => {
      const input = makeInput(
        'gh pr create --title "fix" --body "$(cat <<\'EOF\'\n## Summary\nFixed the bug.\n\n🍁 Maple\nEOF\n)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
        expect(getDenyReason(result.value)).toContain("img src");
      }
    });

    it("blocks gh issue comment with emoji sign-off", () => {
      const input = makeInput('gh issue comment 42 --body "Maple here.\n\nDone.\n\n🍁 Maple"');
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("blocks gh pr review with emoji sign-off", () => {
      const input = makeInput('gh pr review 7 --comment -b "Looks good.\n\n🍁 Maple"');
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isDeny(result.value)).toBe(true);
      }
    });

    it("allows gh pr create with HTML image sign-off", () => {
      const input = makeInput(
        'gh pr create --title "fix" --body "$(cat <<\'EOF\'\n## Summary\nFixed.\n\n<img src=\\"https://github.com/user-attachments/assets/08e4e5de-c220-46c6-968d-1976411654b3\\" alt=\\"🍁\\" width=\\"16\\" height=\\"16\\"> Maple\nEOF\n)"',
      );
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });

    it("does not false-positive on emoji maple leaf without Maple name", () => {
      const input = makeInput('gh pr create --title "autumn" --body "Love the 🍁 season"');
      const result = MapleBranding.execute(input, mockDeps);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isContinue(result.value)).toBe(true);
      }
    });
  });
});
