# Pre-Compaction State Persist

> Inject active task state into context before memory compaction so progress awareness survives the reset.

## Problem

AI systems with limited context windows periodically compact their memory, discarding older conversation. When this happens, the agent loses awareness of what task it was working on, what phase it was in, and how far along it was. After compaction, the agent may restart work from scratch or lose its place entirely.

## Solution

Before compaction occurs, find the most recently modified requirements document, read its frontmatter (task name, phase, progress, slug), and inject a summary into the post-compaction context. The agent retains task awareness even after the memory window resets.

## How It Works

1. Before context compaction fires, scan all work directories and find the most recently modified requirements document by file modification time.
2. Read the document and parse its YAML frontmatter for task, phase, progress, and slug fields.
3. Build a concise summary string containing these fields.
4. Return the summary as additional context that will persist through the compaction boundary.
5. If no requirements document exists or parsing fails, allow compaction to proceed without injected context.

## Signals

- **Input:** Context compaction event
- **Output:** Injected context summary with active task state (task, slug, phase, progress), or silent pass-through if no active work exists
