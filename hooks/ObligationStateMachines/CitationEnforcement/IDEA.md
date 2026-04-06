# Citation Enforcement

> Remind authors to cite sources after every write when external research has been used.

## Problem

When someone uses web searches or external research tools during a work session, the facts they find often end up in written output without proper attribution. Vague references like "according to X" are not verifiable — readers need actual URLs, file paths, or documentation section names they can follow.

## Solution

After external research has been detected in the session, inject a citation reminder every time a new file is written or edited. Track which files have already been reminded so the same file does not trigger repeated warnings. The reminder specifies what counts as a proper citation: a URL, file path, or documentation reference.

## How It Works

1. Check whether the session has been flagged as having used external research (set by the companion tracker).
2. If not flagged, pass silently.
3. If flagged, check whether the current file has already received a citation reminder this session.
4. If not yet reminded, inject a citation reminder into the output and mark the file as reminded.

## Signals

- **Input:** File path and content on every file write or edit operation
- **Output:** Citation reminder message (once per file per session), or silent pass
