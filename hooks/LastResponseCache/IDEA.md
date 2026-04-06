# Last Response Cache

> Preserve the AI's final response so it can be referenced after the session ends.

## Problem

Once an AI session ends, the last response is locked inside the transcript — a potentially large file that is expensive to parse. Other processes that need quick access to what the AI last said (rating systems, follow-up prompts, cross-session context) have no lightweight way to get it.

## Solution

When a session stops, parse the transcript to extract the last assistant message and write it to a small, fixed-location cache file. Any process that needs the previous response can read this one file instead of re-parsing the entire transcript.

## How It Works

1. When the session stop event fires, read the session transcript.
2. Parse the transcript line by line, tracking the last message from the assistant role.
3. Extract the plain text content, truncate to a reasonable size limit.
4. Write it to a known cache file path that other processes can reference.

## Signals

- **Input:** Session stop event with a transcript file path
- **Output:** A small text file containing the last assistant response (truncated)

## Context

This is a building block for cross-session features. A rating capture system, for example, can show the user what the AI last said without needing access to the full transcript.
