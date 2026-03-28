# SessionAutoName

## Overview

SessionAutoName is an **async UserPromptSubmit** hook that automatically generates concise 2-3 word session titles from the user's first prompt. It uses AI inference to create a descriptive "folder label" name, with a conservative fallback that extracts meaningful words from the prompt. The hook also handles rework scenarios (completed sessions receiving new prompts) by archiving the old name and generating a fresh one.

Custom titles set via `/rename` are treated as authoritative and synced into the session names file without regeneration.

## Event

`UserPromptSubmit` — fires when the user submits a prompt, generating or updating the session name based on the prompt content.

## When It Fires

- A valid `session_id` is present in the hook input
- The session has no existing name (first prompt), OR
- The session has a name but the algorithm state shows completed work and a new prompt arrives (rework scenario), OR
- A custom title from `/rename` needs to be synced

It does **not** fire when:

- No `session_id` is provided in the input
- The session already has a name and is not in a rework state
- The prompt is empty after sanitization
- The algorithm state shows the session is still actively working (not completed)

## What It Does

1. Reads existing session names from `MEMORY/STATE/session-names.json`
2. Checks for a custom title from `/rename` via `sessions-index.json`; syncs it if found
3. Sanitizes the prompt by stripping XML tags, UUIDs, hex strings, and file paths
4. Detects rework: if the session has a name AND the algorithm state shows completed work (phase is COMPLETE/LEARN/IDLE with criteria or summary), archives the old name
5. Calls AI inference with a specialized naming prompt to generate a 2-3 word Topic Case title
6. Validates the generated name: must be 2-3 words, each word 3+ characters, relevant to the prompt
7. Falls back to extracting the first meaningful word + "Session" if inference fails
8. Stores the name in `session-names.json` and a shell cache file for quick access

```typescript
// AI-generated name via inference
const inferenceResult = await deps.inference({
  systemPrompt: NAME_PROMPT,
  prompt: prompt.slice(0, 800),
  level: "fast",
  timeout: 10000,
});

// Validate: 2-3 substantial words, relevant to prompt
if (label && words.length >= 2 && words.length <= 3 && allWordsSubstantial) {
  if (isNameRelevantToPrompt(label, prompt)) {
    storeName(names, namesPath, sessionId, label, deps);
  }
}
```

## Examples

### Example 1: First prompt in a session

> The user submits "Can you help me refactor the authentication middleware?" as their first prompt. SessionAutoName calls inference, which returns "Auth Middleware Refactor". The name is validated as relevant and stored in `session-names.json`. The session now displays this label.

### Example 2: Rework on a completed session

> A session named "Dashboard Redesign" has completed its algorithm run (phase: COMPLETE, criteria present). The user submits a new prompt about API endpoints. SessionAutoName archives "Dashboard Redesign" into `previousNames` in the algorithm state file, generates a new name like "Api Endpoint Design", and stores it.

### Example 3: Custom title sync

> The user runs `/rename Security Audit` in their session. On the next prompt, SessionAutoName detects the custom title in `sessions-index.json`, syncs "Security Audit" into `session-names.json` as the authoritative name, and skips inference.

## Dependencies

| Dependency | Type | Purpose |
| --- | --- | --- |
| `result` | core | `ok()` for Result wrapping |
| `fs` | adapter | `fileExists`, `readJson`, `writeFile`, `ensureDir` for state file access |
| `Inference` | tool | AI inference for generating session names |
