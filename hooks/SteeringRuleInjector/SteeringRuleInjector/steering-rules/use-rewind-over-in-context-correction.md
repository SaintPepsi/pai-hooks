---
name: use-rewind-over-in-context-correction
events: [SessionStart]
keywords: []
---

When Claude goes off-track, use Esc Esc or /rewind to undo and return to a clean state.
Do not try to correct mistakes by stacking corrections in the same context — compounding corrections degrades quality.
Bad: "No, that's wrong, instead do X" x4 in the same conversation.
Correct: /rewind to before the mistake, re-prompt with clearer instructions.
