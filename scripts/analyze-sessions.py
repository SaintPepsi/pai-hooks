#!/usr/bin/env python3
"""
Session quality analyzer for Claude Code JSONL history files.

Parses all session JSONL files and outputs per-session metrics as CSV,
designed to surface time-of-day quality degradation patterns.

HYPOTHESIS: Claude quality degrades after 2pm AEST (04:00 UTC).
This script collects evidence to support or refute that claim.

Usage:
    python3 scripts/analyze-sessions.py [--project-dir DIR] [--output FILE] [--all-projects]

Key degradation metrics (new):
    - thinking_depth_ratio: thinking_length / output_length (lower = shallower reasoning)
    - empty_responses: assistant turns with <50 chars text
    - abandoned_frustrated: session ended frustrated (short + signals)
    - tool_success_rate: tool_results / tool_uses (lower = more failures)
    - tool_loops: repeated identical tool calls (model spinning)
    - consecutive_corrections: correction signals back-to-back
    - is_after_2pm: binary flag for the critical threshold

Output columns:
    session_id, project, start_utc, start_local, end_utc, end_local,
    tz_offset, hour_local, day_of_week, duration_min, is_after_2pm,
    user_messages, assistant_turns, tool_uses, tool_results,
    total_input_tokens, total_output_tokens, total_cache_read_tokens,
    total_cache_creation_tokens, avg_input_per_turn, avg_output_per_turn,
    cache_hit_rate, models_used, primary_model, service_tiers,
    inference_geos, speed_modes,
    avg_user_msg_length, median_user_msg_length, avg_assistant_text_length,
    median_assistant_text_length, avg_thinking_length, thinking_depth_ratio,
    empty_responses, abandoned_frustrated, tool_success_rate, tool_loops,
    short_user_msgs, correction_signals, frustration_signals,
    consecutive_corrections, question_marks_from_user, exclamation_marks_from_user,
    user_msgs_under_10_chars, user_msgs_under_30_chars,
    stop_reasons, end_turn_count, tool_use_stop_count, max_tokens_count,
    unique_tools_used, tool_names, advisor_calls,
    system_events, compact_boundaries, hook_errors,
    session_entries_total, turns_per_minute, tokens_per_minute,
    output_tokens_per_user_msg, is_short_session, is_fragmented
"""

import argparse
import csv
import glob
import hashlib
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Frustration/correction signal patterns
CORRECTION_PATTERNS = [
    r"\bno[,.\s!]",
    r"\bnot that\b",
    r"\bwrong\b",
    r"\bi said\b",
    r"\bi already\b",
    r"\balready told\b",
    r"\bthat's not\b",
    r"\bthat is not\b",
    r"\bdon't\b.*\bthat\b",
    r"\bstop\b",
    r"\bundo\b",
    r"\brevert\b",
    r"\bactually\b",
    r"\binstead\b",
    r"\bforget\b",
    r"\bignor",
]

FRUSTRATION_PATTERNS = [
    r"\bwtf\b",
    r"\bwhat the\b",
    r"\bfuck\b",
    r"\bfucking\b",
    r"\bffs\b",
    r"\bseriously\b",
    r"\bfor god'?s sake\b",
    r"\bjesus\b",
    r"\bchrist\b",
    r"\bcome on\b",
    r"\bhow (many|hard|difficult)\b",
    r"\byou (just|literally|completely)\b",
    r"\bI (just|literally) (said|told|asked)\b",
    r"\bagain\b.*\?",
    r"\bhuh\b\??",
    r"\bare you (even|serious|kidding)\b",
    r"\bwhy (are|did|would) you\b",
    r"\bconfused\b",
    r"\bfrustrat",
    r"\banxi",
    r"\bexhaust",
    r"\bunbearable\b",
    r"\bdumb\b",
    r"\bstupid\b",
    r"\buseless\b",
    r"\bhopeless\b",
    r"\bridiculous\b",
    r"\binsane\b",
    r"\bbroken\b",
    r"\bgarbage\b",
    r"\btrash\b",
    r"\bshit\b",
    r"\bdamn\b",
    r"\bcrap\b",
    r"\bugh\b",
    r"\bomg\b",
    r"\bjfc\b",
    r"[\?]{2,}",
    r"[!]{2,}",
    r"[A-Z]{5,}",  # ALL CAPS words (5+ chars)
]


