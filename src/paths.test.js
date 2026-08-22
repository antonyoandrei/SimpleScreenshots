import test from "node:test";
import assert from "node:assert/strict";
import { normalizedPageUrl, routeFileName } from "./paths.js";
import { mergeRoutes, routesFromManifest } from "./routes.js";

test("normalizes visual-audit routes consistently", () => {
  assert.equal(
    normalizedPageUrl("https://example.com/about?utm_campaign=x&b=2&a=1#team"),
    "https://example.com/about?a=1&b=2",
  );
});

test("manifest routes include the resolved start and deduplicate pages", () => {
  const routes = routesFromManifest({
    startUrl: "https://example.com/",
    finalStartUrl: "https://www.example.com/",
    pages: [
      { url: "https://example.com/about?b=2&a=1" },
      { url: "https://example.com/about?a=1&b=2#team" },
    ],
  }, 10);
  assert.deepEqual(routes, [
    "https://www.example.com/",
    "https://example.com/",
    "https://example.com/about?a=1&b=2",
  ]);
});

test("route filenames remain unique when paths collide", () => {
  const used = new Set();
  const first = routeFileName("https://example.com/a:b", used);
  const second = routeFileName("https://example.com/a_b", used);
  assert.equal(first, "a_b.png");
  assert.match(second, /^a_b__.+\.png$/);
});

test("merges link and sitemap routes without duplicates", () => {
  assert.deepEqual(
    mergeRoutes([
      ["https://example.com/", "https://example.com/about?utm_source=x"],
      ["https://example.com/about", "https://example.com/contact"],
    ], 10),
    ["https://example.com/", "https://example.com/about", "https://example.com/contact"],
  );
});
