import fsp from "node:fs/promises";
import { isHttpOrFileUrl, isSkippableUrl, normalizedPageUrl, comparableHost } from "./paths.js";

export async function fetchText(url, { timeout = 15_000, userAgent } = {}) {
  if (!/^https?:/i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent": userAgent,
        Accept: "text/html,application/xml,text/xml,text/plain,*/*",
      },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function internalUrl(raw, primaryHost) {
  try {
    const url = new URL(raw);
    if (url.protocol === "file:") return true;
    return ["http:", "https:"].includes(url.protocol) && comparableHost(url.hostname) === comparableHost(primaryHost);
  } catch {
    return false;
  }
}

export function routesFromManifest(manifest, maxRoutes = 50) {
  const candidates = [manifest.finalStartUrl, manifest.startUrl, ...(manifest.pages || []).map((entry) => entry.url)];
  const routes = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || !isHttpOrFileUrl(candidate)) continue;
    try {
      const normalized = candidate.startsWith("file:") ? candidate : normalizedPageUrl(candidate);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      routes.push(normalized);
      if (routes.length >= maxRoutes) break;
    } catch {
      // Ignore malformed manifest entries.
    }
  }
  return routes;
}

export async function readManifest(manifestPath) {
  const contents = await fsp.readFile(manifestPath, "utf8");
  const manifest = JSON.parse(contents);
  if (!manifest || typeof manifest !== "object") throw new Error("Manifest must be a JSON object.");
  return manifest;
}

export async function discoverSitemapRoutes(startUrl, primaryHost, { maxSitemaps = 100, maxRoutes = 50, userAgent } = {}) {
  const start = new URL(startUrl);
  if (!/^https?:$/i.test(start.protocol)) return [];

  const sitemapQueue = [new URL("/sitemap.xml", start.origin).href];
  const seenSitemaps = new Set();
  const routes = new Set();
  const robots = await fetchText(new URL("/robots.txt", start.origin).href, { userAgent });
  if (robots) {
    for (const match of robots.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)) sitemapQueue.unshift(match[1]);
  }

  while (sitemapQueue.length && seenSitemaps.size < maxSitemaps && routes.size < maxRoutes) {
    const sitemapUrl = sitemapQueue.shift();
    if (!isHttpOrFileUrl(sitemapUrl) || seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);
    const xml = await fetchText(sitemapUrl, { userAgent });
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)]
      .map((match) => match[1].trim().replace(/&amp;/g, "&"))
      .filter(Boolean);
    if (/<sitemapindex[\s>]/i.test(xml)) {
      sitemapQueue.push(...locs);
      continue;
    }
    for (const loc of locs) {
      try {
        const normalized = normalizedPageUrl(loc);
        if (internalUrl(normalized, primaryHost)) routes.add(normalized);
        if (routes.size >= maxRoutes) break;
      } catch {
        // Ignore malformed sitemap entries.
      }
    }
  }
  return [...routes];
}

export async function discoverLinkedRoutes(page, startUrl, primaryHost, maxRoutes = 50) {
  const linked = await page.evaluate(() =>
    [...document.querySelectorAll("a[href]")].map((anchor) => anchor.href),
  );
  const routes = [];
  const seen = new Set();
  for (const raw of [startUrl, ...linked]) {
    try {
      const url = new URL(raw, startUrl);
      if (isSkippableUrl(url) || !internalUrl(url.href, primaryHost)) continue;
      const normalized = url.protocol === "file:" ? url.href : normalizedPageUrl(url.href);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      routes.push(normalized);
      if (routes.length >= maxRoutes) break;
    } catch {
      // Ignore malformed links.
    }
  }
  return routes;
}

export function mergeRoutes(routeGroups, maxRoutes) {
  const routes = [];
  const seen = new Set();
  for (const group of routeGroups) {
    for (const raw of group || []) {
      try {
        const normalized = raw.startsWith("file:") ? raw : normalizedPageUrl(raw);
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        routes.push(normalized);
        if (routes.length >= maxRoutes) return routes;
      } catch {
        // Ignore malformed route candidates.
      }
    }
  }
  return routes;
}
