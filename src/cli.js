import inquirer from "inquirer";
import os from "node:os";
import path from "node:path";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const DEFAULT_VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080, deviceScaleFactor: 1 },
  { name: "mobile", width: 375, height: 812, deviceScaleFactor: 1 },
];

function integer(value, name, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseViewports(value) {
  if (!value) return DEFAULT_VIEWPORTS;
  const viewports = value.split(",").map((entry) => {
    const match = /^([^:=]+)[:=](\d+)x(\d+)(?:@(\d+(?:\.\d+)?))?$/.exec(entry.trim());
    if (!match) throw new Error(`Invalid viewport "${entry}". Use name:WIDTHxHEIGHT[@DPR].`);
    return {
      name: match[1].trim().replace(/[^a-z0-9_-]+/gi, "-").toLowerCase(),
      width: integer(match[2], "viewport width", { min: 240, max: 8_000 }),
      height: integer(match[3], "viewport height", { min: 240, max: 8_000 }),
      deviceScaleFactor: Number(match[4] || 1),
    };
  });
  const names = new Set();
  for (const viewport of viewports) {
    if (!viewport.name || names.has(viewport.name)) throw new Error("Viewport names must be unique and non-empty.");
    names.add(viewport.name);
  }
  return viewports;
}

function valueFor(argv, index, flag, inlineValue) {
  if (inlineValue !== undefined) return inlineValue;
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return next;
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    help: false,
    mode: env.SIMPLESCREENSHOTS_MODE === "fast" ? "fast" : "full",
    title: null,
    url: null,
    manifest: null,
    output: null,
    cookies: null,
    maxRoutes: Number(env.SIMPLESCREENSHOTS_MAX_ROUTES || 50),
    concurrency: Number(env.SIMPLESCREENSHOTS_CONCURRENCY || 3),
    viewports: parseViewports(env.SIMPLESCREENSHOTS_VIEWPORTS),
    waitUntil: "networkidle2",
    noPdf: false,
    noHtml: false,
  };
  options.maxRoutes = integer(options.maxRoutes, "max-routes", { min: 1, max: 10_000 });
  options.concurrency = integer(options.concurrency, "concurrency", { min: 1, max: 16 });

  const valueFlags = new Set([
    "--title",
    "--url",
    "--manifest",
    "--output",
    "--cookies",
    "--max-routes",
    "--concurrency",
    "--viewports",
    "--wait",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const separator = argument.indexOf("=");
    const flag = separator === -1 ? argument : argument.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : argument.slice(separator + 1);
    if (argument === "-h" || argument === "--help") {
      options.help = true;
      continue;
    }
    if (argument === "--fast") {
      options.mode = "fast";
      continue;
    }
    if (argument === "--full") {
      options.mode = "full";
      continue;
    }
    if (argument === "--no-pdf") {
      options.noPdf = true;
      continue;
    }
    if (argument === "--no-html") {
      options.noHtml = true;
      continue;
    }
    if (!valueFlags.has(flag)) throw new Error(`Unknown option: ${argument}`);
    const value = valueFor(argv, index, flag, inlineValue);
    if (inlineValue === undefined) index += 1;
    if (flag === "--title") options.title = value;
    if (flag === "--url") options.url = value;
    if (flag === "--manifest") options.manifest = value;
    if (flag === "--output") options.output = value;
    if (flag === "--cookies") options.cookies = value;
    if (flag === "--max-routes") options.maxRoutes = integer(value, flag, { min: 1, max: 10_000 });
    if (flag === "--concurrency") options.concurrency = integer(value, flag, { min: 1, max: 16 });
    if (flag === "--viewports") options.viewports = parseViewports(value);
    if (flag === "--wait") {
      if (!["domcontentloaded", "load", "networkidle0", "networkidle2"].includes(value)) {
        throw new Error("--wait must be domcontentloaded, load, networkidle0 or networkidle2.");
      }
      options.waitUntil = value;
    }
  }
  if (options.manifest && options.url) throw new Error("Use either --url or --manifest, not both.");
  return options;
}

export function sanitizeTitle(value) {
  return value.trim().replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_");
}

export async function resolveInteractiveInput(options) {
  if (options.manifest || options.url) {
    const manifestName = options.manifest
      ? path.basename(options.manifest, path.extname(options.manifest))
      : "visual-audit";
    return { title: sanitizeTitle(options.title || manifestName), source: options.manifest || options.url };
  }
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "title",
      message: "Project folder name:",
      validate: (input) => (input.trim() ? true : "Title is required"),
    },
    {
      type: "input",
      name: "url",
      message: "Target URL (include http/https):",
      validate: (input) => {
        try {
          const url = new URL(input.trim());
          return ["http:", "https:"].includes(url.protocol) ? true : "Enter a valid http/https URL";
        } catch {
          return "Enter a valid http/https URL";
        }
      },
    },
  ]);
  return { title: sanitizeTitle(answers.title), source: answers.url.trim() };
}

export function createRuntimeConfig(options, input) {
  const baseDir = path.join(os.homedir(), "Documents", "screenshots");
  const targetDir = options.output ? path.resolve(options.output) : path.join(baseDir, input.title);
  const fast = options.mode === "fast";
  return {
    ...options,
    title: input.title,
    source: input.source,
    targetDir,
    desktopDir: path.join(targetDir, "desktop"),
    mobileDir: path.join(targetDir, "mobile"),
    pageTimeout: 45_000,
    networkIdleTimeout: fast ? 2_500 : 8_000,
    scrollTimeout: fast ? 5_000 : 15_000,
    afterNetworkIdleTimeout: fast ? 750 : 3_000,
    userAgent: USER_AGENT,
  };
}

export function helpText() {
  return `SimpleScreenshots — visual audit companion for SimpleScraper

Usage:
  simplescreenshots [options]

Inputs:
  --url <url>                 Crawl a public site from this URL
  --manifest <file>           Use routes from mirror-manifest.json
  --title <name>              Project name
  --output <dir>              Exact output directory

Capture:
  --viewports <list>          desktop:1920x1080,mobile:375x812
  --concurrency <n>           Reused browser tabs/workers (default: 3)
  --max-routes <n>            Route safety limit (default: 50)
  --wait <strategy>           domcontentloaded, load, networkidle0 or networkidle2
  --cookies <file>            JSON array of Puppeteer cookies
  --fast                      Shorter wait/scroll strategy
  --full                      Full wait/scroll strategy (default)
  --no-pdf                    Skip PDF reports
  --no-html                   Skip the visual HTML report
  -h, --help                  Show this help
`;
}
