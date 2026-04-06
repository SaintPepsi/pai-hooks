# Check Algorithm Version

> Validate that the local workflow definition is up to date with the upstream source.

## Problem

Structured workflows evolve over time. When the upstream definition gets a new version, local copies become stale. Running an outdated version can cause behavioral mismatches, missing phases, or incompatibility with other components that expect the latest version. Users need to know when an update is available without manually checking.

## Solution

At session start, compare the local workflow version against the upstream version hosted in a remote repository. Write a state file indicating whether an update is available, along with the local and upstream version numbers. Other components (like a status banner) can read this file and surface the information to the user.

## How It Works

1. On session start, skip the check if running inside a sub-agent (only the primary session needs to check).
2. Read the local version number from a version file on disk.
3. Fetch the upstream version number from a remote repository.
4. Compare the two versions using semantic versioning (major.minor.patch).
5. Write a state file: if upstream is newer, include both versions and mark an update as available; otherwise, mark no update.

## Signals

- **Input:** Session start event
- **Output:** A state file indicating whether an upstream update is available, with version details
