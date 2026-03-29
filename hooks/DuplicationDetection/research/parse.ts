// SWC parser wrapper — extracts functions, imports, signatures from .ts files.
// Reuses patterns from Tools/ast-spike.ts (line mapper, parseSync config, function walking).

import type {
  ArrowFunctionExpression,
  BindingIdentifier,
  BlockStatement,
  ExportDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  ImportDeclaration,
  Module,
  ModuleItem,
  Param,
  Pattern,
  Statement,
  TsType,
  VariableDeclaration,
} from "@swc/core";
import {
  isDirectorySafe,
  joinPath,
  parseTsSourceSafe,
  readDirSafe,
  readFileSafe,
  resolvePath,
  sha256Short,
} from "@tools/pattern-detector/adapters";
import type { ParamInfo, ParsedFile, ParsedFunction } from "@tools/pattern-detector/types";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ParseDeps {
  readFile: (path: string) => string | null;
  readDir: (path: string) => string[] | null;
  isDirectory: (path: string) => boolean;
  createHash: (content: string) => string;
  parseTsSource: (source: string, isTsx: boolean) => Module | null;
  join: (...parts: string[]) => string;
  resolve: (path: string) => string;
}

export const defaultParseDeps: ParseDeps = {
  readFile: readFileSafe,
  readDir: readDirSafe,
  isDirectory: isDirectorySafe,
  createHash: sha256Short,
  parseTsSource: parseTsSourceSafe,
  join: joinPath,
  resolve: resolvePath,
};

// ─── Line Mapper (from Tools/ast-spike.ts) ──────────────────────────────────

function makeLineMapper(source: string): (offset: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    for (let step = 0; step < 32 && lo < hi; step++) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ─── AST Node Collection and Normalization ──────────────────────────────────
// Uses JSON serialization to walk AST generically without type casting.
// SWC AST nodes are plain objects at runtime — JSON.stringify traverses them
// naturally, and regex/replacer functions extract what we need.

const TYPE_PATTERN = /"type":"([^"]+)"/g;

function collectNodeTypes(body: BlockStatement): string[] {
  const json = JSON.stringify(body);
  return Array.from(json.matchAll(TYPE_PATTERN), (m) => m[1]);
}

// Structural keys preserved during normalization — everything else stripped
const STRUCTURAL_KEYS = new Set(["type", "kind", "declare", "async", "generator"]);

function normalizeForHash(body: BlockStatement): string {
  return JSON.stringify(body, (key: string, value: unknown): unknown => {
    if (key === "span" || key === "value" || key === "raw") return undefined;
    if (STRUCTURAL_KEYS.has(key)) return value;
    if (typeof value === "string" && key !== "type") return "";
    return value;
  });
}

// ─── Type Annotation Extraction ─────────────────────────────────────────────

function typeToString(tsType: TsType | undefined | null): string | null {
  if (!tsType) return null;
  return tsType.type;
}

function isBindingIdentifier(pat: Pattern): pat is BindingIdentifier {
  return pat.type === "Identifier" && "typeAnnotation" in pat;
}

function extractParams(params: Param[]): ParamInfo[] {
  return params.map((p, i) => ({
    index: i,
    typeAnnotation:
      isBindingIdentifier(p.pat) && p.pat.typeAnnotation
        ? typeToString(p.pat.typeAnnotation.typeAnnotation)
        : null,
  }));
}

// ─── Function Extraction ────────────────────────────────────────────────────

interface ExtractContext {
  toLine: (offset: number) => number;
  fileImports: string[];
  filePath: string;
  deps: ParseDeps;
}

function extractFromFunction(
  name: string,
  body: BlockStatement | undefined,
  params: Param[],
  returnType: TsType | undefined | null,
  ctx: ExtractContext,
  span: { start: number },
): ParsedFunction | null {
  if (!body) return null;

  return {
    name,
    file: ctx.filePath,
    line: ctx.toLine(span.start),
    params: extractParams(params),
    returnType: typeToString(returnType),
    imports: [...ctx.fileImports],
    bodyNodeTypes: collectNodeTypes(body),
    bodyHash: ctx.deps.createHash(normalizeForHash(body)),
  };
}

