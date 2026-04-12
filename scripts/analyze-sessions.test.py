#!/usr/bin/env python3
"""Tests for analyze-sessions.py"""

import csv
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone, timedelta

# Import the module under test
import importlib.util
spec = importlib.util.spec_from_file_location(
    "analyze_sessions",
    os.path.join(os.path.dirname(__file__), "analyze-sessions.py"),
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

parse_timestamp = mod.parse_timestamp
get_text_from_content = mod.get_text_from_content
get_thinking_from_content = mod.get_thinking_from_content
count_tool_uses = mod.count_tool_uses
count_pattern_matches = mod.count_pattern_matches
analyze_session = mod.analyze_session
CORRECTION_PATTERNS = mod.CORRECTION_PATTERNS
FRUSTRATION_PATTERNS = mod.FRUSTRATION_PATTERNS


class TestParseTimestamp(unittest.TestCase):
    def test_unix_ms(self):
        dt = parse_timestamp(1712000000000)
        self.assertIsNotNone(dt)
        self.assertEqual(dt.tzinfo, timezone.utc)

    def test_iso_with_z(self):
        dt = parse_timestamp("2026-04-12T04:00:00.000Z")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2026)
        self.assertEqual(dt.month, 4)
        self.assertEqual(dt.hour, 4)

    def test_iso_with_offset(self):
        dt = parse_timestamp("2026-04-12T14:00:00+10:00")
        self.assertIsNotNone(dt)

    def test_none_input(self):
        self.assertIsNone(parse_timestamp(None))

    def test_invalid_string(self):
        self.assertIsNone(parse_timestamp("not-a-date"))


class TestGetTextFromContent(unittest.TestCase):
    def test_string_content(self):
        self.assertEqual(get_text_from_content("hello"), "hello")

    def test_block_list(self):
        blocks = [
            {"type": "text", "text": "line one"},
            {"type": "thinking", "text": "internal"},
            {"type": "text", "text": "line two"},
        ]
        result = get_text_from_content(blocks)
        self.assertIn("line one", result)
        self.assertIn("line two", result)
        self.assertNotIn("internal", result)

    def test_empty_list(self):
        self.assertEqual(get_text_from_content([]), "")

    def test_non_text_blocks(self):
        blocks = [{"type": "tool_use", "name": "Bash"}]
        self.assertEqual(get_text_from_content(blocks), "")


class TestGetThinkingFromContent(unittest.TestCase):
    def test_extracts_thinking(self):
        blocks = [
            {"type": "text", "text": "visible"},
            {"type": "thinking", "text": "hidden thought"},
        ]
        result = get_thinking_from_content(blocks)
        self.assertIn("hidden thought", result)
        self.assertNotIn("visible", result)

    def test_no_thinking(self):
        blocks = [{"type": "text", "text": "visible"}]
        self.assertEqual(get_thinking_from_content(blocks), "")

    def test_string_input(self):
        self.assertEqual(get_thinking_from_content("not a list"), "")


class TestCountToolUses(unittest.TestCase):
    def test_counts_tools(self):
        blocks = [
            {"type": "tool_use", "name": "Bash"},
            {"type": "text", "text": "result"},
            {"type": "tool_use", "name": "Read"},
        ]
        count, names = count_tool_uses(blocks)
        self.assertEqual(count, 2)
        self.assertIn("Bash", names)
        self.assertIn("Read", names)

    def test_no_tools(self):
        blocks = [{"type": "text", "text": "hello"}]
        count, names = count_tool_uses(blocks)
        self.assertEqual(count, 0)
        self.assertEqual(names, [])

    def test_string_input(self):
        count, names = count_tool_uses("not a list")
        self.assertEqual(count, 0)


class TestPatternMatching(unittest.TestCase):
    def test_correction_no(self):
        self.assertGreater(count_pattern_matches("no, that's wrong", CORRECTION_PATTERNS), 0)

    def test_correction_i_said(self):
        self.assertGreater(count_pattern_matches("I said do X not Y", CORRECTION_PATTERNS), 0)

    def test_correction_already(self):
        self.assertGreater(count_pattern_matches("I already told you", CORRECTION_PATTERNS), 0)

    def test_frustration_caps(self):
        self.assertGreater(count_pattern_matches("WHY ARE YOU DOING THIS", FRUSTRATION_PATTERNS), 0)

    def test_frustration_wtf(self):
        self.assertGreater(count_pattern_matches("wtf is this", FRUSTRATION_PATTERNS), 0)

    def test_frustration_multiple_question_marks(self):
        self.assertGreater(count_pattern_matches("what??", FRUSTRATION_PATTERNS), 0)

    def test_frustration_multiple_exclamation(self):
        self.assertGreater(count_pattern_matches("stop!!", FRUSTRATION_PATTERNS), 0)

    def test_no_false_positive_normal(self):
        self.assertEqual(count_pattern_matches("please read the file", FRUSTRATION_PATTERNS), 0)

    def test_no_false_positive_short(self):
        # "ok" should not trigger correction
        self.assertEqual(count_pattern_matches("ok", CORRECTION_PATTERNS), 0)


