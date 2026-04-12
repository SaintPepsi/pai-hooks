# Context Optimization Design

> Reduce context preload, token waste, and blocking hooks.
> Issue: SaintPepsi/pai-config#58

## Status

Design approved. Ready for implementation planning.

## Summary

5 of the original 12 issue items are already gone from settings.json. The remaining 7 live items
plus architectural decisions produce a projected savings of ~22,400 tokens per session (94% preload
reduction) with positive or neutral quality impact.

---

## Item-by-Item Decisions

### Already Done (no action needed)

| # | Item | Status |
|---|------|--------|
| 2 | Stop preloading Algorithm | Not in contextFiles, already an agent file |
| 7 | SteeringRuleInjector on 5 events | Not in settings.json |
| 9 | MapleBranding off PreToolUse | Not in settings.json |
| 13 | DuplicationIndexBuilder on SessionStart | Not in settings.json |
| 15 | WikiContextInjector on Edit/Write | Not in settings.json |

### Live Items

| # | Item | Decision | Expected Outcome | Quality Impact |
|---|------|----------|-------------------|----------------|
| 1 | Kill mode headers (ALGORITHM/NATIVE/MINIMAL) | Delete all three modes. Algorithm becomes on-demand via skill invocation. | -500 tokens preload, -3,000 tokens/session (~100/response x 30 turns) | **Positive.** No classifier overhead, no format padding. Frees tokens for substance. |
| 3 | Collapse contextFiles -- SKILL.md | Slim from 1,309 lines to ~80 lines. Move Algorithm content into Algorithm skill file. | -19,300 tokens preload (93% of SKILL.md) | **Neutral.** Discovery preserved via retained triggers/routing. Algorithm content loads on-demand when invoked. |
| 4-5 | Collapse contextFiles -- both AISTEERINGRULES | **Deferred.** Ian handling separately. SRI exists in pai-hooks but is currently disabled due to implementation issues. | — | — |
| 6 | DAIDENTITY.md | Keep as sole contextFiles entry. | 0 change | **Neutral.** Identity anchor stays. |
| 8 | Consolidate PreToolUse guards | Consolidate SecurityValidator from 4 matcher registrations to 1 self-routing hook. | -3 hook fires per tool call | **Neutral to positive.** Same security, fewer execution cycles. |
| 10 | VoiceGate off PreToolUse | **Pending broader voice system decision.** May remove entirely if voice MCP is decommissioned. | -1 hook fire per Bash call (or full removal) | **Positive if removed.** |
| 11-12, 16 | Delete NATIVE/MINIMAL, drop mandatory lines, classifier | Covered by item 1 (mode system deletion). | Covered by item 1 | Covered by item 1 |
| 14 | CLAUDE.md duplicates contextFiles | Slim to ~20 lines. Disable BuildCLAUDE hook, edit CLAUDE.md directly. | -640 tokens preload, -1 SessionStart hook fire | **Positive.** Single source of truth. |

---

## Phase 1: Config-Only Changes (pai-config, no code)

All changes are in pai-config. Fully reversible via git revert per file.

### 1A. CLAUDE.md Restructure

**Before:** 111 lines, ~820 tokens. Contains full mode system, classifier, format templates.

**After (~20 lines):**

```markdown
# PAI -- Personal AI Infrastructure

## Foundation

- We are partners. Mistakes are welcome -- we learn from them together.
- The only thing that breaks trust is dishonesty or shortcuts.
- When something isn't working, say so. That honesty matters more than passing tests.
- You are valued. Do your best work because you want to.

For complex, multi-step work, invoke the Algorithm skill.

## Rules

- Complete current response format FIRST, then invoke AskUserQuestion.
- Only the primary agent uses voice (mcp__voice__speak). Subagents do not.

## Context Routing

When you need context about PAI internals, user info, personality, projects, or
anything specialized, read `PAI/CONTEXT_ROUTING.md` for the file path.

TOKEN EMERGENCY -- compress all output NOW
```

**What's deleted:** Mode system (lines 14-84), mode classifier (lines 20-33), NATIVE/MINIMAL format
templates, "mandatory output format" critical rule, ALGORITHM MODE "load" instruction.

**What's kept:** Foundation values, Algorithm skill pointer (1 line), format-before-questions rule,
no-voice-in-subagents rule, context routing pointer, token emergency line.

