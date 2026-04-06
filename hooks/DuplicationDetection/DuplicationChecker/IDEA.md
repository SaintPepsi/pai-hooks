# Duplication Checker

> Block code writes that duplicate functions already in the codebase.

## Problem

When writing new code, developers and LLMs frequently create functions that are identical or near-identical to ones that already exist. Without real-time detection, these duplicates merge in and increase maintenance burden — bugs fixed in one copy don't get fixed in the other.

## Solution

A pre-write hook that extracts functions from incoming code and compares them against a pre-built index of all existing functions. Uses multi-signal matching (hash, name, signature, body structure) to catch both exact and near duplicates.

## How It Works

1. Trigger on any write or edit to a code file.
2. Extract all function declarations from the new content.
3. For each function, compute four signals: exact body hash, function name, parameter signature hash, and normalized body hash (ignoring variable names).
4. Query the duplication index for matches across all four signals.
5. If 4/4 signals match or the exact body hash matches — block the write with "this function already exists at [location]."
6. If 2-3 signals match — inject an advisory warning suggesting the author check the similar function.
7. If 0-1 signals match — pass silently.

## Signals

- **Input:** File path and content being written; access to a pre-built function index
- **Output:** Block with duplicate location, advisory with similar function reference, or silent pass
- **Dependency:** Requires a separate index-building component that maintains the function index (see the Duplication Detection group concept)

## Context

This is the checking half of a two-part system. A separate index builder maintains the function index; this component only queries it. The multi-signal approach (rather than simple string matching) catches duplicates even when variable names differ.
