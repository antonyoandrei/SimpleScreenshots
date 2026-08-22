import path from "node:path";

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "ref",
  "referrer",
  "source",
]);

export function shortHash(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function sanitizeSegment(segment) {
  const clean = String(segment || "home")
    .replace(/[<>:\"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "_");
  if (clean.length <= 120) return clean || "_";
  return `${clean.slice(0, 96)}__${shortHash(clean)}`;
}

export function normalizedPageUrl(input) {
  const url = new URL(input);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith("utm_") || TRACKING_PARAMS.has(lowerKey)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.href;
}

export function comparableHost(hostname) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function isHttpOrFileUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:", "file:"].includes(url.protocol);
  } catch {
    return false;
  }
}

export function isSkippableUrl(url) {
  if (!["http:", "https:", "file:"].includes(url.protocol)) return true;
  return /\/(logout|signout|log-out|sign-out)(\/|$)/i.test(url.pathname);
}

export function routeFileName(url, usedNames = new Set()) {
  const parsed = new URL(url);
  const pieces = parsed.pathname.split("/").filter(Boolean).map(sanitizeSegment);
  let name = pieces.length ? pieces.join("_") : "home";
  if (parsed.search) name += `__q_${shortHash(parsed.search)}`;
  name = `${name}.png`;

  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }

  const extension = path.posix.extname(name);
  const unique = `${name.slice(0, -extension.length)}__${shortHash(parsed.href)}${extension}`;
  usedNames.add(unique);
  return unique;
}