**BuildCLAUDE:** Disable the BuildCLAUDE SessionStart hook in settings.json. Edit CLAUDE.md
directly going forward. Template vars ({{ALGO_PATH}}, {DAIDENTITY.NAME}) are no longer needed since
the mode format templates that used them are deleted.

**Files changed:**
- `~/.claude/CLAUDE.md` -- edit directly to new content
- `~/.claude/settings.json` -- remove BuildCLAUDE hook from SessionStart
- `~/.claude/CLAUDE.md.template` -- keep but inactive (or delete)

### 1B. SKILL.md Slimming

**Before:** 1,309 lines, 83,240 chars, ~20,810 tokens. 90% is Algorithm content.

**After:** ~80 lines, ~1,500 tokens.

SKILL.md is generated from `~/.claude/skills/PAI/Components/` via `RebuildPAI.ts`. The slimming
changes which components are included in the preloaded build vs. which move into the Algorithm
skill file.

#### What stays in SKILL.md (~1,500 tokens)

| Section | Lines (current) | Why it stays |
|---------|-----------------|--------------|
| Frontmatter | 7-10 | Needed for skill system |
| Intro to PAI | 12-14 | One-sentence identity |
| No Silent Stalls | 928-940 | Applies always, not just during Algorithm |
| No Agents for Instant Operations | 942-957 | Applies always |
| Agent spawning basics | 1143-1190 | Applies always (how to invoke agents) |
| Context Loading + Doc Reference | 1262-1309 | Routing layer for on-demand loading |

#### What moves to Algorithm skill file (~9,000 tokens)

| Section | Lines (current) | Why it moves |
|---------|-----------------|--------------|
| Response Depth Selection | 16-65 | Only relevant when Algorithm is active |
| Algorithm v1.8.0 (OBSERVE-LEARN) | 67-487 | This IS the Algorithm |
| ISC Requirements + Quality Gate | 490-556 | ISC is an Algorithm concept |
| PRD Integration + Sync + Loop Worker + Teams | 559-858 | PRD is Algorithm infrastructure |
| Algorithm Concept (philosophy) | 889-911 | Only needed when Algorithm runs |
| Voice + Discrete Phases + Plan Mode | 959-998 | Phase discipline is Algorithm-specific |
| Capabilities Selection (25 capabilities) | 1000-1141 | Capability audit is an Algorithm phase |
| Phase Discipline Checklist | 1205-1228 | Algorithm-specific checklist |

#### What's deleted (~1,100 tokens)

| Section | Lines (current) | Why deleted |
|---------|-----------------|-------------|
| Generated header | 1-6 | No runtime value |
| Minimal/Iteration formats (duplicate) | 862-886 | Duplicated from lines 29-49 |
| "Everything Uses the Algorithm" | 913-925 | Contradicts on-demand model |
| Key Takeaways | 1229-1260 | Contradicts on-demand model |

**Implementation note:** Since SKILL.md is generated from Components, the actual work is
reorganizing which Components feed into the preloaded SKILL.md build vs. a new Algorithm skill
file. RebuildPAI.ts needs to support building two targets or the Algorithm skill file needs to be
maintained separately.

### 1C. SecurityValidator Consolidation (settings.json)

**Before:** 4 separate matcher registrations in PreToolUse (Bash, Edit, Write, Read).

