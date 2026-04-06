# Gitignore Recommender

> Suggest enabling gitignore-based file filtering to prevent accidental access to sensitive files.

## Problem

AI coding assistants can read any file in a project, including those that should be ignored — `.env` files with secrets, credential files, large generated artifacts. Most projects have a `.gitignore` that defines what should be excluded, but the AI tool may not respect it by default. Users often do not realize this setting exists until after a sensitive file has been read.

## Solution

At session start, check whether the current project has gitignore-respect enabled in its local settings. If not, inject a suggestion for the assistant to offer enabling it. This is a one-time check per session — non-blocking, non-intrusive, and actionable.

## How It Works

1. At session start, determine the current project directory.
2. Skip if the project is the AI tool's own configuration directory (it manages its own settings).
3. Check the project's settings file and local settings file for a gitignore-respect flag.
4. If neither file has the flag enabled, inject a context message suggesting the assistant offer to enable it.
5. If the flag is already enabled, produce no output.

## Signals

- **Input:** Project directory path and its settings files
- **Output:** A suggestion to enable gitignore-respect if it is not already configured, or nothing
