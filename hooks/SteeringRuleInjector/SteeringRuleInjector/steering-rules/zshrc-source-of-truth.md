---
name: zshrc-source-of-truth
events: [UserPromptSubmit]
keywords: [zshrc, .zshrc, zsh]
---

When modifying ~/.zshrc, the source of truth for managed sections is ~/.claude/setup/fragments/zsh/*.sh. Edit the fragment files, not ~/.zshrc directly. Run `bun ~/.claude/setup/steps/04-dotfiles.ts` to inject changes.
Managed blocks are marked `# --- PAI:zsh/<id> ---`. Direct edits to these blocks will be overwritten.
