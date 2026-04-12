import { describe, expect, test } from "bun:test";
import { defaultParserDeps, extractFunctions } from "@hooks/hooks/DuplicationDetection/parser";

// ─── serializeType via paramSig/returnType ──────────────────────────────────

describe("parser: type serialization in paramSig and returnType", () => {
  test("serializes TsKeywordType using kind (string)", () => {
    const code = `function greet(name: string): string { return name; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("string");
    expect(fns[0].returnType).toBe("string");
  });

  test("serializes TsKeywordType using kind (number, boolean, void)", () => {
    const code = `function calc(a: number, b: boolean): void { return; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("number,boolean");
    expect(fns[0].returnType).toBe("void");
  });

  test("serializes TsTypeReference using typeName.value", () => {
    const code = `function process(args: ParsedArgs): AppState { return undefined!; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("ParsedArgs");
    expect(fns[0].returnType).toBe("AppState");
  });

  test("serializes TsTypeReference with typeParams", () => {
    const code = `function get(id: string): Result<string, PaihError> { return undefined!; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].returnType).toBe("Result<string,PaihError>");
  });

  test("serializes TsArrayType with element type", () => {
    const code = `function items(list: MultiSelectItem[]): string[] { return []; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("MultiSelectItem[]");
    expect(fns[0].returnType).toBe("string[]");
  });

  test("serializes TsUnionType with pipe-separated members", () => {
    const code = `function check(val: string | null): boolean { return true; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("string|null");
  });

  test("serializes TsTupleType with bracket notation", () => {
    const code = `function pair(x: number): [string, number] { return ["", 0]; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].returnType).toBe("[string,number]");
  });

  test("serializes TsTypeLiteral as {object}", () => {
    const code = `function make(cfg: { name: string }): void { return; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("{object}");
  });

  test("serializes TsTypeOperator by stripping readonly", () => {
    const code = `function read(items: readonly string[]): void { return; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("string[]");
  });

  test("returns empty string for missing type annotations", () => {
    const code = `function bare(x) { return x; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("");
    expect(fns[0].returnType).toBe("");
  });

  test("serializes generic Map type with params", () => {
    const code = `function lookup(m: Map<string, number>): void { return; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("Map<string,number>");
  });
});

// ─── Arrow Function Params ──────────────────────────────────────────────────

describe("parser: arrow function params use serializeType", () => {
  test("extracts actual type from arrow with typed param", () => {
    const code = `const greet = (name: string) => { return name; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("greet");
    expect(fns[0].paramSig).toBe("string");
  });

  test("extracts actual types from arrow with multiple typed params", () => {
    const code = `const add = (a: number, b: number) => { return a + b; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("number,number");
  });

  test("extracts empty paramSig from arrow with destructured param", () => {
    const code = `const fn = ({ a, b }: Props) => { return a; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("");
  });

  test("extracts empty paramSig from arrow with rest param", () => {
    const code = `const fn = (...args: string[]) => { return args; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("");
  });

  test("extracts exported arrow function", () => {
    const code = `export const run = (input: Input) => { return input; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("run");
    expect(fns[0].paramSig).toBe("Input");
  });

  test("handles mix of regular and arrow functions", () => {
    const code = `
      function regular(x: string) { return x; }
      const arrow = (y: number) => { return y; }
    `;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe("regular");
    expect(fns[0].paramSig).toBe("string");
    expect(fns[1].name).toBe("arrow");
    expect(fns[1].paramSig).toBe("number");
  });
});

// ─── Issue #110 Reproduction ────────────────────────────────────────────────

describe("parser: issue #110 — different sigs for unrelated functions", () => {
  test("createState and status produce different paramSig values", () => {
    const codeA = `function createState(items: MultiSelectItem[]): MultiSelectState { return { cursor: 0, items: items.map((item) => ({ ...item })) }; }`;
    const codeB = `function status(_args: ParsedArgs): Result<string, PaihError> { return { ok: true, value: "not implemented" }; }`;

    const fnsA = extractFunctions(codeA, false, defaultParserDeps);
    const fnsB = extractFunctions(codeB, false, defaultParserDeps);

    expect(fnsA[0].paramSig).toBe("MultiSelectItem[]");
    expect(fnsB[0].paramSig).toBe("ParsedArgs");
    expect(fnsA[0].paramSig).not.toBe(fnsB[0].paramSig);
  });

  test("createState and status produce different returnType values", () => {
    const codeA = `function createState(items: MultiSelectItem[]): MultiSelectState { return { cursor: 0, items: [] }; }`;
    const codeB = `function status(_args: ParsedArgs): Result<string, PaihError> { return { ok: true, value: "" }; }`;

    const fnsA = extractFunctions(codeA, false, defaultParserDeps);
    const fnsB = extractFunctions(codeB, false, defaultParserDeps);

    expect(fnsA[0].returnType).toBe("MultiSelectState");
    expect(fnsB[0].returnType).toBe("Result<string,PaihError>");
    expect(fnsA[0].returnType).not.toBe(fnsB[0].returnType);
  });
});
