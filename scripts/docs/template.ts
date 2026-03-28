/**
 * Hook Documentation HTML Templates — Agent Design Framework.
 *
 * Section-aware renderer that maps hook doc.md sections to specific
 * framework components:
 *   - ## Overview    → accent card
 *   - ## Event       → cyan card with event badge
 *   - ## When It Fires → orange card with reason boxes
 *   - ## What It Does  → blue card with flow steps
 *   - ## Examples    → green cards per example
 *   - ## Dependencies → table in a cyan card
 *   - ## Configuration → code-window + table
 *   - Other sections → accent card with generic content
 *
 * Pure functions — no I/O except CSS loading.
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

interface DocSection {
  heading: string;
  id: string;
  body: string;
}

// ─── CSS Loader ───────────────────────────────────────────────────────────────

let cachedCSS: string | null = null;

function getCSS(): string {
  if (!cachedCSS) {
    cachedCSS = readFileSync(join(import.meta.dir, "style.css"), "utf-8");
  }
  return cachedCSS;
}

// ─── Event → Color Mapping ────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  PreToolUse: "orange",
  PostToolUse: "blue",
  SessionStart: "green",
  SessionEnd: "cyan",
  UserPromptSubmit: "accent",
  PreCompact: "pink",
  Stop: "red",
  SubagentStart: "maple",
  SubagentStop: "maple",
};

function eventColor(event: string): string {
  return EVENT_COLORS[event] ?? "accent";
}

// ─── Section color mapping ────────────────────────────────────────────────────

const SECTION_COLORS: Record<string, string> = {
  overview: "accent",
  event: "cyan",
  "when it fires": "orange",
  "what it does": "blue",
  examples: "green",
  dependencies: "cyan",
  configuration: "accent",
};

const SECTION_ICONS: Record<string, string> = {
  overview: "&#x1F4CB;",
  event: "&#x26A1;",
  "when it fires": "&#x1F3AF;",
  "what it does": "&#x2699;",
  examples: "&#x1F4A1;",
  dependencies: "&#x1F517;",
  configuration: "&#x2699;",
};

function sectionColor(heading: string): string {
  return SECTION_COLORS[heading.toLowerCase()] ?? "accent";
}

function sectionIcon(heading: string): string {
  return SECTION_ICONS[heading.toLowerCase()] ?? "&#x1F4D6;";
}

// ─── Markdown Parsing ─────────────────────────────────────────────────────────

/** Split markdown into sections by ## headings. Content before the first ## is preamble. */
function parseSections(md: string): { preamble: string; sections: DocSection[] } {
  const lines = md.split("\n");
  const sections: DocSection[] = [];
  let preamble = "";
  let currentHeading = "";
  let currentId = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^## (.+)$/);
    if (h2Match) {
      // Flush previous section
      if (currentHeading) {
        sections.push({ heading: currentHeading, id: currentId, body: currentBody.join("\n").trim() });
      } else if (currentBody.length > 0) {
        preamble = currentBody.join("\n").trim();
      }
      currentHeading = h2Match[1];
      currentId = currentHeading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  // Flush last section
  if (currentHeading) {
    sections.push({ heading: currentHeading, id: currentId, body: currentBody.join("\n").trim() });
  } else if (currentBody.length > 0) {
    preamble = currentBody.join("\n").trim();
  }

  return { preamble, sections };
}

// ─── Escape Helpers ───────────────────────────────────────────────────────────

function esc(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Escape for code blocks — only escape HTML-meaningful chars, preserve quotes. */
function escCode(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMd(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ─── Block-level Markdown → HTML ──────────────────────────────────────────────

/** Render a block of markdown body text to HTML, using framework components. */
function renderBody(body: string): string {
  if (!body.trim()) return "";

  const blocks = parseBlocks(body);
  return blocks.map(renderBlock).join("\n");
}

type Block =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "ordered"; items: string[] }
  | { type: "code"; lang: string; code: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "h3"; text: string };

function parseBlocks(body: string): Block[] {
  const lines = body.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Empty line — skip
    if (line.trim() === "") { i++; continue; }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // H3 heading
    const h3Match = line.match(/^### (.+)$/);
    if (h3Match) {
      blocks.push({ type: "h3", text: h3Match[1] });
      i++;
      continue;
    }

    // Blockquote (collect all consecutive > lines)
    if (line.startsWith("> ") || line === ">") {
      const bqLines: string[] = [];
      while (i < lines.length && (lines[i].startsWith("> ") || lines[i] === ">")) {
        bqLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // Table
    if (line.includes("|") && line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parsedRows = tableLines
        .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()))
        .filter((cells) => !cells.every((c) => /^[-:]+$/.test(c)));
      if (parsedRows.length > 0) {
        blocks.push({ type: "table", headers: parsedRows[0], rows: parsedRows.slice(1) });
      }
      continue;
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "bullets", items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ordered", items });
      continue;
    }

    // Paragraph (collect until empty line or block start)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("> ") &&
      !(lines[i].includes("|") && lines[i].trim().startsWith("|")) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", text: paraLines.join(" ") });
    }
  }

  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "paragraph":
      return `<p>${inlineMd(block.text)}</p>`;

    case "bullets":
      return block.items
        .map((item) => `<div class="reason"><span class="ri">&#x2022;</span> ${inlineMd(item)}</div>`)
        .join("\n");

    case "ordered": {
      const steps = block.items.map((item, i) => `
        <div class="flow-step">
          <div class="step-dot">${i + 1}</div>
          <div class="step-content"><p>${inlineMd(item)}</p></div>
        </div>`).join("\n");
      return `<div class="flow-steps">${steps}\n</div>`;
    }

    case "code":
      return `
      <div class="code-window">
        <div class="code-window-header">
          <div class="code-window-dots"><span></span><span></span><span></span></div>
          ${block.lang ? `<span class="code-window-title">${esc(block.lang)}</span>` : ""}
        </div>
        <div class="code-window-body">
          <div class="code-block">${block.lang ? `<span class="code-lang">${esc(block.lang)}</span>` : ""}
${escCode(block.code)}</div>
        </div>
      </div>`;

    case "blockquote":
      return `
      <div class="uc-example">
        ${block.lines.map((l) => l.trim() === "" ? "" : `<div>${inlineMd(l)}</div>`).filter(Boolean).join("\n        ")}
      </div>`;

    case "table":
      return `
      <table class="tbl">
        <thead><tr>${block.headers.map((h) => `<th>${inlineMd(h)}</th>`).join("")}</tr></thead>
        <tbody>
          ${block.rows.map((row) => `<tr>${row.map((c) => `<td>${inlineMd(c)}</td>`).join("")}</tr>`).join("\n          ")}
        </tbody>
      </table>`;

    case "h3": {
      const id = block.text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      return `<h3 id="${id}">${inlineMd(block.text)}</h3>`;
    }
  }
}

// ─── Section Renderers ────────────────────────────────────────────────────────

/** Wrap a section's content in an appropriately colored card. */
function renderSection(section: DocSection): string {
  const color = sectionColor(section.heading);
  const icon = sectionIcon(section.heading);
  const bodyHtml = renderSectionBody(section);

  return `
  <section id="${section.id}">
    <div class="section-label ${color}">${esc(section.heading)}</div>
    <div class="card ${color}">
      <div class="card-header">
        <div class="card-icon">${icon}</div>
        <h3>${esc(section.heading)}</h3>
      </div>
      ${bodyHtml}
    </div>
  </section>`;
}

/** Render a section's body with section-specific component choices. */
function renderSectionBody(section: DocSection): string {
  const key = section.heading.toLowerCase();
  const blocks = parseBlocks(section.body);

  // Examples section: render each h3 as its own sub-card
  if (key === "examples") {
    return renderExamplesSection(blocks);
  }

  // For all other sections, render blocks with framework components
  return blocks.map(renderBlock).join("\n      ");
}

/** Render examples with each ### example as a distinct visual block. */
function renderExamplesSection(blocks: Block[]): string {
  const html: string[] = [];
  let inExample = false;

  for (const block of blocks) {
    if (block.type === "h3") {
      if (inExample) {
        html.push("</div>"); // close previous example wrapper
      }
      html.push(`<div style="margin-top: 20px;">`);
      html.push(`<h3 style="color: var(--green); margin-bottom: 12px;">${inlineMd(block.text)}</h3>`);
      inExample = true;
    } else {
      html.push(renderBlock(block));
    }
  }

  if (inExample) {
    html.push("</div>");
  }

  return html.join("\n      ");
}

// ─── Wiki Nav Script ──────────────────────────────────────────────────────────

const WIKI_NAV_SCRIPT = `
<script>
(function() {
  var nav = document.getElementById('wikiNav');
  var toggle = document.getElementById('navToggle');
  var overlay = document.getElementById('navOverlay');
  var backToTop = document.getElementById('backToTop');
  var progressFill = document.getElementById('navProgress');
  var progressText = document.getElementById('navProgressText');
  var navItems = document.querySelectorAll('.wiki-nav-item');
  var sections = document.querySelectorAll('section[id]');

  if (toggle) toggle.addEventListener('click', function() {
    nav.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  if (overlay) overlay.addEventListener('click', function() {
    nav.classList.remove('open');
    overlay.classList.remove('open');
  });
  if (nav) nav.querySelectorAll('a').forEach(function(link) {
    link.addEventListener('click', function() {
      if (window.innerWidth <= 1200) {
        nav.classList.remove('open');
        overlay.classList.remove('open');
      }
    });
  });

  var ticking = false;
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(function() {
        var scrollTop = window.scrollY;
        var docHeight = document.documentElement.scrollHeight - window.innerHeight;
        var progress = docHeight > 0 ? Math.min(100, Math.round((scrollTop / docHeight) * 100)) : 0;
        if (progressFill) progressFill.style.width = progress + '%';
        if (progressText) progressText.textContent = progress + '% read';
        if (backToTop) backToTop.classList.toggle('visible', scrollTop > 400);
        var current = '';
        for (var i = 0; i < sections.length; i++) {
          if (sections[i].getBoundingClientRect().top <= 120) current = sections[i].id;
        }
        navItems.forEach(function(item) {
          var link = item.querySelector('a');
          item.classList.toggle('active', link && link.getAttribute('href') === '#' + current);
        });
        ticking = false;
      });
      ticking = true;
    }
  });

  if (backToTop) backToTop.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();
</script>`;

// ─── Page Shell ───────────────────────────────────────────────────────────────

function pageShell(opts: {
  title: string;
  sidebar?: string;
  body: string;
  hasSidebar?: boolean;
}): string {
  const sidebarClass = opts.hasSidebar ? ' class="has-sidebar"' : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(opts.title)}</title>
  <style>${getCSS()}</style>
</head>
<body${sidebarClass}>
${opts.sidebar ?? ""}
${opts.body}
${opts.hasSidebar ? WIKI_NAV_SCRIPT : ""}
</body>
</html>`;
}

// ─── Sidebar Builder ──────────────────────────────────────────────────────────

function buildSidebar(title: string, subtitle: string, items: { id: string; label: string }[]): string {
  const navItems = items
    .map((s, i) => {
      const num = String(i + 1).padStart(2, "0");
      return `    <li class="wiki-nav-item"><a href="#${s.id}"><span class="nav-num">${num}</span> ${esc(s.label)}</a></li>`;
    })
    .join("\n");

  return `
<nav class="wiki-nav" id="wikiNav">
  <div class="wiki-nav-header">
    <h4>${esc(title)}</h4>
    <p>${esc(subtitle)}</p>
  </div>
  <ul class="wiki-nav-list">
${navItems}
  </ul>
  <div class="wiki-nav-progress">
    <div class="wiki-nav-progress-bar">
      <div class="wiki-nav-progress-fill" id="navProgress"></div>
    </div>
    <div class="wiki-nav-progress-text" id="navProgressText">0% read</div>
  </div>
</nav>
<div class="wiki-nav-overlay" id="navOverlay"></div>
<button class="wiki-nav-toggle" id="navToggle" aria-label="Toggle navigation">&#9776;</button>
<button class="back-to-top" id="backToTop" aria-label="Back to top">&#8593;</button>`;
}

