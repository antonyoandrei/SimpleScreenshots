import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./cli.js";

test("parses custom viewports and preserves URL query values", () => {
  const options = parseArgs([
    "--url=https://example.com/?a=1&b=2",
    "--viewports=desktop:1200x900,mobile:390x844@2",
    "--concurrency=4",
  ], {});
  assert.equal(options.url, "https://example.com/?a=1&b=2");
  assert.equal(options.concurrency, 4);
  assert.deepEqual(options.viewports, [
    { name: "desktop", width: 1200, height: 900, deviceScaleFactor: 1 },
    { name: "mobile", width: 390, height: 844, deviceScaleFactor: 2 },
  ]);
});

test("rejects simultaneous URL and manifest inputs", () => {
  assert.throws(
    () => parseArgs(["--url", "https://example.com", "--manifest", "mirror-manifest.json"], {}),
    /either --url or --manifest/,
  );
});
