import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer";
import { writeVisualReport } from "./src/reports.js";

const temp = process.env.TEMP;
const auditDir = path.join(temp, "simplescreenshots-demo-audit");
const framesDir = path.join(temp, "simpletools-demo-frames");
const scraperDocs = "C:/Users/anton/Documents/Código/scraper/docs";
const shotsDocs = "C:/Users/anton/Documents/Código/screenshots/docs";

const routes = [
  { url: "http://127.0.0.1:8765/", file: "home.png" },
  { url: "http://127.0.0.1:8765/about.html", file: "about.png" },
  { url: "http://127.0.0.1:8765/contact.html", file: "contact.png" },
];
const viewports = [
  { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, deviceScaleFactor: 1 },
];

function terminalHtml(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#070809;height:100%}
    .win{width:960px;height:540px;background:#101214;color:#d7dde3;font:15px/1.45 ui-monospace,Consolas,monospace;padding:22px 26px;box-sizing:border-box}
    .dots{display:flex;gap:8px;margin-bottom:18px}
    .dots i{width:10px;height:10px;border-radius:50%;display:block}
    .dots i:nth-child(1){background:#ff5f57}
    .dots i:nth-child(2){background:#febc2e}
    .dots i:nth-child(3){background:#28c840}
    .prompt{color:#8ad7a0}
    .muted{color:#8b939c}
    .ok{color:#d7b36a}
    h1,p,pre{margin:0}
    pre{white-space:pre-wrap}
  </style></head><body><div class="win"><div class="dots"><i></i><i></i><i></i></div>${body}</div></body></html>`;
}

function folderHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:#0c0d0f}
    .win{width:960px;height:540px;padding:36px 40px;color:#ece7dc;font:18px/1.5 ui-sans-serif,system-ui;box-sizing:border-box}
    h1{font-size:34px;margin:0 0 18px;letter-spacing:-.04em}
    ul{list-style:none;padding:0;margin:0;font:16px/1.8 ui-monospace,Consolas,monospace;color:#c9c2b3}
    .dir{color:#d2a56a}
  </style></head><body><div class="win"><h1>northline-mirror</h1><ul>
    <li class="dir">site/</li>
    <li>&nbsp;&nbsp;index.html</li>
    <li>&nbsp;&nbsp;about.html</li>
    <li>&nbsp;&nbsp;contact.html</li>
    <li class="dir">site-resources/</li>
    <li>&nbsp;&nbsp;styles.css</li>
    <li>&nbsp;&nbsp;app.js</li>
    <li>mirror-manifest.json</li>
    <li>serve.mjs</li>
    <li>PREVIEW.txt</li>
  </ul></div></body></html>`;
}

const browser = await puppeteer.launch({ headless: true, args: ["--disable-dev-shm-usage", "--no-sandbox"] });
const page = await browser.newPage();

await fs.rm(auditDir, { recursive: true, force: true });
await fs.mkdir(path.join(auditDir, "desktop"), { recursive: true });
await fs.mkdir(path.join(auditDir, "mobile"), { recursive: true });
await fs.mkdir(framesDir, { recursive: true });
await fs.mkdir(scraperDocs, { recursive: true });
await fs.mkdir(shotsDocs, { recursive: true });

const captures = [];
for (const route of routes) {
  const shots = [];
  for (const viewport of viewports) {
    await page.setViewport(viewport);
    await page.goto(route.url, { waitUntil: "load", timeout: 15000 });
    const relativePath = `${viewport.name}/${route.file}`;
    const outputPath = path.join(auditDir, relativePath);
    await page.screenshot({ path: outputPath, fullPage: true });
    shots.push({ viewport: viewport.name, relativePath });
  }
  captures.push({ route: route.url, screenshots: shots });
}

await writeVisualReport(auditDir, {
  title: "Northline Studio",
  source: "http://127.0.0.1:8765/",
  routes: routes.map((route) => route.url),
  viewports,
  captures,
  errors: [],
  summary: {
    routesCaptured: 3,
    screenshotsSaved: 6,
    errors: 0,
    waitUntil: "load",
    mode: "fast",
    durationMs: 1840,
  },
});

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(auditDir, "visual-report.html")).href, { waitUntil: "load" });
await page.screenshot({ path: path.join(shotsDocs, "visual-report.png"), fullPage: false, clip: { x: 0, y: 0, width: 1440, height: 900 } });

const terminalFrames = [
  terminalHtml(`<pre><span class="prompt">$</span> simplescraper --url http://127.0.0.1:8765 --fast --page-concurrency 3\n\n=========================================\nSIMPLE SCRAPER - FAST SITE MIRROR\n=========================================\n\n   pages: 3 workers · resources: 8 concurrent\n   output: ~/Documents/webs/northline-mirror</pre>`),
  terminalHtml(`<pre><span class="muted">Launching browser for: http://127.0.0.1:8765/</span>\n<span class="muted">Reading sitemap/robots routes...</span>\n   3 route(s) found through links + sitemap.\n\n[worker 1] [1] http://127.0.0.1:8765/            (2 queued)\n[worker 2] [2] http://127.0.0.1:8765/about.html  (1 queued)\n[worker 3] [3] http://127.0.0.1:8765/contact.html (0 queued)\n   <span class="ok">saved page + 2 referenced/runtime asset(s)</span></pre>`),
  folderHtml(),
];

await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
for (const [index, html] of terminalFrames.entries()) {
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: path.join(framesDir, `frame-${String(index + 1).padStart(2, "0")}.png`) });
}

await page.setViewport({ width: 960, height: 540, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:4174/", { waitUntil: "load", timeout: 15000 });
await page.screenshot({ path: path.join(framesDir, "frame-04.png") });

await browser.close();
console.log("captured frames and visual-report");

