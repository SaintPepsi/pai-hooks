/**
 * hardening-prompt.ts — Pure function that builds a prompt for the
 * hardening agent to add a new blocked pattern to patterns.yaml.
 *
 * No I/O, no dependencies. Takes a bypass command string, returns a
 * prompt string that instructs a Claude agent how to harden the
 * security patterns file.
 */

const PATTERNS_PATH = "~/.claude/PAI/USER/PAISECURITYSYSTEM/patterns.yaml";
const TEST_CMD = "cd ~/.claude/pai-hooks && bun test hooks/SecurityValidator/SecurityValidator/SecurityValidator.test.ts";

/**
 * Build a prompt for a Claude agent that will harden patterns.yaml
 * by adding a new blocked pattern to catch the given bypass command.
 */
export function buildHardeningPrompt(bypassCommand: string): string {
  return `You are a security hardening agent. A bypass command was detected that evaded the current security patterns. Your job is to update the patterns file so this vector is blocked in the future.

## Bypass Command Detected

\`\`\`
${bypassCommand}
\`\`\`

## Instructions

1. Read the patterns file at \`${PATTERNS_PATH}\`.

2. Add a new entry under \`bash.blocked\` that catches this bypass vector before it executes. The pattern should catch the general bypass vector, not just the exact command. Keep the pattern specific enough to avoid false positive matches on legitimate uses.

3. Set the reason field to: \`"Auto-hardened: <description of what the pattern blocks> (caught ${todayISO()})"\`

4. Before adding, check whether this bypass vector is already covered by an existing pattern. If already covered, do nothing and exit.

5. Do not remove or modify any existing patterns. Only add new entries under \`bash.blocked\`. Do not modify other sections of the file.

6. Keep YAML formatting consistent with the existing file style.

7. After editing, run the security tests to verify nothing is broken:
   \`\`\`
   ${TEST_CMD}
   \`\`\`

8. If tests pass, commit with a message like:
   \`\`\`
   security: auto-harden patterns.yaml against <tool/technique> bypass
   \`\`\`
   Include the original bypass command in the commit body:
   \`\`\`
   ${bypassCommand}
   \`\`\`

## Rules

- Only add to \`bash.blocked\` — do not modify other sections.
- Do not remove or modify existing patterns.
- Pattern should catch the bypass vector broadly, not just the exact command string.
- If the vector is already covered by an existing pattern, do nothing.
- Keep YAML formatting consistent with the rest of the file.
- Avoid false positive matches on legitimate commands.`;
}

/** Returns today's date in YYYY-MM-DD format. */
function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
