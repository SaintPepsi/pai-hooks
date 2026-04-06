# Session Quality Report

> Generate a quality summary at session end covering all files that were scored during the session.

## Problem

Individual file scores are useful in the moment, but without a session-level summary, trends are invisible. Authors cannot tell whether the session as a whole improved or degraded quality across the codebase. Historical tracking requires persistent, structured reports.

## Solution

At session end, read all stored baselines for the session, aggregate them into a structured report, and write it to persistent storage organized by date. The report lists every scored file, highlights files needing attention (low scores), and celebrates clean files (high scores). Reports accumulate over time, creating a quality history.

## How It Works

1. At session end, load the baseline store containing all file scores from the session.
2. If no files were scored, skip report generation.
3. Compute summary statistics: file count, average score, files needing attention, clean files.
4. Build a markdown report with a file-by-file table sorted by score.
5. Write the report to persistent storage in a date-organized directory.

## Signals

- **Input:** Session end event, plus stored quality baselines from the session
- **Output:** A markdown quality report written to persistent storage
