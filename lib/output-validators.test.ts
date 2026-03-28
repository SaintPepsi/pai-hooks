/**
 * Tests for output-validators.ts — Voice and tab title validation utilities.
 */
import { describe, it, expect } from "bun:test";
import {
  isValidVoiceCompletion,
  getVoiceFallback,
  isValidWorkingTitle,
  isValidCompletionTitle,
  isValidQuestionTitle,
  getWorkingFallback,
  getCompletionFallback,
  getQuestionFallback,
  getTabFallback,
  gerundToPastTense,
  isValidTabSummary,
} from "@hooks/lib/output-validators";

// ─── isValidVoiceCompletion ──────────────────────────────────────────────────

describe("isValidVoiceCompletion", () => {
  describe("rejects empty/short input", () => {
    it("rejects empty string", () => {
      expect(isValidVoiceCompletion("")).toBe(false);
    });

    it("rejects string shorter than 10 chars", () => {
      expect(isValidVoiceCompletion("Too short")).toBe(false);
    });
  });

  describe("rejects single-word blocklist items", () => {
    it("rejects 'ready'", () => {
      expect(isValidVoiceCompletion("ready")).toBe(false);
    });

    it("rejects 'done'", () => {
      expect(isValidVoiceCompletion("done")).toBe(false);
    });

    it("rejects 'processing'", () => {
      expect(isValidVoiceCompletion("processing")).toBe(false);
    });
  });

  describe("rejects garbage patterns", () => {
    it("rejects 'I appreciate your help with this'", () => {
      expect(isValidVoiceCompletion("I appreciate your help with this")).toBe(false);
    });

    it("rejects 'Thank you for your patience here'", () => {
      expect(isValidVoiceCompletion("Thank you for your patience here")).toBe(false);
    });

    it("rejects 'Happy to help you with anything'", () => {
      expect(isValidVoiceCompletion("Happy to help you with anything")).toBe(false);
    });

    it("rejects 'Let me know if you need more help'", () => {
      expect(isValidVoiceCompletion("Let me know if you need more help")).toBe(false);
    });

    it("rejects 'Feel free to ask me anything else'", () => {
      expect(isValidVoiceCompletion("Feel free to ask me anything else")).toBe(false);
    });
  });

  describe("rejects conversational starters", () => {
    it("rejects 'I'm working on the implementation now'", () => {
      expect(isValidVoiceCompletion("I'm working on the implementation now")).toBe(false);
    });

    it("rejects 'Sure, I can handle that for you'", () => {
      expect(isValidVoiceCompletion("Sure, I can handle that for you")).toBe(false);
    });

    it("rejects 'Got it, will do that right away'", () => {
      expect(isValidVoiceCompletion("Got it, will do that right away")).toBe(false);
    });

    it("rejects 'Done.' as conversational starter", () => {
      expect(isValidVoiceCompletion("Done.")).toBe(false);
    });
  });

  describe("rejects short text with ready/hello", () => {
    it("rejects short text containing 'ready'", () => {
      expect(isValidVoiceCompletion("System is ready now")).toBe(false);
    });

    it("rejects short text containing 'hello'", () => {
      expect(isValidVoiceCompletion("hello there, how are you")).toBe(false);
    });
  });

  describe("accepts valid completions", () => {
    it("accepts factual summary longer than 10 chars", () => {
      expect(isValidVoiceCompletion("Refactored the authentication module to use JWT tokens")).toBe(true);
    });

    it("accepts technical description", () => {
      expect(isValidVoiceCompletion("Deployed the new database migration to staging")).toBe(true);
    });
  });
});

// ─── getVoiceFallback ────────────────────────────────────────────────────────

describe("getVoiceFallback", () => {
  it("returns empty string", () => {
    expect(getVoiceFallback()).toBe("");
  });
});

// ─── isValidWorkingTitle ─────────────────────────────────────────────────────

