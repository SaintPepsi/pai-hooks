import { describe, expect, it } from "bun:test";
import { decodePatternsConfig } from "@hooks/hooks/SecurityValidator/patterns-schema";

const VALID_CONFIG = {
  version: "1.0",
  philosophy: { mode: "safe", principle: "test" },
  bash: {
    blocked: [{ pattern: "dangerous", reason: "blocked" }],
    confirm: [{ pattern: "risky", reason: "confirm" }],
    alert: [{ pattern: "suspicious", reason: "alert" }],
  },
  paths: {
    zeroAccess: ["~/.ssh/id_*"],
    readOnly: ["/etc/**"],
    confirmWrite: ["**/.env"],
    noDelete: [".git/**"],
  },
  projects: {},
};

describe("decodePatternsConfig", () => {
  it("decodes valid config", () => {
    const result = decodePatternsConfig(JSON.stringify(VALID_CONFIG));
    expect(result).not.toBeNull();
    expect(result!.version).toBe("1.0");
    expect(result!.bash.blocked).toHaveLength(1);
    expect(result!.bash.blocked[0].pattern).toBe("dangerous");
  });

  it("accepts optional regex field on patterns", () => {
    const config = {
      ...VALID_CONFIG,
      bash: {
        ...VALID_CONFIG.bash,
        blocked: [{ pattern: "test$", reason: "regex", regex: true }],
      },
    };
    const result = decodePatternsConfig(JSON.stringify(config));
    expect(result).not.toBeNull();
    expect(result!.bash.blocked[0].regex).toBe(true);
  });

  it("rejects missing version", () => {
    const { version: _, ...noVersion } = VALID_CONFIG;
    const result = decodePatternsConfig(JSON.stringify(noVersion));
    expect(result).toBeNull();
  });

  it("rejects missing bash section", () => {
    const { bash: _, ...noBash } = VALID_CONFIG;
    const result = decodePatternsConfig(JSON.stringify(noBash));
    expect(result).toBeNull();
  });

  it("rejects missing paths section", () => {
    const { paths: _, ...noPaths } = VALID_CONFIG;
    const result = decodePatternsConfig(JSON.stringify(noPaths));
    expect(result).toBeNull();
  });

  it("rejects invalid JSON string", () => {
    const result = decodePatternsConfig("not json");
    expect(result).toBeNull();
  });

  it("rejects empty string", () => {
    const result = decodePatternsConfig("");
    expect(result).toBeNull();
  });

  it("rejects pattern entry missing reason", () => {
    const config = {
      ...VALID_CONFIG,
      bash: {
        ...VALID_CONFIG.bash,
        blocked: [{ pattern: "test" }],
      },
    };
    const result = decodePatternsConfig(JSON.stringify(config));
    expect(result).toBeNull();
  });

  it("decodes the real patterns.json file", () => {
    const { readFile } = require("@hooks/core/adapters/fs");
    const { join } = require("node:path");
    const path = join(import.meta.dir, "patterns.json");
    const fileResult = readFile(path);
    expect(fileResult.ok).toBe(true);
    if (!fileResult.ok) throw new Error(fileResult.error.message);

    const config = decodePatternsConfig(fileResult.value);
    expect(config).not.toBeNull();
    expect(config!.bash.blocked.length).toBeGreaterThan(0);
    expect(config!.bash.confirm.length).toBeGreaterThan(0);
    expect(config!.bash.alert.length).toBeGreaterThan(0);
  });
});