// ─── Hero Builder ─────────────────────────────────────────────────────────────

function buildHero(badge: string, title: string, subtitle: string, meta: string[]): string {
  const metaItems = meta.map((m) => `      <span>${esc(m)}</span>`).join("\n");
  return `
<div class="hero">
  <div class="hero-orb orb-1"></div>
  <div class="hero-orb orb-2"></div>
  <div class="container">
    <div class="hero-badge"><span class="dot"></span> ${esc(badge)}</div>
    <h1>${esc(title)}</h1>
    <p>${esc(subtitle)}</p>
    <div class="hero-meta">
${metaItems}
    </div>
  </div>
</div>`;
}

// ─── Page Templates ───────────────────────────────────────────────────────────

/** Render a single hook documentation page. */
export function renderHookPage(hook: HookMeta, markdownContent: string, groupName: string): string {
  const { preamble, sections } = parseSections(markdownContent);

  // Remove h1 from preamble (redundant with hero)
  const cleanPreamble = preamble.replace(/^# .+$/m, "").trim();

  const sidebar = sections.length > 2
    ? buildSidebar(hook.name, `${groupName} / ${hook.event}`, sections.map((s) => ({ id: s.id, label: s.heading })))
    : "";

  const hero = buildHero(
    "Hook Documentation",
    hook.name,
    hook.description || `${hook.event} hook in the ${groupName} group.`,
    [groupName, hook.event, "pai-hooks"],
  );

  const sectionHtml = sections.map(renderSection).join("\n");

  const body = `
${hero}

<div class="container">
  <div class="tags" style="margin-bottom: var(--sp-2xl);">
    <span class="tag ${eventColor(hook.event)}">${esc(hook.event)}</span>
    <span class="tag green">${esc(groupName)}</span>
  </div>

  ${cleanPreamble ? `<p style="color: var(--text-dim); font-size: 15px; margin-bottom: var(--sp-2xl); max-width: 680px;">${inlineMd(cleanPreamble)}</p>` : ""}

  ${sectionHtml}

  <footer>
    <p>Generated from <code>${esc(hook.name)}/doc.md</code> &mdash; pai-hooks documentation</p>
  </footer>
</div>`;

  return pageShell({
    title: `${hook.name} — Hook Documentation`,
    sidebar,
    body,
    hasSidebar: sections.length > 2,
  });
}

/** Render a group index page listing all hooks in the group. */
export function renderGroupPage(group: GroupMeta): string {
  const cards = group.hooks
    .map((h) => {
      const color = eventColor(h.event);
      return `
      <div class="card ${color}" style="cursor:pointer;" onclick="location.href='${esc(h.name)}.html'">
        <div class="card-header">
          <div class="card-icon">&#x1F517;</div>
          <h3>${esc(h.name)}</h3>
          <span class="card-badge" style="background:var(--${color}-dim);color:var(--${color});">${esc(h.event)}</span>
        </div>
        <p>${esc(h.description || "No description")}</p>
      </div>`;
    })
    .join("\n");

  const hero = buildHero(
    "Hook Group",
    group.name,
    group.description || `${group.hooks.length} hooks in this group.`,
    [`${group.hooks.length} hooks`, "pai-hooks"],
  );

  const events = [...new Set(group.hooks.map((h) => h.event))];
  const summaryItems = events.map((event) => {
    const count = group.hooks.filter((h) => h.event === event).length;
    return `<div class="summary-item"><div class="num">${count}</div><div class="label">${esc(event)}</div></div>`;
  }).join("\n    ");

  const body = `
${hero}

<div class="container">
  <div class="summary-grid">
    ${summaryItems}
  </div>

  <div class="section-label">Hooks</div>
  <h2>All Hooks in ${esc(group.name)}</h2>

  ${cards}

  <footer><p>pai-hooks documentation</p></footer>
</div>`;

  return pageShell({ title: `${group.name} — Hook Group`, body });
}

/** Render the top-level index page listing all groups. */
export function renderIndexPage(groups: GroupMeta[]): string {
  const totalHooks = groups.reduce((n, g) => n + g.hooks.length, 0);

  const groupCards = groups
    .map((g) => `
      <div class="card accent" style="cursor:pointer;" onclick="location.href='groups/${esc(g.name)}/index.html'">
        <div class="card-header">
          <div class="card-icon">&#x1F4C1;</div>
          <h3>${esc(g.name)}</h3>
          <span class="card-badge" style="background:var(--accent-glow);color:var(--accent-bright);">${g.hooks.length} hooks</span>
        </div>
        <p>${esc(g.description || `${g.hooks.length} hooks`)}</p>
      </div>`)
    .join("\n");

  const hero = buildHero(
    "Documentation",
    "pai-hooks",
    `${totalHooks} hooks across ${groups.length} groups.`,
    ["March 2026", `${totalHooks} hooks`, `${groups.length} groups`],
  );

  const body = `
${hero}

<div class="container">
  <div class="summary-grid">
    <div class="summary-item"><div class="num">${groups.length}</div><div class="label">Groups</div></div>
    <div class="summary-item"><div class="num">${totalHooks}</div><div class="label">Hooks</div></div>
  </div>

  <div class="section-label">Groups</div>
  <h2>All Hook Groups</h2>

  ${groupCards}

  <footer>
    <p>pai-hooks documentation</p>
    <div class="collab"><span>pai-hooks</span></div>
  </footer>
</div>`;

  return pageShell({ title: "pai-hooks — Documentation", body });
}

// ─── Exported for tests ───────────────────────────────────────────────────────

/** Render markdown body text to HTML using framework components. */
export function markdownToHtml(md: string): string {
  return renderBody(md);
}
