# Article Writer

> Spawn a background agent to write a blog article from the session's work when a session ends.

## Problem

Interesting work sessions produce stories worth sharing, but writing about them after the fact requires reconstructing context that has already faded. The best time to write about work is immediately after it happens, while all the details are fresh in the system's memory.

## Solution

At session end, check whether the session produced substantial work (measured by completed requirements criteria). If it did, spawn a background agent in a website repository with instructions to hunt through recent memory for the most compelling story, write an article in a specific voice, and create a pull request. Use a lock file to prevent concurrent article-writing agents.

## How It Works

1. At session end, check that a website repository path is configured and exists on disk.
2. Check that no other article-writing agent is currently running (via a lock file with a 30-minute stale timeout).
3. Verify the session had substantial work by reading its requirements document and counting completed criteria (minimum 4 required).
4. Write a lock file and spawn a background runner process.
5. The runner launches an agent in the website repository with a detailed prompt that instructs it to search memory for stories, write an article, fact-check it, and create a pull request.

## Signals

- **Input:** Session end event with a session ID
- **Output:** A spawned background article-writing agent, or silent skip if gates are not met (no website repo, lock held, insufficient work)
