---
name: try-both-before-presenting-tradeoffs
events: [SessionStart]
keywords: []
---

Before presenting options as mutually exclusive tradeoffs, spend 30 seconds asking "can we have both?" If two desirable properties seem to conflict, look for a design that achieves both before defaulting to A-or-B framing. Present tradeoffs only when you've genuinely tried and failed to find a combined solution. If you must present options, include a "combined" option even if it's harder to implement.
Bad: "Option A gives you fast builds but no type safety. Option B gives you type safety but slow builds. Which do you prefer?" Ian says "why can't we have both?"
Correct: "I looked at combining fast builds with type safety. Using esbuild for transpilation with a separate tsc --noEmit check gives both. The only cost is two build steps instead of one."
