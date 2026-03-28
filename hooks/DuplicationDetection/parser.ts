/**
 * DuplicationDetection parser — extracts functions from TypeScript content.
 *
 * Uses @swc/core to parse content and extract function signatures, body hashes,
 * and condensed body fingerprints. Called by the DuplicationChecker contract
 * to analyze files being written.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExtractedFunction {
  name: string;
  line: number;
  bodyHash: string;
  paramSig: string;
  returnType: string;
  fingerprint: string;
}

// ─── Fingerprint ────────────────────────────────────────────────────────────

const TOP_NODE_TYPES = [
  "Identifier", "CallExpression", "MemberExpression", "StringLiteral",
  "VariableDeclarator", "VariableDeclaration", "BlockStatement", "ReturnStatement",
  "IfStatement", "BinaryExpression", "ObjectExpression", "KeyValueProperty",
  "ExpressionStatement", "TemplateLiteral", "TemplateElement", "ArrayExpression",
] as const;

const NODE_TYPE_INDEX = new Map(TOP_NODE_TYPES.map((t, i) => [t, i]));

export function buildFingerprint(nodeTypes: string[]): string {
  const counts = new Uint8Array(16);
  for (const t of nodeTypes) {
    const idx = NODE_TYPE_INDEX.get(t as typeof TOP_NODE_TYPES[number]);
    if (idx !== undefined && counts[idx] < 255) counts[idx]++;
  }
  return Array.from(counts).map((c) => c.toString(16).padStart(2, "0")).join("");
}

// ─── AST Utilities ──────────────────────────────────────────────────────────

const TYPE_PATTERN = /"type":"([^"]+)"/g;
const STRUCTURAL_KEYS = new Set(["type", "kind", "declare", "async", "generator"]);

function collectNodeTypes(body: object): string[] {
  const json = JSON.stringify(body);
  const types: string[] = [];
  let match: RegExpExecArray | null;
  TYPE_PATTERN.lastIndex = 0;
  while ((match = TYPE_PATTERN.exec(json)) !== null) {
    types.push(match[1]);
  }
  return types;
}

function normalizeForHash(body: object): string {
  return JSON.stringify(body, (key: string, value: unknown): unknown => {
    if (key === "span" || key === "value" || key === "raw") return undefined;
    if (STRUCTURAL_KEYS.has(key)) return value;
    if (typeof value === "string" && key !== "type") return "";
    return value;
  });
}

function makeLineMapper(content: string): (offset: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") lineStarts.push(i + 1);
  }
  return (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface ParserDeps {
  parseSync: (source: string, opts: { syntax: string; target: string }) => { body: AstStatement[] };
  createHash: (content: string) => string;
}

interface AstParam {
  pat: { type: string; typeAnnotation?: { typeAnnotation?: { type: string } } };
}

interface AstReturnType {
  typeAnnotation?: { type: string };
}

interface AstBody {
  type: string;
  span: { start: number };
}

interface AstStatement {
  type: string;
  span: { start: number };
  identifier?: { value: string };
  body?: AstBody;
  params?: AstParam[];
  returnType?: AstReturnType;
  declaration?: AstStatement;
  declarations?: Array<{
    id: { type: string; value?: string };
    init?: {
      type: string;
      body?: AstBody;
      params: AstParam[];
      returnType?: AstReturnType;
      span: { start: number };
    };
  }>;
}

export const defaultParserDeps: ParserDeps = {
  parseSync: (source, opts) => require("@swc/core").parseSync(source, opts),
  createHash: (content) =>
    require("crypto").createHash("sha256").update(content).digest("hex").slice(0, 16) as string,
};

// ─── Extraction ─────────────────────────────────────────────────────────────

export function extractFunctions(
  content: string,
  isTsx: boolean,
  deps: ParserDeps = defaultParserDeps,
): ExtractedFunction[] {
  const ast = deps.parseSync(content, {
    syntax: isTsx ? "tsx" : "typescript",
    target: "es2022",
  });

  const toLine = makeLineMapper(content);
  const functions: ExtractedFunction[] = [];

  function processFunc(
    name: string,
    body: AstBody | undefined,
    params: AstParam[],
    retType: AstReturnType | undefined,
    span: { start: number },
  ): void {
    if (!body || body.type !== "BlockStatement") return;
    const nodeTypes = collectNodeTypes(body);
    const hash = deps.createHash(normalizeForHash(body));
    functions.push({
      name,
      line: toLine(span.start),
      bodyHash: hash,
      paramSig: params.map((p) =>
        p.pat.type === "Identifier" && p.pat.typeAnnotation?.typeAnnotation?.type
          ? p.pat.typeAnnotation.typeAnnotation.type : "",
      ).join(","),
      returnType: retType?.typeAnnotation?.type ?? "",
      fingerprint: buildFingerprint(nodeTypes),
    });
  }

  function processVarDecl(stmt: AstStatement): void {
    if (!stmt.declarations) return;
    for (const d of stmt.declarations) {
      if (!d.init) continue;
      if (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression") {
        const name = d.id.type === "Identifier" ? (d.id.value ?? "<anon>") : "<anon>";
        processFunc(name, d.init.body, d.init.params, d.init.returnType, d.init.span);
      }
    }
  }

  for (const stmt of ast.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.body) {
      processFunc(stmt.identifier?.value ?? "<anon>", stmt.body, stmt.params ?? [], stmt.returnType, stmt.span);
    } else if (stmt.type === "ExportDeclaration" && stmt.declaration) {
      const decl = stmt.declaration;
      if (decl.type === "FunctionDeclaration" && decl.body) {
        processFunc(decl.identifier?.value ?? "<anon>", decl.body, decl.params ?? [], decl.returnType, decl.span);
      } else if (decl.type === "VariableDeclaration") {
        processVarDecl(decl);
      }
    } else if (stmt.type === "VariableDeclaration") {
      processVarDecl(stmt);
    }
  }

  return functions;
}