def parse_timestamp(ts):
    """Parse ISO timestamp or Unix ms to datetime."""
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc)
    if isinstance(ts, str):
        # ISO format: 2026-03-24T22:16:26.731Z
        ts = ts.replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(ts)
        except ValueError:
            return None
    return None


def get_text_from_content(content):
    """Extract text from message content (string or block list)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    texts.append(block.get("text", ""))
        return "\n".join(texts)
    return ""


def get_thinking_from_content(content):
    """Extract thinking text from content blocks."""
    if not isinstance(content, list):
        return ""
    texts = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "thinking":
            # Thinking content can be in 'thinking' or 'text' field
            thinking_text = block.get("thinking", "") or block.get("text", "")
            if thinking_text:
                texts.append(thinking_text)
    return "\n".join(texts)


def count_tool_uses(content):
    """Count tool_use blocks in content."""
    if not isinstance(content, list):
        return 0, []
    count = 0
    names = []
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            count += 1
            names.append(block.get("name", "unknown"))
    return count, names


def count_pattern_matches(text, patterns):
    """Count how many patterns match in text."""
    if not text:
        return 0
    text_lower = text.lower()
    count = 0
    for pattern in patterns:
        if re.search(pattern, text_lower):
            count += 1
    return count


def analyze_session(filepath, is_subagent=False):
    """Analyze a single session JSONL file and return metrics dict."""
    session_id = Path(filepath).stem
    entries = []

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not entries:
        return None

    # Collect timestamps from all entries
    timestamps = []
    for e in entries:
        ts = e.get("timestamp")
        if ts:
            dt = parse_timestamp(ts)
            if dt:
                timestamps.append(dt)

    if not timestamps:
        return None

    timestamps.sort()
    start_utc = timestamps[0]
    end_utc = timestamps[-1]
    duration_min = (end_utc - start_utc).total_seconds() / 60

    # Detect timezone from entry metadata or default to AEST
    tz_offset = 10  # default AEST
    for e in entries:
        if e.get("type") == "user":
            # Check git branch timestamps for local tz hint
            ts_str = str(e.get("timestamp", ""))
            break

    local_tz = timezone(timedelta(hours=tz_offset))
    start_local = start_utc.astimezone(local_tz)
    end_local = end_utc.astimezone(local_tz)

    # Initialize metrics
    # Critical threshold: 2pm AEST (14:00 local time)
    is_after_2pm = 1 if start_local.hour >= 14 else 0

    metrics = {
        "session_id": session_id,
        "start_utc": start_utc.isoformat(),
        "start_local": start_local.strftime("%Y-%m-%d %H:%M:%S"),
        "end_utc": end_utc.isoformat(),
        "end_local": end_local.strftime("%Y-%m-%d %H:%M:%S"),
        "tz_offset": f"+{tz_offset:02d}:00",
        "hour_local": start_local.hour,
        "day_of_week": start_local.strftime("%A"),
        "duration_min": round(duration_min, 1),
        "is_after_2pm": is_after_2pm,
        "is_subagent": 1 if is_subagent else 0,
    }

    # Message counts and content analysis
    user_messages = []
    assistant_turns = []
    tool_use_count = 0
    tool_result_count = 0
    all_tool_names = []
    advisor_calls = 0

    # Token tracking
    total_input = 0
    total_output = 0
    total_cache_read = 0
    total_cache_creation = 0

    # Model/service tracking
    models = Counter()
    service_tiers = set()
    inference_geos = set()
    speed_modes = set()
    stop_reasons = Counter()

    # System events
    system_events = 0
    compact_boundaries = 0
    hook_errors = 0

    # User message analysis
    user_msg_lengths = []
    user_correction_signals = 0
    user_frustration_signals = 0
    user_question_marks = 0
    user_exclamation_marks = 0
    user_msgs_under_10 = 0
    user_msgs_under_30 = 0

    # Assistant response analysis
    assistant_text_lengths = []
    assistant_thinking_lengths = []
    empty_responses = 0

    # Tool loop detection
    recent_tool_calls = []  # Track last N tool calls for loop detection
    tool_loops = 0

    # Track correction sequences
    correction_positions = []  # Turn numbers where corrections occurred
    turn_number = 0

    for entry in entries:
        turn_number += 1
        etype = entry.get("type")

        if etype == "user":
            msg = entry.get("message", {})
            if entry.get("toolUseResult"):
                tool_result_count += 1
                continue  # Don't count tool results as user messages

            if isinstance(msg, dict):
                content = msg.get("content", "")
                text = get_text_from_content(content)
            elif isinstance(msg, str):
                text = msg
            else:
                continue

            if not text:
                continue

            # Skip system-injected context
            if text.startswith("CONTEXT:") or text.startswith("<system-reminder>"):
                continue

            user_messages.append(text)
            text_len = len(text)
            user_msg_lengths.append(text_len)

            if text_len < 10:
                user_msgs_under_10 += 1
            if text_len < 30:
                user_msgs_under_30 += 1

            corrections_this_msg = count_pattern_matches(text, CORRECTION_PATTERNS)
            user_correction_signals += corrections_this_msg
            if corrections_this_msg > 0:
                correction_positions.append(turn_number)
            user_frustration_signals += count_pattern_matches(text, FRUSTRATION_PATTERNS)
            user_question_marks += text.count("?")
            user_exclamation_marks += text.count("!")

        elif etype in ("assistant", "A"):
            msg = entry.get("message", {})
            if not isinstance(msg, dict):
                continue

            # Model and usage
            model = msg.get("model", "unknown")
            models[model] += 1

            usage = msg.get("usage", {})
            total_input += usage.get("input_tokens", 0)
            total_output += usage.get("output_tokens", 0)
            total_cache_read += usage.get("cache_read_input_tokens", 0)
            total_cache_creation += usage.get("cache_creation_input_tokens", 0)

            tier = usage.get("service_tier", "")
            if tier:
                service_tiers.add(tier)
            geo = usage.get("inference_geo", "")
            if geo:
                inference_geos.add(geo)
            speed = usage.get("speed", "")
            if speed:
                speed_modes.add(speed)

            # Stop reason
            stop = msg.get("stop_reason", "")
            if stop:
                stop_reasons[stop] += 1

            # Content analysis
            content = msg.get("content", [])
            text = get_text_from_content(content)
            thinking = get_thinking_from_content(content)
            tools, tool_names = count_tool_uses(content)

            if text:
                text_len = len(text)
                assistant_text_lengths.append(text_len)
                if text_len < 50:
                    empty_responses += 1
            else:
                empty_responses += 1
            if thinking:
                assistant_thinking_lengths.append(len(thinking))

            tool_use_count += tools
            all_tool_names.extend(tool_names)

            # Tool loop detection: same tool called 3+ times in last 5 calls
            for tn in tool_names:
                recent_tool_calls.append(tn)
                if len(recent_tool_calls) > 5:
                    recent_tool_calls.pop(0)
                # Check for loops (same tool 3+ times in window)
                if recent_tool_calls.count(tn) >= 3:
                    tool_loops += 1
                    recent_tool_calls.clear()  # Reset after detecting loop

            # Check for advisor tool use
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        if block.get("type") == "tool_use" and block.get("name") == "advisor":
                            advisor_calls += 1
                        if block.get("type") == "advisor_tool_result":
                            advisor_calls += 1

            assistant_turns.append(entry)

        elif etype == "system":
            system_events += 1
            subtype = entry.get("subtype", "")
            if subtype == "compact_boundary":
                compact_boundaries += 1
            errors = entry.get("hookErrors", [])
            if errors:
                hook_errors += len(errors)

    # Compute derived metrics
    n_user = len(user_messages)
    n_assistant = len(assistant_turns)
    total_tokens = total_input + total_output

    # Thinking depth ratio: how much thinking per output char
    avg_thinking = statistics.mean(assistant_thinking_lengths) if assistant_thinking_lengths else 0
    avg_text = statistics.mean(assistant_text_lengths) if assistant_text_lengths else 0
    thinking_depth_ratio = round(avg_thinking / max(avg_text, 1), 2)

    # Tool success rate
    tool_success_rate = round(tool_result_count / max(tool_use_count, 1) * 100, 1)

    # Consecutive corrections: corrections within 3 turns of each other
    consecutive_corrections = 0
    for i in range(1, len(correction_positions)):
        if correction_positions[i] - correction_positions[i - 1] <= 3:
            consecutive_corrections += 1

    # Abandoned frustrated: short session with frustration signals
    abandoned_frustrated = 1 if (
        duration_min < 5 and user_frustration_signals > 0
    ) or (
        duration_min < 10 and user_frustration_signals >= 2
    ) else 0

    metrics.update({
        "user_messages": n_user,
        "assistant_turns": n_assistant,
        "tool_uses": tool_use_count,
        "tool_results": tool_result_count,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_cache_read_tokens": total_cache_read,
        "total_cache_creation_tokens": total_cache_creation,
        "avg_input_per_turn": round(total_input / n_assistant, 0) if n_assistant else 0,
        "avg_output_per_turn": round(total_output / n_assistant, 0) if n_assistant else 0,
        "cache_hit_rate": round(total_cache_read / (total_cache_read + total_cache_creation + 0.001) * 100, 1),
        "models_used": "|".join(f"{m}:{c}" for m, c in models.most_common()),
        "primary_model": models.most_common(1)[0][0] if models else "unknown",
        "service_tiers": "|".join(sorted(service_tiers)) or "unknown",
        "inference_geos": "|".join(sorted(inference_geos)) or "unknown",
        "speed_modes": "|".join(sorted(speed_modes)) or "unknown",
        "avg_user_msg_length": round(statistics.mean(user_msg_lengths), 0) if user_msg_lengths else 0,
        "median_user_msg_length": round(statistics.median(user_msg_lengths), 0) if user_msg_lengths else 0,
        "avg_assistant_text_length": round(statistics.mean(assistant_text_lengths), 0) if assistant_text_lengths else 0,
        "median_assistant_text_length": round(statistics.median(assistant_text_lengths), 0) if assistant_text_lengths else 0,
        "avg_thinking_length": round(statistics.mean(assistant_thinking_lengths), 0) if assistant_thinking_lengths else 0,
        "thinking_depth_ratio": thinking_depth_ratio,
        "empty_responses": empty_responses,
        "abandoned_frustrated": abandoned_frustrated,
        "tool_success_rate": tool_success_rate,
        "tool_loops": tool_loops,
        "short_user_msgs": user_msgs_under_10,
        "correction_signals": user_correction_signals,
        "frustration_signals": user_frustration_signals,
        "consecutive_corrections": consecutive_corrections,
        "question_marks_from_user": user_question_marks,
        "exclamation_marks_from_user": user_exclamation_marks,
        "user_msgs_under_10_chars": user_msgs_under_10,
        "user_msgs_under_30_chars": user_msgs_under_30,
        "stop_reasons": "|".join(f"{r}:{c}" for r, c in stop_reasons.most_common()),
        "end_turn_count": stop_reasons.get("end_turn", 0),
        "tool_use_stop_count": stop_reasons.get("tool_use", 0),
        "max_tokens_count": stop_reasons.get("max_tokens", 0),
        "unique_tools_used": len(set(all_tool_names)),
        "tool_names": "|".join(sorted(set(all_tool_names))),
        "advisor_calls": advisor_calls,
        "system_events": system_events,
        "compact_boundaries": compact_boundaries,
        "hook_errors": hook_errors,
        "session_entries_total": len(entries),
        "turns_per_minute": round(n_assistant / max(duration_min, 0.1), 2),
        "tokens_per_minute": round(total_tokens / max(duration_min, 0.1), 0),
        "output_tokens_per_user_msg": round(total_output / max(n_user, 1), 0),
        "is_short_session": 1 if duration_min < 10 else 0,
        "is_fragmented": 1 if (n_user > 0 and duration_min < 5) else 0,
    })

    return metrics


def find_session_files(base_dir, all_projects=False):
    """Find all session JSONL files.

    Returns list of (filepath, project, is_subagent) tuples.
    """
    files = []

    if all_projects:
        # Scan all project directories under the given base_dir
        # If base_dir contains project subdirs, scan them; otherwise treat it as a projects root
        projects_dir = base_dir
        if not any(f.endswith(".jsonl") for f in os.listdir(projects_dir) if os.path.isfile(os.path.join(projects_dir, f))):
            # Directory contains subdirectories (project dirs), not JSONL files directly
            for project in os.listdir(projects_dir):
                project_path = os.path.join(projects_dir, project)
                if os.path.isdir(project_path):
                    for f in glob.glob(os.path.join(project_path, "*.jsonl")):
                        files.append((f, project, False))
                    # Also check subagent directories
                    for session_dir in glob.glob(os.path.join(project_path, "*/subagents/")):
                        for f in glob.glob(os.path.join(session_dir, "*.jsonl")):
                            files.append((f, project, True))
        else:
            # base_dir itself contains JSONL files
            for f in glob.glob(os.path.join(projects_dir, "*.jsonl")):
                files.append((f, os.path.basename(projects_dir), False))
    else:
        # Scan specific project directory
        for f in glob.glob(os.path.join(base_dir, "*.jsonl")):
            files.append((f, os.path.basename(base_dir), False))
        # Also check session subdirectories with subagents
        for session_dir in glob.glob(os.path.join(base_dir, "*/subagents/")):
            for f in glob.glob(os.path.join(session_dir, "*.jsonl")):
                files.append((f, os.path.basename(base_dir), True))

    return files


def scrub_pii(value):
    """Remove PII from a string value — usernames, home paths, etc."""
    value = re.sub(r"/Users/[^/]+/", "/~/", value)
    value = re.sub(r"hogers|ian.hogers|SaintPepsi", "user", value, flags=re.IGNORECASE)
    return value


def anonymize_session_id(sid):
    """Hash session ID to preserve uniqueness without exposing it."""
    return hashlib.sha256(sid.encode()).hexdigest()[:12]


def clean_project_name(proj):
    """Remove user paths, keep only meaningful project name."""
    proj = re.sub(r"^-Users-[^-]+-", "", proj)
    proj = re.sub(r"^-private-[^-]+-", "", proj)
    proj = re.sub(r"Documents-repos-", "", proj)
    proj = re.sub(r"Projects-", "", proj)
    proj = re.sub(r"Downloads-", "", proj)
    proj = re.sub(r"-claude-", "claude-", proj)
    proj = re.sub(r"hogers|ian-hogers|SaintPepsi", "user", proj, flags=re.IGNORECASE)
    return proj


def scrub_row(row):
    """Strip PII from an entire result row."""
    row["session_id"] = anonymize_session_id(row["session_id"])
    row.pop("project", None)
    # Scrub any string field that might contain paths
    for key, value in row.items():
        if isinstance(value, str) and re.search(r"/Users/|hogers|SaintPepsi", value, re.IGNORECASE):
            row[key] = scrub_pii(value)
    return row


def main():
    parser = argparse.ArgumentParser(description="Analyze Claude Code session quality metrics")
    parser.add_argument(
        "--project-dir",
        action="append",
        dest="project_dirs",
        help="Path to project session directory (can be specified multiple times)",
    )
    parser.add_argument(
        "--output", "-o",
        default="session-analysis.csv",
        help="Output CSV file path",
    )
    parser.add_argument(
        "--all-projects",
        action="store_true",
        help="Analyze all projects, not just the specified one",
    )
    parser.add_argument(
        "--min-entries",
        type=int,
        default=3,
        help="Minimum entries for a session to be included (default: 3)",
    )
    parser.add_argument(
        "--no-scrub",
        action="store_true",
        help="Disable PII scrubbing (default: PII is scrubbed)",
    )
    args = parser.parse_args()

    if not args.project_dirs:
        args.project_dirs = [os.path.expanduser("~/.claude/projects/")]

    # Collect session files from all specified directories
    session_files = []
    for project_dir in args.project_dirs:
        found = find_session_files(project_dir, args.all_projects)
        session_files.extend(found)
        print(f"Found {len(found)} session files in {project_dir}", file=sys.stderr)

    print(f"Total: {len(session_files)} session files", file=sys.stderr)

    results = []
    errors = 0
    skipped = 0

    for filepath, _project, is_subagent in session_files:
        try:
            metrics = analyze_session(filepath, is_subagent=is_subagent)
            if metrics is None:
                skipped += 1
                continue
            if metrics["session_entries_total"] < args.min_entries:
                skipped += 1
                continue
            if not args.no_scrub:
                metrics = scrub_row(metrics)
            results.append(metrics)
        except Exception as e:
            errors += 1
            print(f"Error processing {filepath}: {e}", file=sys.stderr)

    # Sort by start time
    results.sort(key=lambda r: r["start_utc"])

    print(f"Analyzed {len(results)} sessions ({skipped} skipped, {errors} errors)", file=sys.stderr)

    if not results:
        print("No sessions to output", file=sys.stderr)
        return

    # Write CSV
    fieldnames = list(results[0].keys())
    with open(args.output, "w", newline="") as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(results)

    print(f"Wrote {len(results)} rows to {args.output}", file=sys.stderr)

    # Print summary to stderr
    print("\n" + "=" * 90, file=sys.stderr)
    print("  2PM AEST DEGRADATION ANALYSIS", file=sys.stderr)
    print("=" * 90, file=sys.stderr)

    # Filter out subagent sessions for main analysis (they inflate parent session metrics)
    primary_sessions = [r for r in results if r.get("is_subagent", 0) == 0]
    subagent_count = len(results) - len(primary_sessions)
    if subagent_count > 0:
        print(f"\nFiltering {subagent_count} subagent sessions (analyzing {len(primary_sessions)} primary sessions)", file=sys.stderr)

    # Split by 2pm threshold
    before_2pm = [r for r in primary_sessions if r["is_after_2pm"] == 0 and r["hour_local"] >= 6]
    after_2pm = [r for r in primary_sessions if r["is_after_2pm"] == 1 and r["hour_local"] < 22]

    def safe_mean(lst, key):
        vals = [r[key] for r in lst if r.get(key) is not None]
        return statistics.mean(vals) if vals else 0

    def safe_sum(lst, key):
        return sum(r.get(key, 0) for r in lst)

    if before_2pm and after_2pm:
        print(f"\nBefore 2pm AEST (6am-2pm): {len(before_2pm)} sessions", file=sys.stderr)
        print(f"After 2pm AEST (2pm-10pm): {len(after_2pm)} sessions", file=sys.stderr)

        # Key degradation metrics
        metrics_compare = [
            ("Frustration signals/session", "frustration_signals", safe_mean, True),
            ("Corrections/session", "correction_signals", safe_mean, True),
            ("Consecutive corrections/session", "consecutive_corrections", safe_mean, True),
            ("Abandoned frustrated (%)", "abandoned_frustrated", lambda l, k: safe_mean(l, k) * 100, True),
            ("Empty responses/session", "empty_responses", safe_mean, True),
            ("Tool loops/session", "tool_loops", safe_mean, True),
            ("Thinking depth ratio", "thinking_depth_ratio", safe_mean, False),
            ("Tool success rate (%)", "tool_success_rate", safe_mean, False),
            ("Avg output tokens", "total_output_tokens", safe_mean, False),
            ("Avg response length", "avg_assistant_text_length", safe_mean, False),
        ]

        print(f"\n{'Metric':<35} | {'Before 2pm':>12} | {'After 2pm':>12} | {'Change':>10}", file=sys.stderr)
        print("-" * 78, file=sys.stderr)

        for name, key, calc, higher_is_worse in metrics_compare:
            before_val = calc(before_2pm, key)
            after_val = calc(after_2pm, key)
            if before_val > 0:
                pct_change = ((after_val - before_val) / before_val) * 100
                direction = "▲" if pct_change > 0 else "▼"
                is_bad = (pct_change > 0) == higher_is_worse
                marker = " ⚠️" if is_bad and abs(pct_change) > 10 else ""
            else:
                pct_change = 0
                direction = "="
                marker = ""
            print(
                f"{name:<35} | {before_val:>12.2f} | {after_val:>12.2f} | {direction}{abs(pct_change):>7.1f}%{marker}",
                file=sys.stderr,
            )

    # Group by hour (primary sessions only)
    by_hour = defaultdict(list)
    for r in primary_sessions:
        by_hour[r["hour_local"]].append(r)

    print(f"\n{'Hour':>6} | {'Sessions':>8} | {'Frustration':>11} | {'Corrections':>11} | {'Think Depth':>11} | {'Abandoned':>9}", file=sys.stderr)
    print("-" * 78, file=sys.stderr)

    for hour in sorted(by_hour.keys()):
        sessions = by_hour[hour]
        n = len(sessions)
        total_frust = sum(s["frustration_signals"] for s in sessions)
        total_correct = sum(s["correction_signals"] for s in sessions)
        avg_think_depth = statistics.mean(s["thinking_depth_ratio"] for s in sessions) if sessions else 0
        abandoned = sum(s["abandoned_frustrated"] for s in sessions)
        marker = " ◀ 2PM" if hour == 14 else ""
        print(
            f"{hour:>4}:00 | {n:>8} | {total_frust:>11} | {total_correct:>11} | {avg_think_depth:>11.2f} | {abandoned:>9}{marker}",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
