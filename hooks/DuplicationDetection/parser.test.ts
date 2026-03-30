import { describe, expect, test } from "bun:test";
import { extractFunctions, defaultParserDeps } from "@hooks/hooks/DuplicationDetection/parser";

// ─── Arrow Function Params (previously crashed on p.pat — see parser.ts:177) ─

describe("parser: arrow function params extracted correctly", () => {
  test("extracts paramSig from arrow with simple typed param", () => {
    const code = `const greet = (name: string) => { return name; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("greet");
    expect(fns[0].paramSig).toBe("TsKeywordType");
  });

  test("extracts paramSig from arrow with multiple typed params", () => {
    const code = `const add = (a: number, b: number) => { return a + b; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("TsKeywordType,TsKeywordType");
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

  test("extracts paramSig from regular function (still works)", () => {
    const code = `function greet(name: string) { return name; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].paramSig).toBe("TsKeywordType");
  });

  test("extracts exported arrow function", () => {
    const code = `export const run = (input: Input) => { return input; }`;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(1);
    expect(fns[0].name).toBe("run");
  });

  test("handles mix of regular and arrow functions", () => {
    const code = `
      function regular(x: string) { return x; }
      const arrow = (y: number) => { return y; }
    `;
    const fns = extractFunctions(code, false, defaultParserDeps);
    expect(fns).toHaveLength(2);
    expect(fns[0].name).toBe("regular");
    expect(fns[1].name).toBe("arrow");
  });
});
