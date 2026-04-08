/**
 * SteeringRuleInjector Contract — Inject steering rules into session context.
 *
 * Fires on SessionStart (always-rules with empty keywords) and
 * UserPromptSubmit (keyword-matched rules). Parses YAML frontmatter
 * from .md rule files, matches keywords case-insensitively, and
 * tracks injections per-session so each rule fires at most once.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RuleFrontmatter {
  name: string;
  events: string[];
  keywords: string[];
  body: string;
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────

export function parseFrontmatter(content: string): RuleFrontmatter | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const [, yaml, body] = match;
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const eventsMatch = yaml.match(/^events:\s*\[([^\]]*)\]$/m);
  const keywordsMatch = yaml.match(/^keywords:\s*\[([^\]]*)\]$/m);

  if (!nameMatch || !eventsMatch) return null;

  const name = nameMatch[1].trim();
  const events = eventsMatch[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const keywords = keywordsMatch
    ? keywordsMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return { name, events, keywords, body: body.trim() };
}
