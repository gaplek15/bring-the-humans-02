#!/usr/bin/env node
/**
 * main.ts — renders this repository's README.md into a standalone static site.
 *
 * Reads README.md from the repository root (or --in <file>) and writes
 * /output/index.html (or --out <file>). Pure Node 22, no dependencies, no
 * network. The output is deterministic: same input, same bytes.
 *
 * The entry itself is the README (the guide); this file only builds its
 * readable web version. It never deletes anything: it creates the output
 * directory if needed and writes the one file.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const out = { input: resolve(ROOT, "README.md"), output: "/output/index.html" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--in" && argv[i + 1]) out.input = resolve(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) out.output = resolve(argv[++i]);
  }
  return out;
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s) {
  // Escape the raw text FIRST, then build markup on the escaped text, so
  // generated tags are never re-escaped by a later replacement.
  s = esc(s);
  // linked image: [![alt](src)](href)
  s = s.replace(
    /\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^&]*?")?\)\]\(([^)\s]+)(?:\s+"[^&]*?")?\)/g,
    (_m, alt, src, href) =>
      `<a href="${href}"><img src="${src}" alt="${alt}" loading="lazy"></a>`
  );
  // plain image
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^&]*?")?\)/g, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy">`;
  });
  // link (text already escaped; may hold an <img> from above, kept as-is)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^&]*?")?\)/g, (_m, text, href) => {
    return `<a href="${href}">${text}</a>`;
  });
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
  s = s.replace(/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`);
  return s;
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function mdToHtml(md) {
  const lines = md.split("\n");
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = "";
  let codeBuf = [];
  let inDetails = false;

  function flushCode() {
    if (codeBuf.length) {
      out.push(
        `<pre><code${codeLang ? ` class="language-${esc(codeLang)}"` : ""}>${esc(
          codeBuf.join("\n")
        )}</code></pre>`
      );
      codeBuf = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      if (!inCode) {
        inCode = true;
        codeLang = fence[1] || "";
      } else {
        inCode = false;
        flushCode();
      }
      i++;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i++;
      continue;
    }

    // Raw HTML block lines (details/summary/sub): GitHub renders them as-is,
    // so pass them through unchanged instead of escaping them.
    const trimmed = line.trim();
    if (
      trimmed.startsWith("<details>") ||
      trimmed.startsWith("</details>") ||
      trimmed.startsWith("<summary>") ||
      trimmed.startsWith("</summary>") ||
      trimmed.startsWith("<sub>") ||
      trimmed.startsWith("</sub>")
    ) {
      out.push(line);
      i++;
      continue;
    }

    // horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      out.push("<hr>");
      i++;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].replace(/<[^>]+>/g, "").trim();
      out.push(`<h${level} id="${slug(text)}">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // blockquote (may span lines; group them)
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${buf.map((b) => `<p>${inline(b)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // tables: header row + separator + rows
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1])) {
      const header = line.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push(
        "<table><thead><tr>" +
          header.map((c) => `<th>${inline(c)}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows
            .map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>")
            .join("") +
          "</tbody></table>"
      );
      continue;
    }

    // unordered list
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ""));
        i++;
      }
      out.push("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
      continue;
    }

    // ordered list
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      out.push("<ol>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ol>");
      continue;
    }

    // blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // paragraph (group consecutive plain lines)
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|>\s?|[-*]\s+|\d+\.\s+|\|.*\||---+|<details>|<\/details>|<summary>)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  flushCode();
  return out.join("\n");
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.65; color: #1a1a2e; background: #fafafc; }
main { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
h1 { font-size: 2rem; line-height: 1.25; margin: 0.2em 0 0.5em; }
h2 { font-size: 1.45rem; margin: 1.8em 0 0.5em; padding-bottom: 0.2em; border-bottom: 1px solid #e5e5ef; }
h3 { font-size: 1.15rem; margin: 1.4em 0 0.4em; }
p, li { font-size: 1rem; }
a { color: #5b4bc4; }
a:hover { text-decoration: underline; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.88em; background: #f0f0f5; padding: 0.15em 0.35em; border-radius: 4px; }
pre { background: #17172a; color: #e8e8f2; padding: 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; color: inherit; padding: 0; }
blockquote { margin: 1.2em 0; padding: 0.6em 1em; border-left: 4px solid #5b4bc4; background: #f2f0fb; border-radius: 0 8px 8px 0; }
blockquote p { margin: 0.3em 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95rem; }
th, td { border: 1px solid #ddd6f3; padding: 8px 10px; text-align: left; }
th { background: #f2f0fb; }
img { max-width: 100%; height: auto; }
details { border: 1px solid #e5e5ef; border-radius: 8px; padding: 10px 14px; margin: 0.8em 0; background: #fff; }
summary { cursor: pointer; font-weight: 600; }
hr { border: none; border-top: 1px solid #e5e5ef; margin: 2em 0; }
footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #e5e5ef; font-size: 0.9rem; color: #666; }
.cta { display: block; margin: 1.5em 0; padding: 16px 20px; background: #5b4bc4; color: #fff; border-radius: 10px; text-align: center; font-weight: 600; text-decoration: none; }
.cta:hover { background: #4a3da8; color: #fff; text-decoration: none; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
}

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const md = readFileSync(input, "utf8");
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "make.fun guide";
  const body = mdToHtml(md);
  const html = page(title, body);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, html);
  console.log(`wrote ${output} (${html.length} bytes)`);
}

main();