describe("isValidWorkingTitle", () => {
  describe("accepts valid gerund titles", () => {
    it("accepts 'Fixing auth bug.'", () => {
      expect(isValidWorkingTitle("Fixing auth bug.")).toBe(true);
    });

    it("accepts 'Refactoring login flow.'", () => {
      expect(isValidWorkingTitle("Refactoring login flow.")).toBe(true);
    });

    it("accepts 'Adding new endpoint.'", () => {
      expect(isValidWorkingTitle("Adding new endpoint.")).toBe(true);
    });
  });

  describe("rejects non-gerund first words", () => {
    it("rejects past tense 'Fixed auth bug.'", () => {
      expect(isValidWorkingTitle("Fixed auth bug.")).toBe(false);
    });

    it("rejects noun phrase 'Auth bug fix.'", () => {
      expect(isValidWorkingTitle("Auth bug fix.")).toBe(false);
    });
  });

  describe("rejects invalid base titles", () => {
    it("rejects too short", () => {
      expect(isValidWorkingTitle("Fix.")).toBe(false);
    });

    it("rejects no period", () => {
      expect(isValidWorkingTitle("Fixing auth bug")).toBe(false);
    });

    it("rejects single word with period", () => {
      expect(isValidWorkingTitle("Fixing.")).toBe(false);
    });

    it("rejects more than 4 words", () => {
      expect(isValidWorkingTitle("Fixing the old auth bug now.")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidWorkingTitle("")).toBe(false);
    });
  });

  describe("rejects garbage working titles", () => {
    it("rejects 'Processing the task.'", () => {
      expect(isValidWorkingTitle("Processing the task.")).toBe(false);
    });

    it("rejects 'Handling the request.'", () => {
      expect(isValidWorkingTitle("Handling the request.")).toBe(false);
    });

    it("rejects 'Working on it.'", () => {
      expect(isValidWorkingTitle("Working on it.")).toBe(false);
    });
  });

  describe("rejects first-person pronouns", () => {
    it("rejects 'Fixing my bug.'", () => {
      expect(isValidWorkingTitle("Fixing my bug.")).toBe(false);
    });
  });

  describe("rejects incomplete endings", () => {
    it("rejects dangling preposition 'Fixing bug for.'", () => {
      expect(isValidWorkingTitle("Fixing bug for.")).toBe(false);
    });

    it("rejects dangling article 'Fixing the.'", () => {
      expect(isValidWorkingTitle("Fixing the.")).toBe(false);
    });

    it("rejects dangling conjunction 'Fixing auth and.'", () => {
      expect(isValidWorkingTitle("Fixing auth and.")).toBe(false);
    });
  });
});

// ─── isValidTabSummary (deprecated alias) ────────────────────────────────────

describe("isValidTabSummary", () => {
  it("is an alias for isValidWorkingTitle", () => {
    expect(isValidTabSummary).toBe(isValidWorkingTitle);
  });
});

// ─── isValidCompletionTitle ──────────────────────────────────────────────────

describe("isValidCompletionTitle", () => {
  describe("accepts valid past-tense titles", () => {
    it("accepts 'Fixed auth bug.'", () => {
      expect(isValidCompletionTitle("Fixed auth bug.")).toBe(true);
    });

    it("accepts 'Deployed new feature.'", () => {
      expect(isValidCompletionTitle("Deployed new feature.")).toBe(true);
    });

    it("accepts 'Built login page.'", () => {
      expect(isValidCompletionTitle("Built login page.")).toBe(true);
    });
  });

  describe("rejects gerund titles", () => {
    it("rejects 'Fixing auth bug.'", () => {
      expect(isValidCompletionTitle("Fixing auth bug.")).toBe(false);
    });

    it("rejects 'Building login page.'", () => {
      expect(isValidCompletionTitle("Building login page.")).toBe(false);
    });
  });

  describe("rejects invalid base titles", () => {
    it("rejects no period", () => {
      expect(isValidCompletionTitle("Fixed auth bug")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidCompletionTitle("")).toBe(false);
    });

    it("rejects too many words", () => {
      expect(isValidCompletionTitle("Fixed the old auth bug now.")).toBe(false);
    });
  });

  describe("rejects garbage completion titles", () => {
    it("rejects 'Completed the task.'", () => {
      expect(isValidCompletionTitle("Completed the task.")).toBe(false);
    });

    it("rejects 'Finished the work.'", () => {
      expect(isValidCompletionTitle("Finished the work.")).toBe(false);
    });
  });
});

// ─── isValidQuestionTitle ────────────────────────────────────────────────────

