#!/usr/bin/env node
import puppeteer from "puppeteer";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  parseArgs,
  resolveInteractiveInput,
  createRuntimeConfig,
  helpText,
} from "./src/cli.js";
import {
  discoverLinkedRoutes,
  discoverSitemapRoutes,
  mergeRoutes,
  readManifest,
  routesFromManifest,
} from "./src/routes.js";
import { routeFileName } from "./src/paths.js";
import { createPDF, writeVisualReport } from "./src/reports.js";

function browserViewport(viewport) {
  const { name, ...settings } = viewport;
  return settings;
}

async function exposeInteractiveContent(page) {
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const text = (element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const consentPattern = /^(accept all|accept cookies|agree|allow all|accept|aceptar todo|aceptar todas|aceptar cookies|permitir todo|tout accepter|alle akzeptieren)$/i;
    const roots = [
      ...document.querySelectorAll(
        "[id*='cookie' i],[class*='cookie' i],[id*='consent' i],[class*='consent' i],[id*='cmp' i],[class*='cmp' i]",
      ),
    ];
    for (const root of roots.slice(0, 20)) {
      const button = [...root.querySelectorAll("button,[role='button'],input[type='button']")]
        .find((element) => consentPattern.test(text(element)));
      if (button) {
        button.click();
        await sleep(250);
        break;
      }
    }

    const expanders = [
      ...document.querySelectorAll("button[aria-expanded='false'][aria-controls],[role='button'][aria-expanded='false'][aria-controls]"),
    ].slice(0, 80);
    for (const element of expanders) {
      if (element instanceof HTMLAnchorElement && element.hasAttribute("href")) continue;
      element.click();
      await sleep(60);
    }
  });
}

