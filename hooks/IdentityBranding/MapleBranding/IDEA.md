# Brand Identity Enforcer

> Block outgoing public content that uses incorrect or default branding.

## Problem

AI coding tools add their own default footers and signatures to pull requests, issues, and comments. When an AI assistant has a custom identity, these defaults leak through and create inconsistent branding. An emoji-based sign-off might also render differently across platforms, breaking visual consistency.

## Solution

Intercept every command that publishes content to external platforms (PR creation, issue comments, code reviews). Check whether the content contains a default AI footer or an incorrect sign-off format. If found, block the command and instruct the AI to replace it with the correct branded sign-off before retrying.

## How It Works

1. Before any shell command that targets a publishing endpoint (PR create, issue comment, review submit, API call), capture the command text.
2. Check whether it contains a default AI tool footer (e.g., "Generated with [Tool Name]").
3. Check whether it uses a plain emoji sign-off instead of the required image-based format.
4. If either violation is found, block the command and return the correct sign-off for substitution.
5. If branding is correct or absent, allow the command through.

## Signals

- **Input:** Shell commands that publish content to external platforms
- **Output:** Block with the correct sign-off template, or silent pass-through