class TestAnalyzeSession(unittest.TestCase):
    def _make_session_file(self, entries):
        """Write entries to a temp JSONL file and return path."""
        f = tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False)
        for entry in entries:
            f.write(json.dumps(entry) + "\n")
        f.close()
        return f.name

    def _make_basic_session(self, start_utc="2026-04-12T04:00:00.000Z", user_text="do something", n_turns=3):
        """Create a minimal valid session with user and assistant entries."""
        base_ts = datetime.fromisoformat(start_utc.replace("Z", "+00:00"))
        entries = []

        for i in range(n_turns):
            offset = timedelta(minutes=i * 2)
            user_ts = (base_ts + offset).isoformat()
            asst_ts = (base_ts + offset + timedelta(seconds=30)).isoformat()

            entries.append({
                "type": "user",
                "message": {"role": "user", "content": user_text},
                "timestamp": user_ts,
                "uuid": f"u-{i}",
                "parentUuid": f"a-{i-1}" if i > 0 else None,
                "isSidechain": False,
            })
            entries.append({
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "model": "claude-opus-4-6",
                    "content": [{"type": "text", "text": f"Response number {i} with some content here."}],
                    "usage": {
                        "input_tokens": 1000 + i * 100,
                        "output_tokens": 500 + i * 50,
                        "cache_read_input_tokens": 800,
                        "cache_creation_input_tokens": 200,
                        "service_tier": "standard",
                        "inference_geo": "",
                        "speed": "standard",
                    },
                    "stop_reason": "end_turn",
                },
                "timestamp": asst_ts,
                "uuid": f"a-{i}",
                "parentUuid": f"u-{i}",
                "isSidechain": False,
            })

        return entries

    def test_basic_session(self):
        entries = self._make_basic_session()
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertIsNotNone(result)
            self.assertEqual(result["user_messages"], 3)
            self.assertEqual(result["assistant_turns"], 3)
            self.assertGreater(result["total_input_tokens"], 0)
            self.assertGreater(result["total_output_tokens"], 0)
            self.assertEqual(result["primary_model"], "claude-opus-4-6")
            # 04:00 UTC = 14:00 AEST
            self.assertEqual(result["hour_local"], 14)
        finally:
            os.unlink(path)

    def test_short_session_flag(self):
        entries = self._make_basic_session(n_turns=1)
        # Single turn = ~30 seconds
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertEqual(result["is_short_session"], 1)
        finally:
            os.unlink(path)

    def test_frustration_detection(self):
        entries = self._make_basic_session(user_text="WHY ARE YOU DOING THIS?? wtf")
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertGreater(result["frustration_signals"], 0)
        finally:
            os.unlink(path)

    def test_correction_detection(self):
        entries = self._make_basic_session(user_text="no, I said do it the other way")
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertGreater(result["correction_signals"], 0)
        finally:
            os.unlink(path)

    def test_token_aggregation(self):
        entries = self._make_basic_session(n_turns=2)
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            # 2 turns: (1000+100) + (1000+200) = 2300 input
            self.assertEqual(result["total_input_tokens"], 1000 + 1100)
            # 2 turns: (500+50) + (500+100) = 1050 output -- wait, 500+0*50=500, 500+1*50=550
            self.assertEqual(result["total_output_tokens"], 500 + 550)
        finally:
            os.unlink(path)

    def test_empty_file(self):
        path = self._make_session_file([])
        try:
            result = analyze_session(path)
            self.assertIsNone(result)
        finally:
            os.unlink(path)

    def test_tool_use_counting(self):
        base_ts = "2026-04-12T04:00:00.000Z"
        entries = [
            {
                "type": "user",
                "message": {"role": "user", "content": "read the file"},
                "timestamp": base_ts,
                "uuid": "u-0",
                "isSidechain": False,
            },
            {
                "type": "assistant",
                "message": {
                    "role": "assistant",
                    "model": "claude-opus-4-6",
                    "content": [
                        {"type": "tool_use", "name": "Read", "input": {"file_path": "/tmp/x"}},
                        {"type": "tool_use", "name": "Bash", "input": {"command": "ls"}},
                    ],
                    "usage": {"input_tokens": 100, "output_tokens": 50,
                              "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0},
                    "stop_reason": "tool_use",
                },
                "timestamp": "2026-04-12T04:00:30.000Z",
                "uuid": "a-0",
                "isSidechain": False,
            },
        ]
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertEqual(result["tool_uses"], 2)
            self.assertEqual(result["unique_tools_used"], 2)
            self.assertIn("Bash", result["tool_names"])
            self.assertIn("Read", result["tool_names"])
            self.assertEqual(result["tool_use_stop_count"], 1)
        finally:
            os.unlink(path)

    def test_timezone_conversion(self):
        # 08:00 UTC should be 18:00 AEST
        entries = self._make_basic_session(start_utc="2026-04-12T08:00:00.000Z", n_turns=1)
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertEqual(result["hour_local"], 18)
        finally:
            os.unlink(path)

    def test_system_context_filtered(self):
        """System-injected CONTEXT: messages should not count as user messages."""
        entries = self._make_basic_session(user_text="CONTEXT:\nSome injected context here")
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertEqual(result["user_messages"], 0)
        finally:
            os.unlink(path)

    def test_csv_output_roundtrip(self):
        """Verify the full pipeline produces valid CSV."""
        entries = self._make_basic_session(n_turns=2)
        path = self._make_session_file(entries)
        try:
            result = analyze_session(path)
            self.assertIsNotNone(result)

            # Write to CSV and read back
            csv_path = path + ".csv"
            fieldnames = list(result.keys())
            with open(csv_path, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                writer.writeheader()
                writer.writerow(result)

            with open(csv_path) as f:
                reader = csv.DictReader(f)
                rows = list(reader)

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["primary_model"], "claude-opus-4-6")
            self.assertEqual(int(rows[0]["user_messages"]), 2)
            os.unlink(csv_path)
        finally:
            os.unlink(path)


if __name__ == "__main__":
    unittest.main()