function walkStatements(stmts: (ModuleItem | Statement)[], ctx: ExtractContext): ParsedFunction[] {
  const functions: ParsedFunction[] = [];

  function processVarDecl(decl: VariableDeclaration): void {
    for (const d of decl.declarations) {
      const init = d.init;
      if (!init) continue;
      if (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression") {
        const name = d.id.type === "Identifier" ? d.id.value : "<anonymous>";
        const arrow = init as ArrowFunctionExpression | FunctionExpression;
        const body = arrow.body;
        if (body && body.type === "BlockStatement") {
          // ArrowFunctionExpression has Pattern[], FunctionExpression has Param[]
          // Normalize Pattern[] to Param[] by wrapping bare patterns
          const params: Param[] = arrow.params.map((p) =>
            "pat" in p
              ? (p as Param)
              : { type: "Parameter" as const, pat: p, span: arrow.span, decorators: [] },
          );
          const fn = extractFromFunction(
            name,
            body as BlockStatement,
            params,
            arrow.returnType?.typeAnnotation,
            ctx,
            arrow.span,
          );
          if (fn) functions.push(fn);
        }
      }
    }
  }

  for (const stmt of stmts) {
    if (stmt.type === "FunctionDeclaration") {
      const decl = stmt as FunctionDeclaration;
      const fn = extractFromFunction(
        decl.identifier.value,
        decl.body,
        decl.params,
        decl.returnType?.typeAnnotation,
        ctx,
        decl.span,
      );
      if (fn) functions.push(fn);
    } else if (stmt.type === "ExportDeclaration") {
      const inner = (stmt as ExportDeclaration).declaration;
      if (inner.type === "FunctionDeclaration") {
        const fn = extractFromFunction(
          inner.identifier.value,
          inner.body,
          inner.params,
          inner.returnType?.typeAnnotation,
          ctx,
          inner.span,
        );
        if (fn) functions.push(fn);
      } else if (inner.type === "VariableDeclaration") {
        processVarDecl(inner);
      }
    } else if (stmt.type === "VariableDeclaration") {
      processVarDecl(stmt as VariableDeclaration);
    }
  }

  return functions;
}

// ─── Import Extraction ──────────────────────────────────────────────────────

function extractImports(items: ModuleItem[]): string[] {
  const imports: string[] = [];
  for (const item of items) {
    if (item.type === "ImportDeclaration") {
      imports.push((item as ImportDeclaration).source.value);
    }
  }
  return imports.sort();
}

// ─── File Parsing ───────────────────────────────────────────────────────────

export function parseFile(filePath: string, deps: ParseDeps = defaultParseDeps): ParsedFile | null {
  const source = deps.readFile(filePath);
  if (source === null) return null;

  const ast = deps.parseTsSource(source, filePath.endsWith(".tsx"));
  if (!ast) return null;

  const toLine = makeLineMapper(source);
  const imports = extractImports(ast.body);
  const ctx: ExtractContext = { toLine, fileImports: imports, filePath, deps };
  const functions = walkStatements(ast.body, ctx);

  return { path: filePath, functions, imports };
}

// ─── Directory Scanning ─────────────────────────────────────────────────────

export function findTsFiles(dir: string, deps: ParseDeps = defaultParseDeps): string[] {
  const results: string[] = [];
  const absDir = deps.resolve(dir);

  function walk(d: string): void {
    const entries = deps.readDir(d);
    if (!entries) return;
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git") continue;
      const full = deps.join(d, entry);
      if (deps.isDirectory(full)) {
        walk(full);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
        results.push(full);
      }
    }
  }

  walk(absDir);
  return results.sort();
}

export function parseDirectory(dir: string, deps: ParseDeps = defaultParseDeps): ParsedFile[] {
  const files = findTsFiles(dir, deps);
  const parsed: ParsedFile[] = [];
  for (const f of files) {
    const result = parseFile(f, deps);
    if (result && result.functions.length > 0) {
      parsed.push(result);
    }
  }
  return parsed;
}
