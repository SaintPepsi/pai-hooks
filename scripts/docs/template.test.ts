import { describe, it, expect } from "bun:test";
import { markdownToHtml, renderHookPage, renderGroupPage, renderIndexPage } from "./template";
import type { HookMeta, GroupMeta } from "./template";

// ─── markdownToHtml ───────────────────────────────────────────────────────────

describe("markdownToHtml", () => {
  it("converts headings", () => {
    expect(markdownToHtml("## Overview")).toContain("<h2");
    expect(markdownToHtml("### Details")).toContain("<h3");
  });

  it("adds id attributes to headings", () => {
    const html = markdownToHtml("## When It Fires");
    expect(html).toContain('id="when-it-fires"');
  });

  it("converts paragraphs", () => {
    expect(markdownToHtml("Hello world")).toContain("<p>Hello world</p>");
  });

  it("converts inline code", () => {
    expect(markdownToHtml("Use `foo()` here")).toContain("<code>foo()</code>");
  });

  it("converts bold text", () => {
    expect(markdownToHtml("This is **bold**")).toContain("<strong>bold</strong>");
  });

  it("converts italic text", () => {
    expect(markdownToHtml("This is *italic*")).toContain("<em>italic</em>");
  });

  it("converts links", () => {
    const html = markdownToHtml("[click](http://example.com)");
    expect(html).toContain('<a href="http://example.com">click</a>');
  });

  it("converts fenced code blocks", () => {
    const md = "```typescript\nconst x = 1;\n```";
    const html = markdownToHtml(md);
    expect(html).toContain("<pre><code");
    expect(html).toContain("const x = 1;");
  });

  it("escapes HTML in code blocks", () => {
    const md = "```\n<div>&</div>\n```";
    const html = markdownToHtml(md);
    expect(html).toContain("&lt;div&gt;");
    expect(html).toContain("&amp;");
  });

  it("converts unordered lists", () => {
    const md = "- item one\n- item two";
    const html = markdownToHtml(md);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>item two</li>");
  });

  it("converts ordered lists", () => {
    const md = "1. first\n2. second";
    const html = markdownToHtml(md);
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("converts blockquotes", () => {
    const html = markdownToHtml("> quoted text");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("quoted text");
  });

  it("converts tables", () => {
    const md = "| Name | Type |\n| --- | --- |\n| foo | bar |";
    const html = markdownToHtml(md);
    expect(html).toContain("<table>");
    expect(html).toContain("<th>Name</th>");
    expect(html).toContain("<td>foo</td>");
  });
});

// ─── renderHookPage ───────────────────────────────────────────────────────────

describe("renderHookPage", () => {
  const hook: HookMeta = { name: "TestHook", group: "TestGroup", event: "PostToolUse", description: "A test hook" };

  it("produces valid HTML", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("</html>");
  });

  it("includes hook name in title and h1", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("<title>TestHook");
    expect(html).toContain("<h1>TestHook</h1>");
  });

  it("includes event badge", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("PostToolUse");
  });

  it("includes breadcrumb navigation", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("All Groups");
    expect(html).toContain("TestGroup");
  });

  it("renders markdown content", () => {
    const html = renderHookPage(hook, "## Overview\nThis hook does things.", "TestGroup");
    expect(html).toContain("<h2");
    expect(html).toContain("This hook does things.");
  });

  it("inlines CSS", () => {
    const html = renderHookPage(hook, "## Overview\nHello", "TestGroup");
    expect(html).toContain("<style>");
    expect(html).toContain("--bg:");
  });
});

// ─── renderGroupPage ─────────────────────────────────────────────────────────

describe("renderGroupPage", () => {
  const group: GroupMeta = {
    name: "TestGroup",
    description: "A test group",
    hooks: [
      { name: "HookA", group: "TestGroup", event: "PreToolUse", description: "First hook" },
      { name: "HookB", group: "TestGroup", event: "Stop", description: "Second hook" },
    ],
  };

  it("produces valid HTML", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("lists all hooks as cards", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("HookA");
    expect(html).toContain("HookB");
  });

  it("includes event tags", () => {
    const html = renderGroupPage(group);
    expect(html).toContain("PreToolUse");
    expect(html).toContain("Stop");
  });

  it("links to hook pages", () => {
    const html = renderGroupPage(group);
    expect(html).toContain('href="HookA.html"');
    expect(html).toContain('href="HookB.html"');
  });
});

// ─── renderIndexPage ─────────────────────────────────────────────────────────

describe("renderIndexPage", () => {
  const groups: GroupMeta[] = [
    { name: "GroupA", description: "First", hooks: [{ name: "H1", group: "GroupA", event: "Stop", description: "" }] },
    { name: "GroupB", description: "", hooks: [] },
  ];

  it("produces valid HTML", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("includes total hook count", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("1 hooks");
    expect(html).toContain("2 groups");
  });

  it("links to group pages", () => {
    const html = renderIndexPage(groups);
    expect(html).toContain("groups/GroupA/index.html");
    expect(html).toContain("groups/GroupB/index.html");
  });
});
