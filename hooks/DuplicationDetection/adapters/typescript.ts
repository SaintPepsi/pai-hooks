/**
 * TypeScript language adapter for DuplicationDetection.
 *
 * Wraps the SWC-based parser (parser.ts) into the LanguageAdapter interface.
 * Handles both .ts and .tsx files; derives isTsx from the file path.
 * Excludes .d.ts declaration files via excludePatterns.
 */

import { defaultParserDeps, extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";
import type { LanguageAdapter } from "@hooks/hooks/DuplicationDetection/shared";

export const typescriptAdapter: LanguageAdapter = {
  name: "typescript",
  extensions: [".ts", ".tsx"],
  excludePatterns: [".d.ts", ".d.tsx"],
  extractFunctions(content: string, filePath: string) {
    const isTsx = filePath.endsWith(".tsx");
    return extractFunctions(content, isTsx, defaultParserDeps);
  },
};
