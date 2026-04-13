# Rebase Guard

> Block or warn on rebase operations based on branch publication state.

## Problem

Rebase rewrites commit history. On a branch that has already been pushed to a remote, this creates a diverged history that requires a force-push — overwriting remote history and potentially destroying work that others have built on top of. AI assistants frequently suggest rebase as a "clean" way to integrate upstream changes without understanding the downstream consequences on shared branches.

At the same time, a blanket block is too blunt: rebase on a purely local branch (never pushed) carries no force-push risk, and mid-rebase control commands like `--abort` and `--continue` must always be allowed or the user is left stuck in a broken state.

## Solution

A three-tier risk model that calibrates the response to actual danger:

- **Allow** — safe operations regardless of branch state: `--abort`, `--continue`, `git pull --rebase`
- **Warn** — rebase on an unpublished branch: continues with an advisory suggesting merge
- **Block** — rebase on a published branch: denies with a message recommending `git merge`

"Published" is defined as having a remote upstream tracking ref. This is the concrete, queryable signal that history has been shared.

## How It Works

1. Before the command executes, query whether the current branch has a remote upstream tracking ref (e.g. `git rev-parse --abbrev-ref @{upstream}`). If the check fails, treat the branch as unpublished — fail open, never block on uncertainty.
2. Split the command into individual segments, handling shell chains (`&&`, `||`, `;`, `|`) and stopping at heredoc markers to avoid matching inside commit messages or script bodies.
3. Classify each segment:
   - `--abort` or `--continue` on `git rebase` → allow
   - `git pull` with `--rebase`/`-r` flag (and no `--no-rebase`) → allow
   - Any other `git rebase` → risky
4. Resolve the highest risk across all segments. If risky: apply the tier based on published state (warn if unpublished, block if published).
5. For warns: continue execution but inject an advisory message the model can see, recommending `git merge`.
6. For blocks: deny the command with a clear explanation and the merge alternative.

## Signals

- **Input:** Shell command string, branch upstream state
- **Output (allow):** Pass through silently
- **Output (warn):** Continue with advisory context — "unpublished branch, rebase is lower risk here, prefer merge"
- **Output (block):** Deny with reason — "published branch, rebase would require force-push, use git merge instead"
