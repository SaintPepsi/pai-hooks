# Identity Branding

> Enforce consistent identity, branding, and operational analytics in AI-generated output.

## Problem

AI assistants produce external-facing content (pull requests, issues, comments) and operate in different modes throughout a session. Without enforcement, default branding leaks into public content, mode usage goes untracked, and there is no record of system activity volume. Over time this leads to inconsistent public identity and no visibility into how the system is actually used.

## Solution

Intercept outgoing public content to enforce brand identity rules (correct name, sign-off format, no default footers). Separately, track which operational modes are used per session and maintain running counters of system activity. Together these ensure the AI presents a consistent identity externally while providing analytics internally.

## How It Works

1. Before any command that publishes content (PR creation, issue comments, etc.), check for default or incorrect branding and block if found.
2. At session end, scan the transcript to record which operational modes were used and update a persistent analytics store.
3. At session end, count hooks fired, files processed, and signals produced, writing totals to a persistent state file.

## Signals

- **Input:** Outgoing public commands (for branding), session transcripts (for analytics), system activity events (for counts)
- **Output:** Block with correction instructions (branding violations), updated analytics data (mode tracking), updated counters (activity counts)
