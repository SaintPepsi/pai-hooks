# PAI Stubs

Type-compatible stub modules for `@pai/*` imports. These allow pai-hooks to compile as a standalone repo without the PAI framework installed.

When pai-hooks is used as a submodule inside `~/.claude/`, the real PAI modules are resolved via the consumer's tsconfig paths. These stubs are only used for standalone development and testing.

## Modules

| Stub | Real module | Purpose |
|------|------------|---------|
| `Tools/Inference.ts` | `PAI/Tools/Inference.ts` | AI inference via CLI (`InferenceResult`, `inference()`) |
| `Tools/TranscriptParser.ts` | `PAI/Tools/TranscriptParser.ts` | Claude transcript parsing (`ParsedTranscript`, `parseTranscript()`) |
| `Tools/FailureCapture.ts` | `PAI/Tools/FailureCapture.ts` | Failure event capture (`captureFailure()`) |
| `adapters/fs.ts` | `PAI/adapters/fs.ts` | Filesystem helpers (`readFileSafe`, `writeFileSafe`, `pathExists`, `ensureDirSafe`) |

## How it works

`tsconfig.json` maps `@pai/*` to `stubs/pai/*`. Hooks that depend on PAI modules import them normally (`import { inference } from "@pai/Tools/Inference"`) and inject them via their `Deps` interface. Tests mock the Deps — stubs are never called at runtime during tests.

Stub functions throw on direct invocation — they exist only for type resolution.
