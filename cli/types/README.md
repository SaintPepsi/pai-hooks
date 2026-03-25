# cli/types/

Type definitions for the `paih` CLI selective hook installer.

## Files

### `manifest.ts`

TypeScript interfaces for the three manifest levels:

| Interface | Scope | JSON file | Location |
|-----------|-------|-----------|----------|
| `HookManifest` | Per-hook | `hook.json` | Adjacent to contract file |
| `GroupManifest` | Per-group | `group.json` | In group directory |
| `PresetConfig` | Repo-level | `presets.json` | Repo root |

**Key types:**

- `HookDeps` — categorized dependency declaration with `core`, `lib`, `adapters`, and `shared` fields
- `HookManifest` — full hook metadata including event type, deps, tags, and preset membership
- `GroupManifest` — group metadata with alphabetically sorted hook list and shared file declarations
- `PresetEntry` / `PresetConfig` — named presets that select hooks/groups, supports `"*"` wildcard for all groups

**Schema versioning:** `MANIFEST_SCHEMA_VERSION` constant (currently `1`) for forward compatibility.

**Event types:** `HookManifest.event` uses `HookEventType` imported from `core/types/hook-inputs.ts`.
