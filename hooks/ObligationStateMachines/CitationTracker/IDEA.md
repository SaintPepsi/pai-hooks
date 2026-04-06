# Citation Tracker

> Detect when external research tools are used and activate citation enforcement for the rest of the session.

## Problem

Citation enforcement should only activate when external sources have actually been consulted. If no research was done, there is nothing to cite. The system needs a way to detect when research happens and signal that citations are now expected.

## Solution

Watch for the use of web search tools, URL fetching, or research-oriented operations. When any of these are detected, set a persistent session flag that activates the companion citation enforcer for all subsequent file writes.

## How It Works

1. Check whether the current operation is a web search, URL fetch, or research skill invocation.
2. If it matches, write a flag file to session state indicating research has occurred.
3. The companion enforcer reads this flag to decide whether to inject citation reminders.

## Signals

- **Input:** Tool invocations, specifically web search, URL fetch, and research skill calls
- **Output:** A session state flag that activates citation enforcement
