import { describe, expect, it } from "bun:test";
import type { GroupMeta, HookMeta } from "./template";
import {
  markdownToHtml,
  renderGroupPage,
  renderHookPage,
  renderIndexPage,
} from "./template";

// ─── markdownToHtml (body renderer) ───────────────────────────────────────────

describe("markdownToHtml", () => {
  it("converts paragraphs", () => {
    expect(markdownToHtml("Hello world")).toContain("<p>Hello world</p>");
  });

  it("converts inline code", () => {
    expect(markdownToHtml("Use `foo()` here")).toContain("<code>foo()</code>");
  });

  it("converts bold text", () => {
    expect(markdownToHtml("This is **bold**")).toContain(
      "<strong>bold</strong>",
    );
  });

  it("converts links", () => {
    const html = markdownToHtml("[click](http://example.com)");
    expect(html).toContain('<a href="http://example.com">click</a>');
  });

  it("converts fenced code blocks to code-window", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const html = markdownToHtml(md);
    expect(html).toContain("code-window");
    expect(html).toContain("code-block");
    expect(html).toContain("const x = 1;");
  });

  it("converts bullet lists to reason boxes", () => {
    const md = "- item one\n- item two";
    const html = markdownToHtml(md);
    expect(html).toContain("reason");
    expect(html).toContain("item one");
    expect(html).toContain("item two");
  });

  it("converts ordered lists to flow steps", () => {
    const md = "1. first\n2. second";
    const html = markdownToHtml(md);
    expect(html).toContain("flow-step");
    expect(html).toContain("step-dot");
    expect(html).toContain("first");
  });

  it("converts blockquotes to use-case examples", () => {
    const md = "> first line\n> second line";
    const html = markdownToHtml(md);
    expect(html).toContain("uc-example");
    expect(html).toContain("first line");
    expect(html).toContain("second line");
  });

  it("converts tables to .tbl", () => {
    const md = "| Name | Type |\n| --- | --- |\n| foo | bar |";
    const html = markdownToHtml(md);
    expect(html).toContain('class="tbl"');
    expect(html).toContain("<th>");
    expect(html).toContain("<td>foo</td>");
  });

  it("escapes HTML in code blocks", () => {
    const md = "```\n<div>&</div>\n```";
    const html = markdownToHtml(md);
    expect(html).toContain("&lt;div&gt;");
  });
});

// ─── renderHookPage ───────────────────────────────────────────────────────────

describe("renderHookPage", () => {
  const hook: HookMeta = {
    name: "TestHook",
    group: "TestGroup",
    event: "PostToolUse",
    description: "A test hook",
  };

  it("produces valid HTML", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes hero section with hook name", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain('class="hero"');
    expect(html).toContain("<h1>TestHook</h1>");
  });

  it("includes event tag with correct color", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("tag blue"); // PostToolUse = blue
  });

  it("wraps sections in colored cards", () => {
    const html = renderHookPage(
      hook,
      "## Overview\nHello\n\n## Dependencies\nDeps here",
      "TestGroup",
    );
    expect(html).toContain("card accent"); // Overview = accent
    expect(html).toContain("card cyan"); // Dependencies = cyan
  });

  it("includes card-icon and card-header per section", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("card-icon");
    expect(html).toContain("card-header");
  });

  it("inlines CSS from framework", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("<style>");
    expect(html).toContain("--bg:");
  });

  it("builds sidebar when enough sections", () => {
    const md =
      "## Overview\nA\n\n## Event\nB\n\n## When It Fires\nC\n\n## What It Does\nD";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain('id="wikiNav"');
  });

  it("omits sidebar for short docs", () => {
    const html = renderHookPage(hook, "## Overview\nShort doc.", "TestGroup");
    expect(html).not.toContain('id="wikiNav"');
  });

  it("renders code blocks as code-windows inside cards", () => {
    const md = "## What It Does\n\n```typescript\nconst x = 1;\n```";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain("code-window");
    expect(html).toContain("code-window-dots");
  });

  it("renders bullet lists as reason boxes", () => {
    const md = "## When It Fires\n\n- condition A\n- condition B";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain("reason");
  });

  it("renders ordered lists as flow steps", () => {
    const md = "## What It Does\n\n1. step one\n2. step two";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain("flow-step");
  });

  it("renders blockquotes as use-case examples", () => {
    const md =
      "## Examples\n\n### Example 1\n\n> User does something\n> Agent responds";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain("uc-example");
  });

  it("renders tables as .tbl", () => {
    const md =
      "## Dependencies\n\n| Dep | Type |\n| --- | --- |\n| fs | adapter |";
    const html = renderHookPage(hook, md, "TestGroup");
    expect(html).toContain('class="tbl"');
  });

  it("strips h1 from preamble", () => {
    const md = "# MyHook\n\n## Overview\nContent";
    const html = renderHookPage(hook, md, "TestGroup");
    // Should NOT have a raw h1 in container (hero has it)
    expect(html).not.toContain('<h1 id="myhook"');
  });

  it("includes copy-idea button when ideaContent is provided", () => {
    const idea = "# Test\n\n## Problem\n\nSome problem.";
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup", idea);
    expect(html).toContain("copy-idea-btn");
    expect(html).toContain('id="ideaContent"');
    expect(html).toContain("copyIdea");
  });

  it("stores idea content in a script element", () => {
    const idea = "# Test Hook\n\n## Problem\n\nA problem.";
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup", idea);
    expect(html).toContain('<script type="text/plain" id="ideaContent">');
    expect(html).toContain("# Test Hook");
  });

  it("omits copy-idea button when no ideaContent", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).not.toContain('onclick="copyIdea()"');
    expect(html).not.toContain('id="ideaContent"');
  });

  it("stores raw idea content in script element without HTML parsing", () => {
    const idea = "# Test\n\n## Problem\n\nUse `<any>` carefully.";
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup", idea);
    expect(html).toContain('<script type="text/plain" id="ideaContent"># Test');
    expect(html).toContain("Use `<any>` carefully.");
  });

  it("escapes closing script tag in idea content to prevent tag breakout", () => {
    const closingTag = "<" + "/script>";
    const idea = "# Test\n\n## Problem\n\nAvoid " + closingTag + " injection.";
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup", idea);
    expect(html).not.toContain(closingTag + " injection");
    expect(html).toContain("<\\/script>" + " injection");
  });
});

// ─── renderGroupPage ─────────────────────────────────────────────────────────

describe("renderGroupPage", () => {
  const group: GroupMeta = {
    name: "TestGroup",
    description: "A test group",
    hooks: [
      {
        name: "HookA",
        group: "TestGroup",
        event: "PreToolUse",
        description: "First hook",
      },
      {
        name: "HookB",
        group: "TestGroup",
        event: "Stop",
        description: "Second hook",
      },
    ],
  };

  it("produces valid HTML with hero", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('class="hero"');
  });

  it("lists hooks as colored cards", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("card orange"); // PreToolUse
    expect(html).toContain("card red"); // Stop
  });

  it("includes summary grid", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("summary-grid");
  });
});

// ─── renderIndexPage ─────────────────────────────────────────────────────────

describe("renderIndexPage", () => {
  const groups: GroupMeta[] = [
    {
      name: "GroupA",
      description: "First",
      hooks: [{ name: "H1", group: "GroupA", event: "Stop", description: "" }],
    },
    { name: "GroupB", description: "", hooks: [] },
  ];

  it("produces valid HTML with hero", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('class="hero"');
  });

  it("links to group pages", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("groups/GroupA/index.html");
    expect(html).toContain("groups/GroupB/index.html");
  });

  it("renders groups as cards", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("card accent");
  });
});