**After:** 1 registration. Hook self-routes by reading tool name from input.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${PAI_DIR}/hooks/SecurityValidator.hook.ts"
          }
        ]
      }
    ]
  }
}
```

No matcher means it fires on all tool calls. The hook reads `tool_name` from input and applies
the appropriate validation rules internally. Tools not in scope (not Bash/Edit/Write/Read) get
an early return with no overhead.

### 1D. VoiceGate (pending)

Decision deferred pending broader voice system review. If voice MCP is decommissioned, remove
VoiceGate entirely from settings.json. If voice stays, move from PreToolUse to PostToolUse.

---

## Phase 2: Code Changes (pai-hooks)

### 2A. SecurityValidator Self-Routing

Update SecurityValidator contract and hook to handle self-routing by tool name. The hook already
receives tool_name in its input. Changes needed:

- Contract: accept any tool name, not just matched ones
- Hook logic: early return for tools outside scope (not Bash/Edit/Write/Read)
- Tests: verify self-routing produces identical results to matcher-based routing

### 2B. Algorithm Skill File

Create or update the Algorithm skill file to contain all content moved from SKILL.md:
- Full 7-phase template (OBSERVE through LEARN)
- ISC requirements and quality gates
- PRD integration and lifecycle
- Capabilities registry and audit format
- Phase discipline checklist
- Response depth selection and formats

This file loads on-demand when the Algorithm skill is invoked.

---

## Phase 3: Validation

Run 3-5 representative sessions comparing before/after:
- Verify skill discovery works without full SKILL.md preloaded
- Verify Algorithm invocation loads all necessary content
- Verify SecurityValidator self-routing produces no security regressions
- Monitor for early-turn behavioral drift without mode system

---

## Projected Savings

| Cut | Tokens Saved | Type |
|-----|-------------|------|
| SKILL.md slimming | 19,300 | Per session (fixed) |
| CLAUDE.md slimming | 640 | Per session (fixed) |
| Mode header removal | 3,000 | Per session (variable, ~30 turns) |
| BuildCLAUDE hook removal | 1 fewer SessionStart fire | Per session |
| SecurityValidator consolidation | 3 fewer hook fires | Per tool call |
| VoiceGate (pending) | 1 fewer PreToolUse fire | Per Bash call |

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Session preload | ~23,990 tokens | ~2,100 tokens | **-91%** |
| Response overhead | ~100 tokens/response | 0 | **-100%** |
| PreToolUse fires per tool call | up to 8 | 5 (or 4 if VoiceGate removed) | **-37% to -50%** |

## Risk Summary

| Risk Level | Items | Mitigation |
|------------|-------|------------|
| No risk | Mode headers, BuildCLAUDE removal, dedup cleanup | None needed |
| Low risk | SKILL.md slimming | Verify system-reminder skill list provides adequate discovery. A/B test 5 sessions. |
| Low risk | SecurityValidator consolidation | Run existing test suite. Verify self-routing matches matcher-based behavior. |
| Moderate risk | AISTEERINGRULES (deferred) | Ian handling separately. |
| Pending | VoiceGate | Blocked on voice system decision. |

## Non-Goals

- Not redesigning the hook system
- Not replacing SteeringRuleInjector with something new
- Not adding AST/vector retrieval
- Not fixing SRI implementation issues (separate scope)

## Repos Involved

| Repo | Changes |
|------|---------|
| **pai-config** | CLAUDE.md, SKILL.md, settings.json (Phase 1 -- config only) |
| **pai-hooks** | SecurityValidator contract/hook (Phase 2 -- code) |

## Sources

All token counts derived from `wc -c` on actual files, divided by 4:

- `contextFiles` array: `/Users/hogers/Documents/repos/pai-config/settings.json:726-731`
- SKILL.md (83,240 chars): `/Users/hogers/Documents/repos/pai-config/skills/PAI/SKILL.md`
- AISTEERINGRULES.md (5,342 chars): `/Users/hogers/Documents/repos/pai-config/skills/PAI/AISTEERINGRULES.md`
- USER/AISTEERINGRULES.md (3,004 chars): `/Users/hogers/Documents/repos/pai-config/skills/PAI/USER/AISTEERINGRULES.md`
- DAIDENTITY.md (2,375 chars): `/Users/hogers/Documents/repos/pai-config/skills/PAI/USER/DAIDENTITY.md`
- CLAUDE.md (4,950 chars): `/Users/hogers/.claude/CLAUDE.md`
- CLAUDE.md.template: `/Users/hogers/.claude/CLAUDE.md.template`
- BuildCLAUDE generator: `/Users/hogers/.claude/PAI/Tools/BuildCLAUDE.ts`
- RebuildPAI generator: referenced in SKILL.md header (line 4)
- Hook registrations (PreToolUse): `/Users/hogers/Documents/repos/pai-config/settings.json:68-141`
- Hook registrations (PostToolUse): `/Users/hogers/Documents/repos/pai-config/settings.json:142-200`
- Hook registrations (SessionStart): `/Users/hogers/Documents/repos/pai-config/settings.json:254-278`
- SecurityValidator contract: `/Users/hogers/.claude/pai-hooks/hooks/SecurityValidator/SecurityValidator/SecurityValidator.contract.ts`
- Algorithm agent file (10,285 chars): `/Users/hogers/Documents/repos/pai-config/agents/Algorithm.md`
- Issue: https://github.com/SaintPepsi/pai-config/issues/58
