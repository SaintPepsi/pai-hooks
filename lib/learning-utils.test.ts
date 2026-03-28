/**
 * Tests for learning-utils.ts — Categorization and learning detection utilities.
 */
import { describe, it, expect } from "bun:test";
import { getLearningCategory, isLearningCapture } from "@hooks/lib/learning-utils";

// ─── getLearningCategory ─────────────────────────────────────────────────────

describe("getLearningCategory", () => {
  describe("ALGORITHM detection — task execution/approach issues", () => {
    it("detects over-engineering", () => {
      expect(getLearningCategory("the solution was over-engineered")).toBe("ALGORITHM");
    });

    it("detects wrong approach", () => {
      expect(getLearningCategory("that was the wrong approach entirely")).toBe("ALGORITHM");
    });

    it("detects 'should have asked'", () => {
      expect(getLearningCategory("should have asked before starting")).toBe("ALGORITHM");
    });

    it("detects 'didn't follow'", () => {
      expect(getLearningCategory("didn't follow the spec properly")).toBe("ALGORITHM");
    });

    it("detects 'missed the point'", () => {
      expect(getLearningCategory("you missed the point of the request")).toBe("ALGORITHM");
    });

    it("detects 'too complex'", () => {
      expect(getLearningCategory("this is too complex for the task")).toBe("ALGORITHM");
    });

    it("detects 'didn't understand'", () => {
      expect(getLearningCategory("didn't understand the requirement")).toBe("ALGORITHM");
    });

    it("detects 'wrong direction'", () => {
      expect(getLearningCategory("went in the wrong direction")).toBe("ALGORITHM");
    });

    it("detects 'not what i wanted'", () => {
      expect(getLearningCategory("not what i wanted at all")).toBe("ALGORITHM");
    });

    it("detects approach/method/strategy/reasoning keywords", () => {
      expect(getLearningCategory("the approach needs rethinking")).toBe("ALGORITHM");
      expect(getLearningCategory("method was incorrect")).toBe("ALGORITHM");
      expect(getLearningCategory("flawed strategy here")).toBe("ALGORITHM");
      expect(getLearningCategory("reasoning was off")).toBe("ALGORITHM");
    });
  });

  describe("SYSTEM detection — tooling/infrastructure issues", () => {
    it("detects hook issues", () => {
      expect(getLearningCategory("the hook kept crashing")).toBe("SYSTEM");
    });

    it("detects tool/config issues", () => {
      expect(getLearningCategory("the config file was wrong")).toBe("SYSTEM");
    });

    it("detects deployment issues", () => {
      expect(getLearningCategory("deploy pipeline failed")).toBe("SYSTEM");
    });

    it("detects module/import issues", () => {
      expect(getLearningCategory("import failed, module not found")).toBe("SYSTEM");
    });

    it("detects file-not-found issues", () => {
      expect(getLearningCategory("file not found in the path")).toBe("SYSTEM");
    });

    it("detects typescript/bun tooling", () => {
      expect(getLearningCategory("typescript compilation broke")).toBe("SYSTEM");
      expect(getLearningCategory("bun install failed")).toBe("SYSTEM");
    });
  });

  describe("ALGORITHM takes priority over SYSTEM", () => {
    it("returns ALGORITHM when both indicators present", () => {
      // "wrong approach" (ALGORITHM) + "hook" (SYSTEM) → ALGORITHM wins
      expect(getLearningCategory("wrong approach to the hook implementation")).toBe("ALGORITHM");
    });
  });

  describe("defaults to ALGORITHM", () => {
    it("returns ALGORITHM for neutral content", () => {
      expect(getLearningCategory("the sky is blue")).toBe("ALGORITHM");
    });

    it("returns ALGORITHM for empty string", () => {
      expect(getLearningCategory("")).toBe("ALGORITHM");
    });
  });

  describe("comment parameter", () => {
    it("includes comment in analysis", () => {
      // Content alone is neutral, but comment has SYSTEM indicator
      expect(getLearningCategory("general feedback", "hook crashed")).toBe("SYSTEM");
    });

    it("handles undefined comment", () => {
      expect(getLearningCategory("neutral text", undefined)).toBe("ALGORITHM");
    });

    it("handles empty comment", () => {
      expect(getLearningCategory("neutral text", "")).toBe("ALGORITHM");
    });
  });
});

// ─── isLearningCapture ───────────────────────────────────────────────────────

describe("isLearningCapture", () => {
  describe("returns true with 2+ learning indicators", () => {
    it("detects problem + fixed combination", () => {
      expect(isLearningCapture("had a problem, then fixed it")).toBe(true);
    });

    it("detects bug + root cause combination", () => {
      expect(isLearningCapture("found a bug during root cause analysis")).toBe(true);
    });

    it("detects error + lesson combination", () => {
      expect(isLearningCapture("the error taught us a lesson")).toBe(true);
    });

    it("detects troubleshoot + discovered combination", () => {
      expect(isLearningCapture("troubleshoot the issue and discovered the fix")).toBe(true);
    });

    it("detects realized + next time combination", () => {
      expect(isLearningCapture("realized something, next time we know")).toBe(true);
    });
  });

  describe("returns false with fewer than 2 indicators", () => {
    it("returns false for single indicator", () => {
      expect(isLearningCapture("there was an error")).toBe(false);
    });

    it("returns false for no indicators", () => {
      expect(isLearningCapture("the weather is nice today")).toBe(false);
    });

    it("returns false for empty text", () => {
      expect(isLearningCapture("")).toBe(false);
    });
  });

  describe("uses summary and analysis parameters", () => {
    it("counts indicators from summary", () => {
      // text alone has 0, but summary provides 2 indicators
      expect(isLearningCapture("neutral text", "found a bug and fixed it")).toBe(true);
    });

    it("counts indicators from analysis", () => {
      // "troubleshoot" matches pattern 3, "issue" matches pattern 1 → 2 indicators
      expect(isLearningCapture("neutral", undefined, "troubleshoot the issue root cause")).toBe(true);
    });

    it("counts across all three parameters", () => {
      // One indicator in each: problem + fixed + lesson = 3
      expect(isLearningCapture("had a problem", "fixed it", "lesson learned")).toBe(true);
    });

    it("handles undefined summary and analysis", () => {
      expect(isLearningCapture("the weather is nice")).toBe(false);
    });
  });

  describe("case insensitivity", () => {
    it("matches uppercase indicators", () => {
      expect(isLearningCapture("PROBLEM encountered, FIXED it")).toBe(true);
    });

    it("matches mixed case indicators", () => {
      expect(isLearningCapture("Found a Bug and Resolved it")).toBe(true);
    });
  });
});
