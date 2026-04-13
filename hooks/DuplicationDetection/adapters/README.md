# Language Adapters

Pluggable language adapters for DuplicationDetection. Each adapter extracts functions from source files of a specific language.

## Interface

Defined in [`../shared.ts`](../shared.ts):

```typescript
interface LanguageAdapter {
  name: string;
  extensions: string[];      // e.g., [".ts", ".tsx"]
  excludePatterns?: string[]; // e.g., [".d.ts", ".d.tsx"]
  extractFunctions(content: string, filePath: string): ExtractedFunction[];
}
```

## Available Adapters

### TypeScript (`typescript.ts`)

Extracts functions from TypeScript/TSX files using SWC parser.

- **Extensions:** `.ts`, `.tsx`
- **Excludes:** `.d.ts`, `.d.tsx` (declaration files)
- **Extracts:** Named functions, arrow functions, method definitions

## Adding New Adapters

1. Create a new file in `adapters/` (e.g., `python.ts`)
2. Export a `LanguageAdapter` object
3. Import and add to `ADAPTERS` array in `adapter-registry.ts`

The registry uses static registration (not auto-discovery) to maintain explicit control over which adapters are loaded.

## Registry Functions

Defined in [`../adapter-registry.ts`](../adapter-registry.ts):

- `getAdapterFor(filePath)` — Returns adapter for file extension, or null if excluded/unsupported
- `hasAdapterFor(filePath)` — Boolean check for adapter support
- `getRegisteredExtensions()` — Returns all registered extensions (note: does not exclude patterns)