describe("isValidQuestionTitle", () => {
  describe("accepts valid question titles", () => {
    it("accepts 'Auth method'", () => {
      expect(isValidQuestionTitle("Auth method")).toBe(true);
    });

    it("accepts 'Database config'", () => {
      expect(isValidQuestionTitle("Database config")).toBe(true);
    });

    it("accepts single word", () => {
      expect(isValidQuestionTitle("Architecture")).toBe(true);
    });

    it("accepts up to 4 words", () => {
      expect(isValidQuestionTitle("New auth flow design")).toBe(true);
    });
  });

  describe("rejects invalid question titles", () => {
    it("rejects titles ending with period", () => {
      expect(isValidQuestionTitle("Auth method.")).toBe(false);
    });

    it("rejects titles longer than 30 chars", () => {
      expect(isValidQuestionTitle("A very long question title text")).toBe(false);
    });

    it("rejects more than 4 words", () => {
      expect(isValidQuestionTitle("New auth flow design pattern choice")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isValidQuestionTitle("")).toBe(false);
    });

    it("rejects whitespace-only string", () => {
      expect(isValidQuestionTitle("   ")).toBe(false);
    });

    it("rejects HTML tags", () => {
      expect(isValidQuestionTitle("<div>Auth</div>")).toBe(false);
    });
  });
});

// ─── Fallback functions ──────────────────────────────────────────────────────

describe("getWorkingFallback", () => {
  it("returns 'Processing request.'", () => {
    expect(getWorkingFallback()).toBe("Processing request.");
  });
});

describe("getCompletionFallback", () => {
  it("returns 'Task complete.'", () => {
    expect(getCompletionFallback()).toBe("Task complete.");
  });
});

describe("getQuestionFallback", () => {
  it("returns 'Awaiting input'", () => {
    expect(getQuestionFallback()).toBe("Awaiting input");
  });
});

describe("getTabFallback (deprecated)", () => {
  it("returns working fallback for 'start'", () => {
    expect(getTabFallback("start")).toBe("Processing request.");
  });

  it("returns completion fallback for 'end'", () => {
    expect(getTabFallback("end")).toBe("Task complete.");
  });

  it("defaults to working fallback with no argument", () => {
    expect(getTabFallback()).toBe("Processing request.");
  });
});

// ─── gerundToPastTense ───────────────────────────────────────────────────────

describe("gerundToPastTense", () => {
  describe("irregular verbs", () => {
    it("converts 'building' → 'Built'", () => {
      expect(gerundToPastTense("building")).toBe("Built");
    });

    it("converts 'running' → 'Ran'", () => {
      expect(gerundToPastTense("running")).toBe("Ran");
    });

    it("converts 'writing' → 'Wrote'", () => {
      expect(gerundToPastTense("writing")).toBe("Wrote");
    });

    it("converts 'making' → 'Made'", () => {
      expect(gerundToPastTense("making")).toBe("Made");
    });

    it("converts 'finding' → 'Found'", () => {
      expect(gerundToPastTense("finding")).toBe("Found");
    });

    it("converts 'understanding' → 'Understood'", () => {
      expect(gerundToPastTense("understanding")).toBe("Understood");
    });
  });

  describe("regular verbs", () => {
    it("converts 'fixing' → 'Fixed'", () => {
      expect(gerundToPastTense("fixing")).toBe("Fixed");
    });

    it("converts 'deploying' → 'Deployed'", () => {
      expect(gerundToPastTense("deploying")).toBe("Deployed");
    });

    it("converts 'stopping' → 'Stopped' (preserves doubled consonant)", () => {
      expect(gerundToPastTense("stopping")).toBe("Stopped");
    });

    it("converts 'processing' → 'Processed' (preserves natural ss)", () => {
      expect(gerundToPastTense("processing")).toBe("Processed");
    });
  });

  describe("edge cases", () => {
    it("returns input unchanged if not ending in -ing", () => {
      expect(gerundToPastTense("fixed")).toBe("fixed");
    });

    it("returns input unchanged if too short (< 5 chars)", () => {
      expect(gerundToPastTense("sing")).toBe("sing");
    });

    it("handles uppercase irregular input", () => {
      // getundToPastTense lowercases before lookup
      expect(gerundToPastTense("Building")).toBe("Built");
    });
  });
});
