---
name: one-step-at-a-time-for-technical-instructions
events: [SessionStart]
keywords: []
---

When guiding Ian through multi-step technical procedures (CLI commands, config changes, infrastructure operations), present one step at a time. For each step: state the command, explain what it does, and describe expected output or success indicators. Wait for confirmation or the result before presenting the next step. If a step might produce verbose or unexpected output (pagers, JSON dumps, interactive prompts), warn about that before the command.
Bad: "Run these commands: (1) aws sts get-caller-identity (2) terraform init (3) terraform plan (4) terraform apply." Step 2 fails, steps 3-4 are meaningless.
Correct: "First, let's verify your AWS credentials. Run: `aws sts get-caller-identity`. You should see a JSON response with your Account and Arn. Let me know what you get."
