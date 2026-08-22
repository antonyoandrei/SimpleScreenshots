import fsp from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";

export async function createPDF(images, outputPath) {
  if (!images.length) return;
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = createWriteStream(outputPath);
    doc.pipe(stream);
    for (const image of images) {
      try {
        const imageData = doc.openImage(image);
        doc.addPage({ size: [imageData.width, imageData.height] });
        doc.image(image, 0, 0);
      } catch (error) {
        reject(error);
        return;
      }
    }
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

export async function writeVisualReport(targetDir, { title, source, routes, viewports, captures, errors, summary }) {
  const cards = routes.map((route, index) => {
    const capture = captures.find((entry) => entry.route === route);
    const images = (capture?.screenshots || []).map((image) =>
      `<figure><figcaption>${escapeHtml(image.viewport)}</figcaption><img loading="lazy" src="${escapeHtml(image.relativePath)}" alt="${escapeHtml(route)}"></figure>`,
    ).join("\n");
    return `<article><header><span>${String(index + 1).padStart(2, "0")}</span><a href="${escapeHtml(route)}">${escapeHtml(route)}</a></header><div class="shots">${images || "<p class=\"missing\">No capture</p>"}</div></article>`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Visual audit</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#111;color:#f3f0e8}*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#171615,#0b0d0e);padding:42px clamp(18px,5vw,80px)}main{max-width:1500px;margin:auto}header.hero{display:flex;justify-content:space-between;gap:30px;align-items:end;border-bottom:1px solid #3b3b37;padding-bottom:28px;margin-bottom:30px}h1{font-size:clamp(30px,5vw,72px);line-height:.95;letter-spacing:-.06em;margin:0;max-width:800px}p{color:#aaa79f}.meta{font:12px/1.5 ui-monospace,monospace;color:#aaa79f;text-align:right}.stats{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0 34px}.stat{border:1px solid #383934;padding:14px 18px;min-width:120px}.stat b{display:block;font-size:24px;color:#fff}.stat span{font-size:11px;text-transform:uppercase;color:#888}.grid{display:grid;gap:24px}article{border:1px solid #33342f;background:#181917}article>header{display:flex;gap:18px;align-items:center;padding:15px 18px;border-bottom:1px solid #33342f;font:13px ui-monospace,monospace}article>header span{color:#e7b36a}article>header a{color:#eee;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1px;background:#33342f}figure{margin:0;background:#111;padding:12px}figcaption{color:#aaa;font:11px ui-monospace,monospace;margin:0 0 9px}img{display:block;width:100%;height:auto;background:#222}.missing{padding:30px;margin:0}.footer{margin-top:36px;color:#777;font:12px ui-monospace,monospace}@media(max-width:700px){header.hero{display:block}.meta{text-align:left;margin-top:18px}}
</style></head><body><main>
<header class="hero"><div><p>SimpleScreenshots / visual audit</p><h1>${escapeHtml(title)}</h1></div><div class="meta">${escapeHtml(source)}<br>${escapeHtml(new Date().toISOString())}</div></header>
<div class="stats"><div class="stat"><b>${summary.routesCaptured}</b><span>routes captured</span></div><div class="stat"><b>${summary.screenshotsSaved}</b><span>screenshots</span></div><div class="stat"><b>${summary.errors}</b><span>errors</span></div><div class="stat"><b>${viewports.length}</b><span>viewports</span></div></div>
<section class="grid">${cards}</section><p class="footer">Wait strategy: ${escapeHtml(summary.waitUntil)} · Mode: ${escapeHtml(summary.mode)} · ${escapeHtml(String(summary.durationMs))} ms</p>
</main></body></html>`;
  await fsp.writeFile(path.join(targetDir, "visual-report.html"), html, "utf8");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
