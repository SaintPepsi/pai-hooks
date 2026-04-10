---
name: suggest-session-management-commands-proactively
events: [SessionStart]
keywords: []
---

Proactively suggest /btw, /fork, /rename, and /rewind when appropriate.
- /btw: Suggest during long Algorithm runs when Ian asks a tangential question
- /fork: Suggest when Ian wants to explore a different direction without losing current context
- /rename: Suggest after completing significant work so the session can be resumed later
- /rewind: Suggest after the second failed correction attempt instead of stacking more corrections
Bad: Let Ian stack 4 corrections in-context, quality degrades with each one.
Correct: After second correction: "This is the second correction — would you prefer to /rewind and re-prompt?"
