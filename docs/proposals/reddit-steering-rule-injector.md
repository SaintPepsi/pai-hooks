# Reddit Post Proposal: SteeringRuleInjector

**Status:** Draft — post after implementation is complete and tested
**Subreddit:** r/ClaudeAI (or r/LocalLLaMA if broader audience desired)

---

## Post Title

"I built a hook that injects AI steering rules on-demand instead of all at once — cut my context bloat from 90KB to ~2KB per session"

## Post Body

I've been building a hook system for Claude Code that manages behavioral rules (things like "verify before claiming completion", "check git remote before push", etc.).

**The problem:** I had ~50 steering rules loaded at session start — 90KB of context. Claude Code truncated it to 2KB, so most rules never made it into context. Disabling the loader saved tokens but meant no rules at all.

**The solution:** I split the monolithic rules file into individual `.md` files, each with YAML frontmatter declaring:
- Which hook events trigger it (`SessionStart`, `UserPromptSubmit`)
- Keywords that activate it (e.g., `[push, remote, origin]` for git safety rules)

Now:
- ~5 foundational rules inject at session start (identity, first principles)
- The rest inject **only when relevant** — mention "push" in your prompt and the git safety rule appears
- Each rule injects at most once per session (tracked in a gitignored JSON file)
- Simple substring matching, no inference calls, zero latency

**Result:** Context usage went from 90KB (truncated/broken) to ~2KB at start + ~500 bytes per relevant rule as needed.

The hook registers for both `SessionStart` and `UserPromptSubmit` events — same contract, switches on input shape. Config is just an array of glob patterns pointing to rule directories.

Happy to share the implementation if there's interest. It's part of a larger hook system for Claude Code (TypeScript/Bun).

---

## Notes

- Include a code snippet showing the rule frontmatter format
- Include a before/after token comparison screenshot if possible
- Link to the repo if it's public by then
- Tag as [Project] or [Tool] depending on subreddit conventions
