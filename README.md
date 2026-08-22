# SimpleScreenshots 2

Visual audit companion for [SimpleScraper](../scraper). It discovers routes from links plus `robots.txt`/sitemaps, or consumes a `mirror-manifest.json`, then captures every route in configurable viewports with reusable Chromium workers.

## Install

Requires Node.js 20+.

```bash
npm install
npm link
```

## Usage

Interactive mode:

```bash
simplescreenshots
```

Direct URL mode:

```bash
simplescreenshots \
  --url https://example.com \
  --title example-audit \
  --viewports desktop:1440x1100,mobile:390x844 \
  --concurrency 3
```

Audit routes already discovered by SimpleScraper:

```bash
simplescreenshots \
  --manifest ../scraper/mirror-manifest.json \
  --output ./artifacts/example-audit
```

Each run produces a portable folder with viewport directories, PNGs, `screenshots-manifest.json`, optional PDFs and `visual-report.html`.

## Options

```text
--url <url>                 Crawl a public site from this URL
--manifest <file>           Use routes from mirror-manifest.json
--title <name>              Project name
--output <dir>              Exact output directory
--viewports <list>          desktop:1920x1080,mobile:375x812
--concurrency <n>           Reused browser tabs/workers (default: 3)
--max-routes <n>            Route safety limit (default: 50)
--wait <strategy>           domcontentloaded, load, networkidle0 or networkidle2
--cookies <file>            JSON array of Puppeteer cookies
--fast / --full             Wait and lazy-content preset
--no-pdf                    Skip PDF reports
--no-html                   Skip the visual HTML report
-h, --help                  Show help
```

Viewport entries use `name:WIDTHxHEIGHT`, with an optional device pixel ratio:

```bash
simplescreenshots --url https://example.com \
  --viewports desktop:1920x1080@1,mobile:390x844@2,tablet:1024x1366
```

Cookie files are JSON arrays accepted by Puppeteer, for example:

```json
[
  {"name":"session","value":"…","domain":"example.com","path":"/"}
]
```

## Reports

`visual-report.html` is a browsable visual board with one route per section and one image per viewport. PDFs are written inside each viewport directory as `full_report_<viewport>.pdf`. The JSON manifest records routes, captures, errors, wait strategy and worker statistics.

## Development

```bash
npm test
npm run check
```

Only capture sites and assets you have permission to inspect and reuse.
