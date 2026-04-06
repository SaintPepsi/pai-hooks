## Problem

Developers create new automation hooks but forget to write documentation. Missing docs accumulate silently until someone notices, making onboarding and maintenance harder.

## Solution

A commit-time gate that scans every hook directory for required documentation files and blocks the commit if any are missing. Catches documentation gaps before they enter the repository.

## How It Works

1. A pre-commit interceptor watches for version control commit commands
2. It scans the hooks directory tree for hook manifest files (e.g., `hook.json`)
3. For each manifest found, it checks whether sibling documentation files exist
4. If any documentation is missing, the commit is blocked with a clear listing of what's needed
5. If all documentation is present, the commit proceeds

## Signals

**Input:** A shell command about to be executed (specifically, a version control commit)

**Output:** Either allow (continue) or block with a list of hooks missing documentation
