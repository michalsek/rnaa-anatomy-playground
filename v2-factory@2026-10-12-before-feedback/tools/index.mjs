// Writes v2-factory/index.html: every part with its status note and latest shot, for following the work.
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const section = (dir, name) => {
  const base = join(ROOT, dir, name);
  const notes = existsSync(join(base, "NOTES.md")) ? readFileSync(join(base, "NOTES.md"), "utf8") : "";
  const status = (/^status:\s*(.+)$/im.exec(notes) || [, "in progress"])[1];
  const shot = existsSync(join(base, "shot.png")) ? `${dir}/${name}/shot.png` : "";
  const pages = readdirSync(base).filter((f) => f.endsWith(".html"));
  return `<article><h2>${esc(name)} <small>${esc(status)}</small></h2>${shot ? `<a href="${dir}/${name}/${pages.find((p) => p.includes("light")) ?? pages[0]}"><img src="${shot}?${Date.now()}" alt="${esc(name)}"></a>` : ""}<p>${pages.map((p) => `<a href="${dir}/${name}/${p}">${p}</a>`).join(" · ")}</p><pre>${esc(notes.slice(0, 1600))}</pre></article>`;
};
const parts = readdirSync(join(ROOT, "parts")).filter((d) => !d.startsWith("."));
const asm = existsSync(join(ROOT, "assembly")) ? readdirSync(join(ROOT, "assembly")).filter((f) => f.endsWith(".html")) : [];
const html = `<!doctype html><meta charset="utf-8"><title>Audio factory · parts</title><style>body{font:14px/1.5 ui-sans-serif,system-ui;margin:32px auto;max-width:1100px;padding:0 16px;background:#f4f4f1;color:#222}article{background:#fff;border:1px solid #ddd;margin:16px 0;padding:16px}img{max-width:100%;border:1px solid #eee}pre{white-space:pre-wrap;font-size:12px;background:#fafafa;padding:8px}small{font-weight:400;color:#888}</style><h1>Audio factory (v2)</h1><p>Brief: <a href="BRIEF.md">BRIEF.md</a> · Assembly: ${asm.map((p) => `<a href="assembly/${p}">${p}</a>`).join(" · ") || "not started"}</p>${parts.map((p) => section("parts", p)).join("")}`;
writeFileSync(join(ROOT, "index.html"), html);
console.log("wrote index.html with", parts.length, "parts");
