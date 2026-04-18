/**
 * Unit tests for time utility functions.
 *
 * Uses default UTC timezone for deterministic results.
 */
import { describe, expect, it } from "bun:test";

import {
  getFilenameTimestamp,
  getISOTimestamp,
  getLocalComponents,
  getLocalDate,
  getLocalTimestamp,
  getTimezoneDisplay,
  getYearMonth,
} from "@hooks/lib/time";

// ─── getLocalTimestamp ────────────────────────────────────────────────────────

describe("getLocalTimestamp", () => {
  it("matches YYYY-MM-DD HH:MM:SS TZ format", () => {
    const result = getLocalTimestamp();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+$/);
  });

  it("contains valid month (01-12)", () => {
    const result = getLocalTimestamp();
    const month = parseInt(result.substring(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("contains valid day (01-31)", () => {
    const result = getLocalTimestamp();
    const day = parseInt(result.substring(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("contains valid hours (00-23)", () => {
    const result = getLocalTimestamp();
    const hours = parseInt(result.substring(11, 13), 10);
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThanOrEqual(23);
  });

  it("contains valid minutes (00-59)", () => {
    const result = getLocalTimestamp();
    const minutes = parseInt(result.substring(14, 16), 10);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(59);
  });

  it("contains valid seconds (00-59)", () => {
    const result = getLocalTimestamp();
    const seconds = parseInt(result.substring(17, 19), 10);
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThanOrEqual(59);
  });

  it("ends with a timezone abbreviation", () => {
    const result = getLocalTimestamp();
    const parts = result.split(" ");
    expect(parts.length).toBe(3);
    expect(parts[2].length).toBeGreaterThan(0);
  });
});

// ─── getLocalDate ────────────────────────────────────────────────────────────

describe("getLocalDate", () => {
  it("matches YYYY-MM-DD format", () => {
    const result = getLocalDate();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has exactly 10 characters", () => {
    const result = getLocalDate();
    expect(result.length).toBe(10);
  });

  it("contains valid month (01-12)", () => {
    const result = getLocalDate();
    const month = parseInt(result.substring(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("contains valid day (01-31)", () => {
    const result = getLocalDate();
    const day = parseInt(result.substring(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("year is a reasonable value", () => {
    const result = getLocalDate();
    const year = parseInt(result.substring(0, 4), 10);
    expect(year).toBeGreaterThanOrEqual(2020);
    expect(year).toBeLessThanOrEqual(2100);
  });
});

// ─── getYearMonth ────────────────────────────────────────────────────────────

describe("getYearMonth", () => {
  it("matches YYYY-MM format", () => {
    const result = getYearMonth();
    expect(result).toMatch(/^\d{4}-\d{2}$/);
  });

  it("has exactly 7 characters", () => {
    const result = getYearMonth();
    expect(result.length).toBe(7);
  });

  it("equals the first 7 chars of getLocalDate", () => {
    const yearMonth = getYearMonth();
    const localDate = getLocalDate();
    expect(yearMonth).toBe(localDate.substring(0, 7));
  });

  it("contains valid month (01-12)", () => {
    const result = getYearMonth();
    const month = parseInt(result.substring(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });
});

// ─── getISOTimestamp ─────────────────────────────────────────────────────────

describe("getISOTimestamp", () => {
  it("matches ISO8601 format with timezone offset", () => {
    const result = getISOTimestamp();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  });

  it("contains a T separator between date and time", () => {
    const result = getISOTimestamp();
    expect(result).toContain("T");
  });

  it("includes a timezone offset like +HH:MM or -HH:MM", () => {
    const result = getISOTimestamp();
    const offsetMatch = result.match(/([+-]\d{2}:\d{2})$/);
    expect(offsetMatch).not.toBeNull();
  });

  it("has a valid offset sign (+ or -)", () => {
    const result = getISOTimestamp();
    const offsetSign = result.charAt(result.length - 6);
    expect(["+", "-"]).toContain(offsetSign);
  });

  it("has valid offset hours (00-14)", () => {
    const result = getISOTimestamp();
    const offsetHours = parseInt(result.substring(result.length - 5, result.length - 3), 10);
    expect(offsetHours).toBeGreaterThanOrEqual(0);
    expect(offsetHours).toBeLessThanOrEqual(14);
  });

  it("has valid offset minutes (00-59)", () => {
    const result = getISOTimestamp();
    const offsetMins = parseInt(result.substring(result.length - 2), 10);
    expect(offsetMins).toBeGreaterThanOrEqual(0);
    expect(offsetMins).toBeLessThanOrEqual(59);
  });

  it("contains valid month in the date portion", () => {
    const result = getISOTimestamp();
    const month = parseInt(result.substring(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("contains valid day in the date portion", () => {
    const result = getISOTimestamp();
    const day = parseInt(result.substring(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });
});

// ─── getFilenameTimestamp ────────────────────────────────────────────────────

describe("getFilenameTimestamp", () => {
  it("matches YYYY-MM-DD-HHMMSS format", () => {
    const result = getFilenameTimestamp();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });

  it("contains no spaces", () => {
    const result = getFilenameTimestamp();
    expect(result).not.toContain(" ");
  });

  it("contains no colons", () => {
    const result = getFilenameTimestamp();
    expect(result).not.toContain(":");
  });

  it("is safe for use as a filename", () => {
    const result = getFilenameTimestamp();
    // Should only contain digits and hyphens
    expect(result).toMatch(/^[\d-]+$/);
  });

  it("contains valid month (01-12)", () => {
    const result = getFilenameTimestamp();
    const month = parseInt(result.substring(5, 7), 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("contains valid day (01-31)", () => {
    const result = getFilenameTimestamp();
    const day = parseInt(result.substring(8, 10), 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("has exactly 17 characters", () => {
    const result = getFilenameTimestamp();
    expect(result.length).toBe(17);
  });
});

// ─── getLocalComponents ──────────────────────────────────────────────────────

describe("getLocalComponents", () => {
  it("returns an object", () => {
    const result = getLocalComponents();
    expect(typeof result).toBe("object");
    expect(result).not.toBeNull();
  });

  it("has all expected keys", () => {
    const result = getLocalComponents();
    expect(result).toHaveProperty("year");
    expect(result).toHaveProperty("month");
    expect(result).toHaveProperty("day");
    expect(result).toHaveProperty("hours");
    expect(result).toHaveProperty("minutes");
    expect(result).toHaveProperty("seconds");
  });

  it("year is a number", () => {
    const result = getLocalComponents();
    expect(typeof result.year).toBe("number");
  });

  it("year is a reasonable value", () => {
    const result = getLocalComponents();
    expect(result.year).toBeGreaterThanOrEqual(2020);
    expect(result.year).toBeLessThanOrEqual(2100);
  });

  it("month is a zero-padded string (01-12)", () => {
    const result = getLocalComponents();
    expect(typeof result.month).toBe("string");
    expect(result.month).toMatch(/^\d{2}$/);
    const month = parseInt(result.month, 10);
    expect(month).toBeGreaterThanOrEqual(1);
    expect(month).toBeLessThanOrEqual(12);
  });

  it("day is a zero-padded string (01-31)", () => {
    const result = getLocalComponents();
    expect(typeof result.day).toBe("string");
    expect(result.day).toMatch(/^\d{2}$/);
    const day = parseInt(result.day, 10);
    expect(day).toBeGreaterThanOrEqual(1);
    expect(day).toBeLessThanOrEqual(31);
  });

  it("hours is a zero-padded string (00-23)", () => {
    const result = getLocalComponents();
    expect(typeof result.hours).toBe("string");
    expect(result.hours).toMatch(/^\d{2}$/);
    const hours = parseInt(result.hours, 10);
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(hours).toBeLessThanOrEqual(23);
  });

  it("minutes is a zero-padded string (00-59)", () => {
    const result = getLocalComponents();
    expect(typeof result.minutes).toBe("string");
    expect(result.minutes).toMatch(/^\d{2}$/);
    const minutes = parseInt(result.minutes, 10);
    expect(minutes).toBeGreaterThanOrEqual(0);
    expect(minutes).toBeLessThanOrEqual(59);
  });

  it("seconds is a zero-padded string (00-59)", () => {
    const result = getLocalComponents();
    expect(typeof result.seconds).toBe("string");
    expect(result.seconds).toMatch(/^\d{2}$/);
    const seconds = parseInt(result.seconds, 10);
    expect(seconds).toBeGreaterThanOrEqual(0);
    expect(seconds).toBeLessThanOrEqual(59);
  });

  it("components are consistent with getLocalDate", () => {
    const components = getLocalComponents();
    const localDate = getLocalDate();
    const expectedDate = `${components.year}-${components.month}-${components.day}`;
    expect(expectedDate).toBe(localDate);
  });
});

// ─── getTimezoneDisplay ──────────────────────────────────────────────────────

describe("getTimezoneDisplay", () => {
  it("returns a short timezone name (1-10 chars)", () => {
    const result = getTimezoneDisplay();
    // Short tz names are typically 2-5 chars (e.g., UTC, EST, PDT, CST)
    // or slightly longer like "GMT+8"
    expect(result.length).toBeGreaterThan(0);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("contains no spaces", () => {
    const result = getTimezoneDisplay();
    expect(result).not.toContain(" ");
  });

  it("matches the timezone suffix in getLocalTimestamp", () => {
    const timestamp = getLocalTimestamp();
    const display = getTimezoneDisplay();
    const timestampTz = timestamp.split(" ").pop();
    expect(timestampTz).toBe(display);
  });
});

// ─── Cross-function consistency ──────────────────────────────────────────────

describe("cross-function consistency", () => {
  it("getLocalDate date matches the date portion of getLocalTimestamp", () => {
    const localDate = getLocalDate();
    const localTimestamp = getLocalTimestamp();
    expect(localTimestamp.startsWith(localDate)).toBe(true);
  });

  it("getFilenameTimestamp date matches getLocalDate", () => {
    const localDate = getLocalDate();
    const filenameTs = getFilenameTimestamp();
    // First 10 chars of filename timestamp should be YYYY-MM-DD
    expect(filenameTs.substring(0, 10)).toBe(localDate);
  });

  it("getISOTimestamp date matches getLocalDate", () => {
    const localDate = getLocalDate();
    const isoTs = getISOTimestamp();
    expect(isoTs.substring(0, 10)).toBe(localDate);
  });

  it("all functions return without throwing", () => {
    expect(() => getLocalTimestamp()).not.toThrow();
    expect(() => getLocalDate()).not.toThrow();
    expect(() => getYearMonth()).not.toThrow();
    expect(() => getISOTimestamp()).not.toThrow();
    expect(() => getFilenameTimestamp()).not.toThrow();
    expect(() => getLocalComponents()).not.toThrow();
    expect(() => getTimezoneDisplay()).not.toThrow();
  });
});
