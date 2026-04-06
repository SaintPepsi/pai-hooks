# Duplication Index Builder

> Build and maintain a searchable index of all functions in a codebase for instant duplicate detection.

## Problem

Checking whether a new function duplicates an existing one requires knowing what already exists. Scanning the entire codebase on every file write is too slow. Without a pre-built index, duplicate detection either takes too long to run in real time or skips the comparison entirely.

## Solution

Build a function index eagerly at session start, then update it surgically whenever a file changes. The index stores each function's name, signature hash, body hash, and file location. On file writes, only the changed file is re-parsed and its entries replaced — the rest of the index stays intact. This keeps the index fresh with near-zero latency.

## How It Works

1. At session start, scan the project for all code files, extract every function, and build a full index with hashes and locations.
2. Persist the index to a JSON file in a project-specific artifacts directory.
3. When a code file is written or edited, re-parse only that file and surgically update its entries in the existing index.
4. If the index file is missing or corrupted, fall back to a full rebuild.
5. If a file is deleted, remove its entries from the index.

## Signals

- **Input:** Session start (full build) or file write/edit events for code files (surgical update)
- **Output:** A persisted JSON index file mapping every function to its name, hashes, and source location

## Context

This is the indexing half of a two-part system. The index builder creates and maintains the data; a separate duplicate checker reads it at write time to compare new functions against known ones.
