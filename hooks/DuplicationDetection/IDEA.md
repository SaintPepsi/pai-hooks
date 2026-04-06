# Duplication Detection

> Prevent duplicate code from entering a codebase by detecting it at write-time.

## Problem

Codebases accumulate duplicate code over time. Developers and LLMs often write functions that already exist elsewhere because they don't know about them. Traditional duplicate detection tools run after the fact — in CI or manual audits — by which point the duplication is already merged and rarely cleaned up.

## Solution

Intercept file writes before they land and compare new functions against a pre-built index of everything that already exists. If a new function is identical or near-identical to an existing one, block the write and point the author to the original. Maintain the index incrementally so lookups are instant.

## How It Works

1. On session start, build (or load) an index of all functions in the codebase — storing each function's name, signature hash, and body hash.
2. When a file is written, extract all functions from the new content.
3. Compare each new function against the index on four dimensions: exact body hash, name match, signature similarity, and structural similarity.
4. If all four dimensions match, block the write and show the existing function's location.
5. If some dimensions match (near-duplicate), warn the author but allow the write.
6. After any successful write, update the index incrementally for the changed file.

## Signals

- **Input:** File path and new file content on every write operation to a code file
- **Output:** Block (with location of existing duplicate), warn (near-duplicate advisory), or pass

## Context

This pattern works best in repos with many contributors or heavy LLM-assisted development, where the risk of unknowingly recreating existing code is highest.
