# Scripts

Automation scripts for the pai-hooks settings sync workflow.

See also the root-level scripts:

- `install.ts` — Merges hooks into `~/.claude/settings.json` (user-facing entry point)
- `uninstall.ts` — Removes all pai-hooks entries from `~/.claude/settings.json`

## export-hooks.ts

Extracts hook entries from `~/.claude/settings.json` and writes `settings.hooks.json`.
Filters to only hooks matching the source path prefix, rewrites paths to use the repo's
namespaced env var (`${SAINTPEPSI_PAI_HOOKS_DIR}/`). Only includes hooks whose `.hook.ts`
file exists in the repo, so PAI-specific hooks that aren't implemented here are excluded
automatically.

The default source prefix is read from `pai-hooks.json` manifest (`${SAINTPEPSI_PAI_HOOKS_DIR}/hooks/`),
matching hooks already installed under the repo's own env var. A custom prefix can be passed
as an argument for initial migration from a different path (e.g., `${PAI_DIR}/hooks/`).

**Safety guard:** If the export finds zero matcher groups but `settings.hooks.json` already
contains hooks, the write is aborted to prevent accidental data loss.

**Used by:** Husky pre-commit hook (author workflow).

```bash
bun run scripts/export-hooks.ts
# Optional: specify a custom source prefix (for migration)
bun run scripts/export-hooks.ts '${PAI_DIR}/hooks/'
```

## import-hooks.ts

Reads `settings.hooks.json` and merges entries into `~/.claude/settings.json`.
Reuses `mergeHooksIntoSettings(settings, exported)` from `install.ts` for
idempotent merge logic. The install path is resolved from the env var in the
manifest, not passed as a separate argument.

**Used by:** Husky post-merge hook (keeps settings in sync after pulling changes).

```bash
bun run scripts/import-hooks.ts
```

## analyze-sessions.py

Parses Claude Code session JSONL files and outputs per-session quality metrics as CSV.
Designed to surface time-of-day patterns in response quality, with a focus on the
**2pm AEST degradation hypothesis** — evidence collection for GitHub issues and consumer complaints.

```bash
# Analyze all projects under ~/.claude/projects/
python3 scripts/analyze-sessions.py --all-projects -o scripts/session-analysis.csv

# Combine multiple sources (e.g. personal + work machine)
python3 scripts/analyze-sessions.py \
  --project-dir ~/.claude/projects/ \
  --project-dir ~/Downloads/claude-work/projects/ \
  --all-projects -o scripts/session-analysis.csv

# Disable PII scrubbing (default: session IDs hashed, user paths removed)
python3 scripts/analyze-sessions.py --all-projects --no-scrub -o raw.csv

# Filter to sessions with at least 10 entries
python3 scripts/analyze-sessions.py --all-projects --min-entries 10 -o scripts/session-analysis.csv
```

**PII scrubbing** is on by default — session IDs are SHA-256 hashed, usernames and home
directory paths are stripped from project names and all string fields.

### Key degradation metrics

| Metric | Description |
|--------|-------------|
| `is_after_2pm` | Binary flag: 1 if session started at 14:00 AEST or later |
| `thinking_depth_ratio` | `avg_thinking_length / avg_output_length` — lower = shallower reasoning |
| `empty_responses` | Assistant turns with <50 chars text |
| `abandoned_frustrated` | Session ended frustrated (short + frustration signals) |
| `tool_success_rate` | `tool_results / tool_uses` — lower = more failures |
| `tool_loops` | Repeated identical tool calls (model spinning) |
| `consecutive_corrections` | Correction signals back-to-back (model not learning) |
| `is_subagent` | Session spawned by parent session (Agent tool), not user-initiated |

### Output columns

Session timing (UTC + local), duration, `is_after_2pm`, token usage (input/output/cache),
model and service tier, inference geo, speed mode, user message lengths, correction and
frustration signal counts, thinking depth ratio, tool success rate, tool loops,
empty responses, abandoned frustrated flag, advisor calls, session fragmentation indicators,
and derived rates (turns/minute, tokens/minute, output tokens per user message).

## session-dashboard.html

Interactive Plotly dashboard for visualizing the 2pm AEST degradation analysis.
Drop the `session-analysis.csv` file onto the page to render charts.

**Charts include:**
- Frustration signals by hour (with 2pm threshold marker)
- Corrections per user message by hour
- Output tokens per session by hour
- Thinking depth ratio by hour
- Abandoned frustrated sessions by hour
- Tool loops + consecutive corrections by hour
- Model comparison (frustration by hour, per model)
- Timeline scatter (date vs duration, colored by frustration)
