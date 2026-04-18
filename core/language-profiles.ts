/**
 * Language Profiles — File extension to language mapping with SOLID-relevant metadata.
 *
 * Used by the quality scorer to determine which heuristics apply to a file.
 * Only source code files get quality scoring — configs, markdown, etc. are skipped.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LanguageProfile {
  /** Language identifier */
  name: string;
  /** File extensions (without dot) */
  extensions: string[];
  /** Whether this language has typed interfaces (affects DIP checks) */
  hasInterfaces: boolean;
  /** Whether this language uses import statements (affects import depth checks) */
  hasImports: boolean;
  /** Comment prefix for section headers (e.g., "//", "#") */
  commentPrefix: string;
  /** Regex to match function/method declarations */
  functionPattern: RegExp;
  /** Regex to match import/require statements */
  importPattern: RegExp;
  /** Regex to match type-only imports (if applicable) */
  typeImportPattern: RegExp | null;
  /** Regex to match interface/protocol declarations */
  interfacePattern: RegExp | null;
}

// ─── Profiles ────────────────────────────────────────────────────────────────

const typescript: LanguageProfile = {
  name: "TypeScript",
  extensions: ["ts", "tsx", "mts", "cts"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern:
    /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+\w+|(?:^|\s)(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(|(?:^|\s)\w+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{/gm,
  importPattern: /^import\s+/gm,
  typeImportPattern: /^import\s+type\s+/gm,
  interfacePattern: /^(?:export\s+)?interface\s+\w+/gm,
};

const javascript: LanguageProfile = {
  name: "JavaScript",
  extensions: ["js", "jsx", "mjs", "cjs"],
  hasInterfaces: false,
  hasImports: true,
  commentPrefix: "//",
  functionPattern:
    /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+\w+|(?:^|\s)(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/gm,
  importPattern: /^(?:import\s+|(?:const|let|var)\s+\w+\s*=\s*require\()/gm,
  typeImportPattern: null,
  interfacePattern: null,
};

const python: LanguageProfile = {
  name: "Python",
  extensions: ["py", "pyi"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "#",
  functionPattern: /^(?:\s*)(?:async\s+)?def\s+\w+/gm,
  importPattern: /^(?:import\s+|from\s+\S+\s+import\s+)/gm,
  typeImportPattern: /^from\s+typing\s+import\s+/gm,
  interfacePattern: /^class\s+\w+\s*\(.*(?:ABC|Protocol)/gm,
};

const go: LanguageProfile = {
  name: "Go",
  extensions: ["go"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?\w+/gm,
  importPattern: /^\s*"[^"]+"/gm,
  typeImportPattern: null,
  interfacePattern: /^type\s+\w+\s+interface\s*\{/gm,
};

const rust: LanguageProfile = {
  name: "Rust",
  extensions: ["rs"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^(?:pub\s+)?(?:async\s+)?fn\s+\w+/gm,
  importPattern: /^use\s+/gm,
  typeImportPattern: null,
  interfacePattern: /^(?:pub\s+)?trait\s+\w+/gm,
};

const java: LanguageProfile = {
  name: "Java",
  extensions: ["java"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^\s*(?:public|private|protected|static|\s)*\s+\w+\s+\w+\s*\(/gm,
  importPattern: /^import\s+/gm,
  typeImportPattern: null,
  interfacePattern: /^(?:public\s+)?interface\s+\w+/gm,
};

const ruby: LanguageProfile = {
  name: "Ruby",
  extensions: ["rb"],
  hasInterfaces: false,
  hasImports: true,
  commentPrefix: "#",
  functionPattern: /^\s*def\s+\w+/gm,
  importPattern: /^require\s+/gm,
  typeImportPattern: null,
  interfacePattern: null,
};

const php: LanguageProfile = {
  name: "PHP",
  extensions: ["php"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^\s*(?:public|private|protected|static|\s)*\s*function\s+\w+/gm,
  importPattern: /^use\s+/gm,
  typeImportPattern: null,
  interfacePattern: /^interface\s+\w+/gm,
};

const swift: LanguageProfile = {
  name: "Swift",
  extensions: ["swift"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^\s*(?:public|private|internal|open|static|\s)*\s*func\s+\w+/gm,
  importPattern: /^import\s+/gm,
  typeImportPattern: null,
  interfacePattern: /^(?:public\s+)?protocol\s+\w+/gm,
};

const csharp: LanguageProfile = {
  name: "C#",
  extensions: ["cs"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern: /^\s*(?:public|private|protected|internal|static|async|\s)*\s+\w+\s+\w+\s*\(/gm,
  importPattern: /^using\s+/gm,
  typeImportPattern: null,
  interfacePattern: /^(?:public\s+)?interface\s+I\w+/gm,
};

const svelte: LanguageProfile = {
  name: "Svelte",
  extensions: ["svelte"],
  hasInterfaces: true,
  hasImports: true,
  commentPrefix: "//",
  functionPattern:
    /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+\w+|(?:^|\s)(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(/gm,
  importPattern: /^import\s+/gm,
  typeImportPattern: /^import\s+type\s+/gm,
  interfacePattern: /^(?:export\s+)?interface\s+\w+/gm,
};

// ─── Registry ────────────────────────────────────────────────────────────────

const ALL_PROFILES: LanguageProfile[] = [
  typescript,
  javascript,
  python,
  go,
  rust,
  java,
  ruby,
  php,
  swift,
  csharp,
  svelte,
];

const extensionMap = new Map<string, LanguageProfile>();
for (const profile of ALL_PROFILES) {
  for (const ext of profile.extensions) {
    extensionMap.set(ext, profile);
  }
}

/** Extensions that are source code but NOT scored (configs, data, docs). */
const SKIP_EXTENSIONS = new Set([
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
  "scss",
  "less",
  "md",
  "mdx",
  "txt",
  "csv",
  "sql",
  "graphql",
  "gql",
  "lock",
  "log",
  "env",
  "ini",
  "cfg",
  "conf",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "ico",
  "webp",
  "wasm",
  "map",
  "d.ts",
]);

/** Filenames that are source code but should be skipped by quality scoring and coding standards enforcement. */
export const SKIP_FILENAMES = new Set([
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.shims.d.ts",
  "vitest-setup-client.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
  // Contains intentional violation strings as test fixtures
  "coding-standards-checks.test.ts",
  // Contains intentional violation strings as test fixtures
  "quality-scorer.test.ts",
]);

/** Path patterns for config directories that don't need tests — verified by running the tool, not unit tests. */
const SKIP_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.storybook\//, // Storybook config (main.ts, preview.ts)
  /(^|\/)\.vscode\//, // VS Code config
  /(^|\/)\.github\//, // GitHub Actions/workflows
  /(^|\/)\.husky\//, // Husky git hooks
  /\.stories\.(svelte|ts|tsx|js|jsx)$/, // Storybook story files — visual tests, not unit-testable
  /eslint\.config\.(ts|js|mjs|cjs)$/, // ESLint flat config — verified by linting, not unit tests
];

/**
 * Get the language profile for a file path. Returns null if:
 * - Extension is not recognized as scorable source code
 * - File is a config/data/doc format
 * - Filename is in the skip list
 */
export function getLanguageProfile(filePath: string): LanguageProfile | null {
  const basename = filePath.split("/").pop() ?? "";
  if (SKIP_FILENAMES.has(basename)) return null;

  // Skip config directories that are verified by running the tool, not unit tests
  if (SKIP_PATH_PATTERNS.some((pattern) => pattern.test(filePath))) return null;

  const parts = filePath.split(".");
  const ext = parts.pop()?.toLowerCase();
  if (!ext) return null;

  // Check compound extensions (e.g., "d.ts")
  if (parts.length >= 2) {
    const compound = `${parts[parts.length - 1]}.${ext}`.toLowerCase();
    if (SKIP_EXTENSIONS.has(compound)) return null;
  }

  if (SKIP_EXTENSIONS.has(ext)) return null;
  return extensionMap.get(ext) ?? null;
}

/**
 * Check if a file path points to scorable source code.
 */
export function isScorableFile(filePath: string): boolean {
  return getLanguageProfile(filePath) !== null;
}

/**
 * Get all registered language profiles.
 */
export function getAllProfiles(): readonly LanguageProfile[] {
  return ALL_PROFILES;
}
