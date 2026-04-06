# Check Version

> Notify the user at session start if a newer version of the CLI tool is available.

## Problem

CLI tools release updates frequently, but users working inside interactive sessions rarely check for new versions. They miss bug fixes, new features, and security patches simply because nothing tells them an update exists. A passive, non-intrusive update check at session start solves this without disrupting workflow.

## Solution

At session start, compare the locally installed version against the latest published version. If they differ, show a one-line notification. If the check fails (network issues, timeouts), skip silently — the check must never block or slow down the session.

## How It Works

1. At session start, run two parallel checks: get the installed version and query the package registry for the latest version.
2. Compare the two version strings.
3. If they differ, log a human-readable update notification (e.g., "Update available: 1.2.3 -> 1.3.0").
4. If either check fails or versions match, produce no output.
5. Skip entirely for sub-agent sessions.

## Signals

- **Input:** Locally installed CLI version and latest version from the package registry
- **Output:** A notification message if an update is available, or nothing
