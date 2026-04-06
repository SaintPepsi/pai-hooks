# Spot Check Review

> Require a code quality review of unpushed changes before ending a session.

## Problem

Code can pass automated checks but still contain subtle bugs, security issues, or quality problems that only a careful review catches. When work sessions end without review, these issues ship unnoticed. Relying on authors to self-review is unreliable — they tend to skip it.

## Solution

At session end, check for unpushed code changes that have not been reviewed. If unreviewed files exist, block the session and request a quality review covering bugs, security, error handling, and project conventions. Track which files have been reviewed using content hashes so re-reviews are only needed when files actually change.

## How It Works

1. When the session is ending, get the list of files with unpushed changes.
2. Compute content hashes for each changed file and compare against previously reviewed hashes.
3. If all files have been reviewed at their current content, pass silently.
4. If unreviewed files exist, block the session and list them with a review request.
5. After one block, mark all current file hashes as reviewed and release the session.

## Signals

- **Input:** Session end attempt, plus version control diff of unpushed changes
- **Output:** Block with list of files needing review, or silent pass if all reviewed
