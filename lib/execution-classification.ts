/**
 * Execution Classification — Pure Functions for Command Analysis
 *
 * Classifies Bash commands as state-changing or read-only, checks output
 * substantiveness, and builds category-specific evidence reminders.
 *
 * No I/O, no dependencies, no side effects.
 *
 * Used by:
 *   - ExecutionEvidenceVerifier (PostToolUse Bash — injects evidence reminders)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type CommandCategory =
  | "git-write"
  | "deploy"
  | "api-mutation"
  | "package"
  | "database"
  | "file-destruction"
  | "read-only";

export interface Classification {
  isStateChanging: boolean;
  category: CommandCategory;
}

// ─── State-Changing Patterns ─────────────────────────────────────────────────

/**
 * Each pattern is a regex that matches the START of a command segment
 * (after stripping leading whitespace). This prevents false positives
 * from arguments (e.g., `cat deploy.log` won't match `deploy`).
 */
const STATE_CHANGING_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  category: CommandCategory;
}> = [
  // Git write operations
  { pattern: /^git\s+push\b/, category: "git-write" },
  { pattern: /^git\s+merge\b/, category: "git-write" },
  { pattern: /^git\s+rebase\b/, category: "git-write" },
  { pattern: /^git\s+reset\b/, category: "git-write" },
  { pattern: /^git\s+commit\b/, category: "git-write" },
  { pattern: /^git\s+checkout\s+(-b|-f)\b/, category: "git-write" },
  { pattern: /^git\s+tag\s+(-a|-d)\b/, category: "git-write" },
  { pattern: /^git\s+branch\s+(-d|-D)\b/, category: "git-write" },
  { pattern: /^git\s+stash\s+(pop|drop)\b/, category: "git-write" },
  { pattern: /^git\s+cherry-pick\b/, category: "git-write" },

  // Deployment and provisioning
  { pattern: /^(\.\/)?deploy\b/, category: "deploy" },
  { pattern: /^(bash|sh)\s+deploy/, category: "deploy" },
  {
    pattern: /^kubectl\s+(apply|delete|create|scale|rollout)\b/,
    category: "deploy",
  },
  { pattern: /^helm\s+(install|upgrade|uninstall)\b/, category: "deploy" },
  { pattern: /^terraform\s+(apply|destroy)\b/, category: "deploy" },
  { pattern: /^docker\s+(push|build|run|stop|rm)\b/, category: "deploy" },
  { pattern: /^wrangler\s+(deploy|publish)\b/, category: "deploy" },

  // API mutations (curl/httpie with write methods)
  {
    pattern: /^curl\b.*-X\s*(POST|PUT|PATCH|DELETE)\b/,
    category: "api-mutation",
  },
  { pattern: /^curl\b.*(-d|--data)\b/, category: "api-mutation" },
  { pattern: /^http\s+(POST|PUT|PATCH|DELETE)\b/, category: "api-mutation" },

  // Package/dependency operations
  { pattern: /^npm\s+(install|publish|run)\b/, category: "package" },
  { pattern: /^bun\s+(install|publish|add|remove)\b/, category: "package" },
  { pattern: /^pip\s+(install|uninstall)\b/, category: "package" },
  { pattern: /^brew\s+(install|uninstall|upgrade)\b/, category: "package" },
  { pattern: /^composer\s+(install|require|update)\b/, category: "package" },

  // Database
  { pattern: /^(mysql|psql|sqlite3)\b/, category: "database" },
  { pattern: /^php\s+artisan\s+migrate\b/, category: "database" },
  { pattern: /^php\s+artisan\s+db:seed\b/, category: "database" },
  { pattern: /^php\s+artisan\b/, category: "deploy" },

  // File destruction
  { pattern: /^rm\s+(-rf|-r|-f)\b/, category: "file-destruction" },
  { pattern: /^mv\b/, category: "file-destruction" },
  { pattern: /^cp\s+-r\b/, category: "file-destruction" },
];

// ─── Read-Only Patterns ──────────────────────────────────────────────────────

const READ_ONLY_PATTERNS: ReadonlyArray<RegExp> = [
  /^git\s+(status|log|diff|show|branch(?!\s+-[dD]))\b/,
  /^git\s+remote\b/,
  /^(ls|find|cat|head|tail|grep|rg|wc|tree)\b/,
  /^(echo|printf)\b/,
  /^(which|type|command\s+-v)\b/,
  /^(ps|top|df|du|uname)\b/,
  /^(ping|traceroute|nslookup|dig)\b/,
  /^(env|printenv|hostname|whoami|id|date)\b/,
  /^curl\b(?!.*(-X\s*(POST|PUT|PATCH|DELETE)|(-d|--data)\b))/,
];

