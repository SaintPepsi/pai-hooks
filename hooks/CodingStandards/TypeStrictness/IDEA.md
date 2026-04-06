# Type Strictness Enforcement

> Block code that uses type-system escape hatches, enforcing strict typing at write-time.

## Problem

Typed languages offer escape hatches that disable type checking — `any` in TypeScript, `Object` casts in Java, `# type: ignore` in Python, `interface{}` in Go. These spread: one escape hatch in a function signature infects every caller. Teams adopt typed languages for safety, then erode that safety one escape hatch at a time. Linters catch this in CI, but by then the code is written and the author has moved on.

## Solution

A pre-write hook that scans every file being written or edited, detects all forms of type escape hatch usage for that language, and blocks the write immediately. The author is forced to use a proper type before the code lands.

## How It Works

1. Trigger on any write or edit to a file in the target language (e.g., `.ts`, `.py`, `.go`).
2. Strip all comments and string literals from the content (to avoid false positives on escape hatch keywords appearing in non-type contexts).
3. Scan for all escape hatch patterns relevant to the language (e.g., in TypeScript: `: any`, `as any`, `<any>`, `any[]`).
4. If any match is found, block the write with the specific line numbers and a suggestion to use a proper type.
5. Optionally, also warn about ambiguous types that may indicate lazy typing rather than intentional narrowing (e.g., bare `unknown` in TypeScript, bare `object` in Python).

## Signals

- **Input:** File path and content being written to a typed-language source file
- **Output:** Block with line numbers and escape hatch details, advisory for ambiguous types, or silent pass

## Context

The specific escape hatches vary by language, but the pattern is universal: every typed language has a way to opt out of type checking, and every team eventually needs enforcement to prevent erosion. TypeScript's `any` is the most common example, but the same approach applies to any language with a type system.
