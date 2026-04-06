# Last Response Cache

> Extract and store the final assistant message from each session transcript.

## Problem

After a session ends, the AI's last response is buried in a transcript file that may contain hundreds of turns. Downstream processes — rating capture, session summaries, cross-session context — need that last response quickly without parsing the full transcript every time.

## Solution

On session stop, parse the transcript once, find the last assistant message, truncate it to a safe size, and write it to a predictable file path. This turns an O(n) transcript parse into an O(1) file read for any consumer.

## How It Works

1. On session stop, check that a transcript path is available.
2. Read the transcript and iterate through entries to find the last assistant-role message.
3. Extract plain text from the message content (handling both string and structured formats).
4. Truncate to a maximum character limit (e.g., 2000 characters) and write to a fixed cache path.
5. If the transcript is unreadable or contains no assistant messages, exit silently without writing.

## Signals

- **Input:** Session stop event with transcript file path
- **Output:** A text file at a known location containing the truncated last assistant message
