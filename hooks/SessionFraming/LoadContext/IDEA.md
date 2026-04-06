# Load Context

> Load configuration, rules, identity, recent work, and relationship context into every new session.

## Problem

Each AI session starts as a blank slate. The assistant does not know its identity, behavioral rules, what the user was working on yesterday, or how the user prefers to communicate. Users must manually re-establish all of this context, which wastes time and leads to inconsistent behavior. A system with many configuration files, rules, and active workstreams needs automated context assembly.

## Solution

At session start, read a settings-driven list of context files (behavioral rules, skills, steering rules), load recent work session metadata, pull in relationship memory (preferences, recent interaction notes), check for pending improvement proposals, and assemble everything into a single context payload. If any component files have changed since last build, regenerate derived artifacts before loading.

## How It Works

1. Check if derived context files (like a skills manifest) need rebuilding by comparing modification times against source components; rebuild if stale.
2. Read a list of context file paths from settings and concatenate their contents.
3. Load relationship context: high-confidence user preferences and recent daily interaction notes.
4. Scan recent work directories (last 48 hours) for active sessions, extracting titles, statuses, and progress from metadata files.
5. Check for pending improvement proposals from the learning system and summarize them.
6. Assemble all pieces — identity, date, session ID, rules, relationship context, active work, proposals — into a single structured context payload.

## Signals

- **Input:** Settings file (context file list, identity), behavioral rule files, relationship memory, work session directories, pending proposals
- **Output:** A single structured context payload injected at session start, containing everything the assistant needs to operate with full awareness

## Context

This is the primary session bootstrap mechanism. It replaces manual context-setting with automated, comprehensive context assembly that adapts as configuration and work state change.