// ─── Dry-Run Detection ──────────────────────────────────────────────────────

/**
 * Dry-run/help flags as regexes with word boundaries to prevent
 * false positives (e.g., --hard matching -h).
 */
const DRY_RUN_PATTERNS = [
  /\s--dry-run\b/,
  /\s--help\b/,
  /\s-h\s/, // -h must be surrounded by whitespace (not part of --hard)
  /\s-h$/, // -h at end of command
  /\s--version\b/,
];

/** Commands ending in `--help`, `list`, `about`, or `env` as subcommand. */
const HELP_SUBCOMMANDS = /\s+(--help|-h|list|about|env)\s*$/;

// ─── Classification Logic ────────────────────────────────────────────────────

/**
 * Split a command string on shell operators (&&, ||, ;) to get segments.
 * Preserves the segment content but strips the operators.
 */
export function splitCommandSegments(command: string): string[] {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function isDryRun(command: string): boolean {
  for (const pattern of DRY_RUN_PATTERNS) {
    if (pattern.test(command)) return true;
  }
  if (HELP_SUBCOMMANDS.test(command)) return true;
  return false;
}

function classifySegment(segment: string): Classification {
  const trimmed = segment.trim();

  // Check read-only first (explicit exclusions)
  for (const pattern of READ_ONLY_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isStateChanging: false, category: "read-only" };
    }
  }

  // Check dry-run flags
  if (isDryRun(trimmed)) {
    return { isStateChanging: false, category: "read-only" };
  }

  // Check state-changing patterns
  for (const { pattern, category } of STATE_CHANGING_PATTERNS) {
    if (pattern.test(trimmed)) {
      return { isStateChanging: true, category };
    }
  }

  // Default: not state-changing
  return { isStateChanging: false, category: "read-only" };
}

/**
 * Classify a full command string. If the command contains multiple
 * segments (via &&, ;, ||), classify each and return the first
 * state-changing classification found (or read-only if none).
 */
export function classifyCommand(command: string): Classification {
  const segments = splitCommandSegments(command);

  for (const segment of segments) {
    const result = classifySegment(segment);
    if (result.isStateChanging) {
      return result;
    }
  }

  return { isStateChanging: false, category: "read-only" };
}

// ─── Output Substantiveness Check ────────────────────────────────────────────

const MIN_OUTPUT_LENGTH = 50;
const HELP_BLOCK_PATTERN = /^(Usage:|Options:|USAGE:|Commands:)/;

/**
 * Check whether tool_response contains substantive output.
 * Returns true if the output looks like real execution evidence.
 */
export function hasSubstantiveOutput(toolResponse: unknown): boolean {
  if (toolResponse === null || toolResponse === undefined) return false;

  const text = typeof toolResponse === "string" ? toolResponse : String(toolResponse);

  const trimmed = text.trim();

  if (trimmed.length === 0) return false;
  if (trimmed.length < MIN_OUTPUT_LENGTH) return false;
  if (HELP_BLOCK_PATTERN.test(trimmed)) return false;

  return true;
}

// ─── Reminder Builder ────────────────────────────────────────────────────────

const EVIDENCE_REQUIREMENTS: Record<CommandCategory, string> = {
  "git-write": "Commit hash(es), branch names, lines changed, or push confirmation from remote",
  deploy:
    "Full command output including deployment log, resource status, or confirmation from target",
  "api-mutation": "HTTP status code and response body (or first 500 chars)",
  package: "Package name(s) installed/removed, version numbers, or error output",
  database: "Rows affected, migration names run, or query results",
  "file-destruction": "Confirm what was moved/copied/deleted, verify destination exists",
  "read-only": "",
};

/**
 * Summarize a command for the reminder — first 80 chars, truncated.
 */
function summarizeCommand(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length <= 80) return trimmed;
  return `${trimmed.slice(0, 77)}...`;
}

/**
 * Build the additionalContext reminder string for a state-changing
 * command that produced thin output.
 */
export function buildReminder(command: string, classification: Classification): string {
  const summary = summarizeCommand(command);
  const evidence = EVIDENCE_REQUIREMENTS[classification.category];

  return [
    "[EXECUTION EVIDENCE REQUIRED]",
    `A state-changing operation just completed: ${summary}`,
    "",
    "Your next response MUST include the actual execution output — not a description of what you did, but the literal output that proves execution occurred.",
    "",
    `Required evidence for this operation type: ${evidence}`,
    "",
    "If the output was empty or did not appear, say so explicitly and explain why — do not report success without evidence.",
  ].join("\n");
}
