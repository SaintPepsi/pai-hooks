/**
 * Hook Documentation HTML Templates.
 *
 * Pure functions that take structured data and return HTML strings.
 * No I/O — rendering only.
 */

import { readFileSync } from "fs";
import { join } from "path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HookMeta {
  name: string;
  group: string;
  event: string;
  description: string;
}

export interface GroupMeta {
  name: string;
  description: string;
  hooks: HookMeta[];
}

// ─── CSS Loader ───────────────────────────────────────────────────────────────

let cachedCSS: string | null = null;

function getCSS(): string {
  if (!cachedCSS) {
    cachedCSS = readFileSync(join(import.meta.dir, "style.css"), "utf-8");
  }
  return cachedCSS;
}

// ─── Markdown → HTML (minimal, no deps) ───────────────────────────────────────

/**
 * Convert markdown to HTML. Handles the subset used in hook docs:
 * headings, paragraphs, code blocks, inline code, bold, italic,
 * unordered/ordered lists, blockquotes, tables, and links.
 */
export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];
  let inCodeBlock = false;
  let inList: "ul" | "ol" | null = null;
  let inBlockquote = false;
  let inTable = false;
  let tableHeaderDone = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        html.push("</code></pre>");
        inCodeBlock = false;
      } else {
        closeOpenBlocks();
        const lang = line.slice(3).trim();
        html.push(lang ? `<pre><code class="language-${escapeHtml(lang)}">` : "<pre><code>");
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      html.push(escapeHtml(line));
      continue;
    }

    // Empty line
    if (line.trim() === "") {
      closeOpenBlocks();
      continue;
    }

    // Table rows
    if (line.includes("|") && line.trim().startsWith("|")) {
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());

      // Separator row (---|---|---)
      if (cells.every((c) => /^[-:]+$/.test(c))) {
        tableHeaderDone = true;
        continue;
      }

      if (!inTable) {
        closeOpenBlocks();
        html.push("<table>");
        inTable = true;
        tableHeaderDone = false;
      }

      const tag = !tableHeaderDone ? "th" : "td";
      html.push("<tr>" + cells.map((c) => `<${tag}>${inlineMarkdown(c)}</${tag}>`).join("") + "</tr>");
      continue;
    }

    if (inTable) {
      html.push("</table>");
      inTable = false;
      tableHeaderDone = false;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeOpenBlocks();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      html.push(`<h${level} id="${id}">${inlineMarkdown(text)}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      if (!inBlockquote) {
        closeOpenBlocks();
        html.push("<blockquote>");
        inBlockquote = true;
      }
      html.push(`<p>${inlineMarkdown(line.slice(2))}</p>`);
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      if (inList !== "ul") {
        closeOpenBlocks();
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`);
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      if (inList !== "ol") {
        closeOpenBlocks();
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${inlineMarkdown(line.replace(/^\s*\d+\.\s+/, ""))}</li>`);
      continue;
    }

    // Paragraph
    closeOpenBlocks();
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeOpenBlocks();
  if (inCodeBlock) html.push("</code></pre>");

  return html.join("\n");

  function closeOpenBlocks(): void {
    if (inList) { html.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
    if (inBlockquote) { html.push("</blockquote>"); inBlockquote = false; }
    if (inTable) { html.push("</table>"); inTable = false; tableHeaderDone = false; }
  }
}

/** Escape HTML entities. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert inline markdown (bold, italic, code, links) to HTML. */
function inlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ─── Page Templates ───────────────────────────────────────────────────────────

/** Render a single hook documentation page. */
export function renderHookPage(hook: HookMeta, markdownContent: string, groupName: string): string {
  const contentHtml = markdownToHtml(markdownContent);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(hook.name)} — Hook Documentation</title>
  <style>${getCSS()}</style>
</head>
<body>
  <nav class="breadcrumb">
    <a href="../index.html">All Groups</a>
    <span class="sep">/</span>
    <a href="index.html">${escapeHtml(groupName)}</a>
    <span class="sep">/</span>
    ${escapeHtml(hook.name)}
  </nav>

  <h1>${escapeHtml(hook.name)}</h1>

  <div class="meta">
    <span class="badge event">${escapeHtml(hook.event)}</span>
    <span class="badge group">${escapeHtml(groupName)}</span>
  </div>

  <div class="content">
    ${contentHtml}
  </div>

  <footer>
    Generated from <code>${escapeHtml(hook.name)}/doc.md</code> — pai-hooks documentation
  </footer>
</body>
</html>`;
}

/** Render a group index page listing all hooks in the group. */
export function renderGroupPage(group: GroupMeta): string {
  const cards = group.hooks
    .map(
      (h) => `    <a href="${escapeHtml(h.name)}.html" class="hook-card">
      <h3>${escapeHtml(h.name)}</h3>
      <span class="event-tag">${escapeHtml(h.event)}</span>
      <p>${escapeHtml(h.description || "No description")}</p>
    </a>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(group.name)} — Hook Group</title>
  <style>${getCSS()}</style>
</head>
<body>
  <nav class="breadcrumb">
    <a href="../index.html">All Groups</a>
    <span class="sep">/</span>
    ${escapeHtml(group.name)}
  </nav>

  <h1>${escapeHtml(group.name)}</h1>
  ${group.description ? `<p>${escapeHtml(group.description)}</p>` : ""}

  <h2>Hooks</h2>
  <div class="hook-grid">
${cards}
  </div>

  <footer>pai-hooks documentation</footer>
</body>
</html>`;
}

/** Render the top-level index page listing all groups. */
export function renderIndexPage(groups: GroupMeta[]): string {
  const groupCards = groups
    .map(
      (g) => `    <a href="groups/${escapeHtml(g.name)}/index.html" class="hook-card">
      <h3>${escapeHtml(g.name)}</h3>
      <p>${escapeHtml(g.description || `${g.hooks.length} hooks`)}</p>
    </a>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>pai-hooks — Documentation</title>
  <style>${getCSS()}</style>
</head>
<body>
  <h1>pai-hooks</h1>
  <p>Hook documentation — ${groups.reduce((n, g) => n + g.hooks.length, 0)} hooks across ${groups.length} groups.</p>

  <h2>Groups</h2>
  <div class="hook-grid">
${groupCards}
  </div>

  <footer>pai-hooks documentation</footer>
</body>
</html>`;
}