async function autoScroll(page, timeout) {
  await page.evaluate(() => {
    document.querySelectorAll("img[loading='lazy'],iframe[loading='lazy']").forEach((element) => {
      element.setAttribute("loading", "eager");
    });
    document.querySelectorAll("details").forEach((element) => {
      element.open = true;
    });
  });

  const started = Date.now();
  let stableRounds = 0;
  let previousHeight = 0;
  while (Date.now() - started < timeout && stableRounds < 3) {
    const metrics = await page.evaluate(() => {
      const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
      window.scrollBy(0, Math.max(window.innerHeight * 0.85, 500));
      return { height, y: window.scrollY, viewport: window.innerHeight };
    });
    if (metrics.height === previousHeight && metrics.y + metrics.viewport >= metrics.height - 10) stableRounds += 1;
    else stableRounds = 0;
    previousHeight = metrics.height;
    await new Promise((resolve) => setTimeout(resolve, 180));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function preparePage(page, url, config) {
  await page.goto(url, { waitUntil: config.waitUntil, timeout: config.pageTimeout });
  try {
    await page.waitForNetworkIdle({
      idleTime: config.mode === "fast" ? 350 : 750,
      timeout: config.networkIdleTimeout,
    });
  } catch {
    // Long-polling pages are still valid screenshot targets.
  }
  await exposeInteractiveContent(page);
  await autoScroll(page, config.scrollTimeout);
  await exposeInteractiveContent(page);
  try {
    await page.waitForNetworkIdle({
      idleTime: config.mode === "fast" ? 250 : 500,
      timeout: config.afterNetworkIdleTimeout,
    });
  } catch {
    // Best effort after lazy content.
  }
}

async function loadCookies(cookiePath) {
  if (!cookiePath) return [];
  const value = JSON.parse(await fsp.readFile(path.resolve(cookiePath), "utf8"));
  if (!Array.isArray(value)) throw new Error("Cookie file must contain a JSON array.");
  return value;
}

async function discoverRoutes(browser, source, config) {
  const page = await browser.newPage();
  await page.setUserAgent(config.userAgent);
  await page.setViewport(browserViewport(config.viewports[0]));
  page.setDefaultNavigationTimeout(config.pageTimeout);
  try {
    await page.goto(source, { waitUntil: config.waitUntil, timeout: config.pageTimeout });
    const resolvedStart = page.url();
    const primaryHost = new URL(resolvedStart).hostname;
    await exposeInteractiveContent(page);
    await autoScroll(page, config.scrollTimeout);
    await exposeInteractiveContent(page);
    const linkedRoutes = await discoverLinkedRoutes(
      page,
      resolvedStart,
      primaryHost,
      Math.min(config.maxRoutes, 20),
    );
    const sitemapRoutes = await discoverSitemapRoutes(resolvedStart, primaryHost, {
      maxRoutes: config.maxRoutes,
      userAgent: config.userAgent,
    });
    return {
      startUrl: resolvedStart,
      primaryHost,
      routes: mergeRoutes([linkedRoutes, sitemapRoutes], config.maxRoutes),
    };
  } finally {
    await page.close();
  }
}

async function run() {
  let options;
  try {
    options = parseArgs();
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    console.log(helpText());
    return;
  }

  let input;
  try {
    input = await resolveInteractiveInput(options);
  } catch (error) {
    console.error(`\n❌ ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const config = createRuntimeConfig(options, input);
  const startedAt = Date.now();
  let browser;
  const errors = [];

  try {
    const cookieValues = await loadCookies(config.cookies);
    let sourceManifest = null;
    let startUrl = config.source;
    let primaryHost;
    let routes;

    console.log("=========================================");
    console.log(`📸  SIMPLE SCREENSHOTS - ${config.mode.toUpperCase()}  📸`);
    console.log("=========================================\n");

    browser = await puppeteer.launch({
      headless: true,
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });

    if (options.manifest) {
      sourceManifest = await readManifest(path.resolve(options.manifest));
      routes = routesFromManifest(sourceManifest, config.maxRoutes);
      startUrl = sourceManifest.finalStartUrl || sourceManifest.startUrl || routes[0];
      if (!routes.length) throw new Error("The manifest does not contain any usable page URLs.");
      primaryHost = new URL(startUrl).hostname;
      console.log(`🧭 Loaded ${routes.length} route(s) from manifest: ${options.manifest}`);
    } else {
      console.log(`🧭 Discovering routes from: ${startUrl}`);
      const discovered = await discoverRoutes(browser, startUrl, config);
      startUrl = discovered.startUrl;
      primaryHost = discovered.primaryHost;
      routes = discovered.routes;
      console.log(`   ${routes.length} route(s) found through links + robots/sitemap.`);
    }

    if (!routes.length) throw new Error("No routes were discovered.");

    await fsp.mkdir(path.dirname(config.targetDir), { recursive: true });
    await fsp.rm(config.targetDir, { recursive: true, force: true });
    await fsp.mkdir(config.targetDir, { recursive: true });
    for (const viewport of config.viewports) {
      await fsp.mkdir(path.join(config.targetDir, viewport.name), { recursive: true });
    }

    const usedFileNames = new Set();
    const routeFiles = new Map(routes.map((route) => [route, routeFileName(route, usedFileNames)]));
    const capturesByRoute = new Map();
    const stats = { started: 0, completed: 0, screenshotsSaved: 0 };
    let nextRouteIndex = 0;

    const runWorker = async (workerId) => {
      const page = await browser.newPage();
      await page.setUserAgent(config.userAgent);
      await page.setViewport(browserViewport(config.viewports[0]));
      page.setDefaultNavigationTimeout(config.pageTimeout);
      if (cookieValues.length) {
        try {
          await page.setCookie(...cookieValues);
        } catch (error) {
          errors.push({ url: "cookies", error: error.message });
        }
      }

      try {
        while (true) {
          const routeIndex = nextRouteIndex;
          nextRouteIndex += 1;
          if (routeIndex >= routes.length) break;
          const route = routes[routeIndex];
          stats.started += 1;
          const capture = { route, screenshots: [] };
          console.log(`\n[worker ${workerId}] [${stats.started}/${routes.length}] ${route}`);

          for (const viewport of config.viewports) {
            const fileName = routeFiles.get(route);
            const relativePath = `${viewport.name}/${fileName}`;
            const outputPath = path.join(config.targetDir, viewport.name, fileName);
            try {
              await page.setViewport(browserViewport(viewport));
              await preparePage(page, route, config);
              await page.screenshot({ path: outputPath, fullPage: true, captureBeyondViewport: true });
              capture.screenshots.push({
                viewport: viewport.name,
                relativePath,
                path: outputPath,
              });
              stats.screenshotsSaved += 1;
              console.log(`   ✓ ${viewport.name}`);
            } catch (error) {
              errors.push({ route, viewport: viewport.name, error: error.message });
              console.log(`   ⚠ ${viewport.name}: ${error.message}`);
            }
          }

          capturesByRoute.set(route, capture);
          stats.completed += 1;
          console.log(`   progress: ${stats.completed}/${routes.length} route(s), ${stats.screenshotsSaved} screenshot(s)`);
        }
      } finally {
        await page.close();
      }
    };

    await Promise.all(
      Array.from({ length: config.concurrency }, (_, index) => runWorker(index + 1)),
    );

    const captures = routes.map((route) => capturesByRoute.get(route) || { route, screenshots: [] });
    const summary = {
      routesDiscovered: routes.length,
      routesCaptured: captures.filter((capture) => capture.screenshots.length > 0).length,
      screenshotsSaved: stats.screenshotsSaved,
      errors: errors.length,
      durationMs: Date.now() - startedAt,
      waitUntil: config.waitUntil,
      mode: config.mode,
      pageConcurrency: config.concurrency,
      primaryHost,
    };
    const outputManifest = {
      createdAt: new Date().toISOString(),
      source: config.source,
      resolvedStartUrl: startUrl,
      inputType: options.manifest ? "manifest" : "url",
      routes,
      viewports: config.viewports,
      captures: captures.map((capture) => ({
        route: capture.route,
        screenshots: capture.screenshots.map(({ path: ignored, ...image }) => image),
      })),
      errors,
      summary,
    };

    await fsp.writeFile(
      path.join(config.targetDir, "screenshots-manifest.json"),
      JSON.stringify(outputManifest, null, 2),
      "utf8",
    );

    if (!config.noPdf) {
      console.log("\n📦 Generating PDF reports...");
      for (const viewport of config.viewports) {
        const images = captures.flatMap((capture) =>
          capture.screenshots
            .filter((image) => image.viewport === viewport.name)
            .map((image) => image.path),
        );
        await createPDF(images, path.join(config.targetDir, viewport.name, `full_report_${viewport.name}.pdf`));
      }
    }

    if (!config.noHtml) {
      await writeVisualReport(config.targetDir, {
        title: config.title,
        source: config.source,
        routes,
        viewports: config.viewports,
        captures: outputManifest.captures,
        errors,
        summary,
      });
    }

    console.log("\n✨ Visual audit finished");
    console.log(`📄 Routes: ${summary.routesCaptured}/${summary.routesDiscovered}`);
    console.log(`🖼️  Screenshots: ${summary.screenshotsSaved}`);
    console.log(`⚠️  Errors: ${summary.errors}`);
    console.log(`📂 Folder: ${config.targetDir}`);
    if (!config.noHtml) console.log("▶ Review: open visual-report.html");
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    errors.push({ url: "fatal", error: error.message });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

run();
