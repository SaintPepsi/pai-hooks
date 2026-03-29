/**
 * Tests for lib/identity.ts — Central Identity Loader
 *
 * Exercises the voices/personality paths with properly typed data,
 * and verifies the Deps injection pattern works correctly.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { fileNotFound } from "@hooks/core/error";
import {
  clearCache,
  getDAName,
  getDefaultIdentity,
  getDefaultPrincipal,
  getIdentity,
  getPrincipal,
  getPrincipalName,
  getVoiceId,
  getVoicePersonality,
  getVoiceProsody,
  type Identity,
  type IdentityDeps,
  type Settings,
  type VoicePersonality,
  type VoiceProsody,
} from "@hooks/lib/identity";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeDeps(settings: Settings): IdentityDeps {
  return {
    settingsPath: "/tmp/test-settings.json",
    readJson: () => ({ ok: true as const, value: settings }),
    fileExists: () => true,
  };
}

function emptyDeps(): IdentityDeps {
  return {
    settingsPath: "/tmp/test-settings.json",
    readJson: () => ({ ok: true as const, value: {} }),
    fileExists: () => true,
  };
}

function missingFileDeps(): IdentityDeps {
  return {
    settingsPath: "/tmp/missing-settings.json",
    readJson: () => ({ ok: false as const, error: fileNotFound("/tmp/missing-settings.json") }),
    fileExists: () => false,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("getIdentity", () => {
  beforeEach(() => clearCache());

  it("returns defaults when settings file is missing", () => {
    const identity = getIdentity(missingFileDeps());
    expect(identity.name).toBe("PAI");
    expect(identity.fullName).toBe("Personal AI");
    expect(identity.displayName).toBe("PAI");
    expect(identity.mainDAVoiceID).toBe("");
    expect(identity.color).toBe("#3B82F6");
    expect(identity.voice).toBeUndefined();
    expect(identity.personality).toBeUndefined();
  });

  it("returns defaults when settings has no daidentity", () => {
    const identity = getIdentity(emptyDeps());
    expect(identity.name).toBe("PAI");
    expect(identity.fullName).toBe("Personal AI");
  });

  it("reads basic identity fields", () => {
    const deps = makeDeps({
      daidentity: {
        name: "Maple",
        fullName: "Maple the AI",
        displayName: "Mapes",
        color: "#FF0000",
      },
    });
    const identity = getIdentity(deps);
    expect(identity.name).toBe("Maple");
    expect(identity.fullName).toBe("Maple the AI");
    expect(identity.displayName).toBe("Mapes");
    expect(identity.color).toBe("#FF0000");
  });

  it("falls back fullName and displayName to name", () => {
    const deps = makeDeps({ daidentity: { name: "Ren" } });
    const identity = getIdentity(deps);
    expect(identity.fullName).toBe("Ren");
    expect(identity.displayName).toBe("Ren");
  });

  it("reads voices.main for voiceId and voice prosody", () => {
    const prosody: VoiceProsody = {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.3,
      speed: 1.0,
      use_speaker_boost: true,
    };
    const deps = makeDeps({
      daidentity: {
        name: "Maple",
        voices: {
          main: { voiceId: "voice-123", ...prosody },
        },
      },
    });
    const identity = getIdentity(deps);
    expect(identity.mainDAVoiceID).toBe("voice-123");
    expect(identity.voice).toBeDefined();
    expect(identity.voice?.stability).toBe(0.5);
    expect(identity.voice?.use_speaker_boost).toBe(true);
  });

  it("falls back mainDAVoiceID to direct field when no voices.main", () => {
    const deps = makeDeps({
      daidentity: {
        name: "Maple",
        mainDAVoiceID: "legacy-id",
      },
    });
    const identity = getIdentity(deps);
    expect(identity.mainDAVoiceID).toBe("legacy-id");
    expect(identity.voice).toBeUndefined();
  });

  it("reads personality from daidentity", () => {
    const personality: VoicePersonality = {
      baseVoice: "warm",
      enthusiasm: 0.8,
      energy: 0.7,
      expressiveness: 0.9,
      resilience: 0.6,
      composure: 0.5,
      optimism: 0.8,
      warmth: 0.9,
      formality: 0.3,
      directness: 0.7,
      precision: 0.8,
      curiosity: 0.9,
      playfulness: 0.6,
    };
    const deps = makeDeps({
      daidentity: {
        name: "Maple",
        personality,
      },
    });
    const identity = getIdentity(deps);
    expect(identity.personality).toBeDefined();
    expect(identity.personality?.baseVoice).toBe("warm");
    expect(identity.personality?.warmth).toBe(0.9);
  });

  it("caches settings across calls with same deps", () => {
    let callCount = 0;
    const deps: IdentityDeps = {
      settingsPath: "/tmp/test.json",
      readJson: () => {
        callCount++;
        return { ok: true as const, value: { daidentity: { name: "Cached" } } };
      },
      fileExists: () => true,
    };

    getIdentity(deps);
    getIdentity(deps);
    expect(callCount).toBe(1);
  });

  it("respects clearCache", () => {
    let callCount = 0;
    const deps: IdentityDeps = {
      settingsPath: "/tmp/test.json",
      readJson: () => {
        callCount++;
        return { ok: true as const, value: { daidentity: { name: "Fresh" } } };
      },
      fileExists: () => true,
    };

    getIdentity(deps);
    clearCache();
    getIdentity(deps);
    expect(callCount).toBe(2);
  });
});

describe("getPrincipal", () => {
  beforeEach(() => clearCache());

  it("returns defaults when no principal in settings", () => {
    const principal = getPrincipal(emptyDeps());
    expect(principal.name).toBe("User");
    expect(principal.pronunciation).toBe("");
    expect(principal.timezone).toBe("UTC");
  });

  it("reads principal fields from settings", () => {
    const deps = makeDeps({
      principal: {
        name: "Ian",
        pronunciation: "ee-an",
        timezone: "Australia/Melbourne",
      },
    });
    const principal = getPrincipal(deps);
    expect(principal.name).toBe("Ian");
    expect(principal.pronunciation).toBe("ee-an");
    expect(principal.timezone).toBe("Australia/Melbourne");
  });
});

describe("convenience functions", () => {
  beforeEach(() => clearCache());

  it("getDAName returns the DA name", () => {
    const deps = makeDeps({ daidentity: { name: "TestDA" } });
    expect(getDAName(deps)).toBe("TestDA");
  });

  it("getPrincipalName returns the principal name", () => {
    const deps = makeDeps({ principal: { name: "TestUser" } });
    expect(getPrincipalName(deps)).toBe("TestUser");
  });

  it("getVoiceId returns the voice ID", () => {
    const deps = makeDeps({
      daidentity: {
        voices: { main: { voiceId: "v-1" } },
      },
    });
    expect(getVoiceId(deps)).toBe("v-1");
  });

  it("getVoiceProsody returns prosody settings", () => {
    const prosody: VoiceProsody = {
      stability: 0.5,
      similarity_boost: 0.8,
      style: 0.3,
      speed: 1.0,
      use_speaker_boost: false,
    };
    const deps = makeDeps({
      daidentity: {
        voices: { main: { voiceId: "v-1", ...prosody } },
      },
    });
    const result = getVoiceProsody(deps);
    expect(result).toBeDefined();
    expect(result?.stability).toBe(0.5);
  });

  it("getVoicePersonality returns personality settings", () => {
    const personality: VoicePersonality = {
      baseVoice: "calm",
      enthusiasm: 0.5,
      energy: 0.5,
      expressiveness: 0.5,
      resilience: 0.5,
      composure: 0.5,
      optimism: 0.5,
      warmth: 0.5,
      formality: 0.5,
      directness: 0.5,
      precision: 0.5,
      curiosity: 0.5,
      playfulness: 0.5,
    };
    const deps = makeDeps({ daidentity: { personality } });
    const result = getVoicePersonality(deps);
    expect(result).toBeDefined();
    expect(result?.baseVoice).toBe("calm");
  });
});

describe("static defaults", () => {
  it("getDefaultIdentity returns a copy of default identity", () => {
    const a = getDefaultIdentity();
    const b = getDefaultIdentity();
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different object references
    expect(a.name).toBe("PAI");
  });

  it("getDefaultPrincipal returns a copy of default principal", () => {
    const a = getDefaultPrincipal();
    const b = getDefaultPrincipal();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.name).toBe("User");
  });
});
