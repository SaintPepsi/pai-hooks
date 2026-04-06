# Session Framing

> Load system context at session start so every session begins with full situational awareness.

## Problem

AI assistants start each session with no memory of configuration, recent work, or operating context. The user must re-establish context every time — reminding the assistant of project state, active rules, identity, and what happened recently. This wastes time and leads to errors when the assistant acts without context it should already have.

## Solution

Run a set of startup checks at session begin that automatically inject relevant context: load configuration files and behavioral rules, detect the current git branch, check for tool updates, recommend missing safety settings, and surface recent work sessions. The assistant starts every session already knowing who it is, what it is working on, and what rules apply.

## How It Works

1. Load configuration files (behavioral rules, identity, skills) from a settings-driven list and inject them as session context.
2. Detect the current git branch and inject it so the assistant knows which branch it is operating on.
3. Check if the CLI tool has a newer version available and notify the user if so.
4. Check project settings for recommended safety configurations (like gitignore respect) and suggest enabling them.
5. Scan recent work directories for active sessions and surface their status, titles, and progress.
6. Load relationship context (recent notes, high-confidence user preferences) from persistent memory.

## Signals

- **Input:** Configuration files, git state, tool version registry, project settings, recent work directories, relationship memory
- **Output:** A combined context payload injected at session start, containing identity, rules, active work, and environmental awareness
