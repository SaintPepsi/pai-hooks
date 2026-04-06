# Hook Execute Permission

> Automatically set execute permissions on newly created hook files.

## Problem

In systems where hooks are standalone executable scripts, newly created files don't have execute permission by default. The hook appears to be registered correctly but fails silently at runtime because the operating system won't run a file without the execute bit. This is a recurring issue because the failure mode is invisible — no error message, the hook just doesn't fire.

## Solution

After a hook file is created, automatically set the execute permission bit. This eliminates an entire class of "hook doesn't work" debugging sessions by making permission setting part of the creation workflow rather than a manual afterthought.

## How It Works

1. After a file is written, check if it matches the hook file naming convention and location.
2. If it's a hook file, run the system command to set execute permission on it.
3. Log success or failure for visibility.

## Signals

- **Input:** File path after a file write operation completes
- **Output:** Silent (sets permission as a side effect, never blocks)
