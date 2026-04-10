#!/usr/bin/env node
import puppeteer from "puppeteer";
import inquirer from "inquirer";
import fs from "fs";
import path from "path";
import os from "os";
import PDFDocument from "pdfkit";

async function createPDF(images, outputPath) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);
    for (const img of images) {
      const imgData = doc.openImage(img);
      doc.addPage({ size: [imgData.width, imgData.height] });
      doc.image(img, 0, 0);
    }
    doc.end();
    stream.on("finish", resolve);
  });
}

async function run() {
  console.clear();
  console.log("=========================================");
  console.log("📸  SIMPLE SCREENSHOTS - CLI MODE  📸");
  console.log("=========================================\n");

  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "title",
      message: "Project folder name:",
      validate: (input) => (input ? true : "Title is required"),
    },
    {
      type: "input",
      name: "url",
      message: "Target URL (include http/https):",
      validate: (input) =>
        input.startsWith("http") ? true : "Enter a valid URL",
    },
  ]);

  const { title, url } = answers;
  const baseDir = path.join(os.homedir(), "Documents", "screenshots");
  const targetDir = path.join(baseDir, title);
  const desktopDir = path.join(targetDir, "Desktop");
  const mobileDir = path.join(targetDir, "Mobile");

  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  [targetDir, desktopDir, mobileDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  try {
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();

    console.log(`\n⏳ Analyzing: ${url}`);
    await page.goto(url, { waitUntil: "networkidle2" });

    const routes = await page.evaluate((baseUrl) => {
      return Array.from(document.querySelectorAll("a"))
        .map((a) => a.href)
        .filter((href) => href.startsWith(baseUrl) && !href.includes("#"))
        .slice(0, 15);
    }, url);

    const uniqueRoutes = [...new Set([url, ...routes])];
    const desktopImages = [];
    const mobileImages = [];

    for (const route of uniqueRoutes) {
      const routeName = new URL(route).pathname.replace(/\//g, "_") || "home";
      console.log(`\n📄 Route: ${routeName}`);

      for (const type of ["desktop", "mobile"]) {
        const isMobile = type === "mobile";
        const width = isMobile ? 375 : 1920;
        const height = isMobile ? 812 : 1080;
        const currentDir = isMobile ? mobileDir : desktopDir;

        await page.setViewport({ width, height });
        await page.goto(route, { waitUntil: "networkidle2" });

        const filename = `${routeName}.png`;
        const filePath = path.join(currentDir, filename);

        await page.screenshot({ path: filePath, fullPage: true });
        (isMobile ? mobileImages : desktopImages).push(filePath);
        console.log(`   ✅ Captured ${type}`);
      }
    }

    await browser.close();

    console.log(`\n📦 Generating PDF reports...`);
    await createPDF(
      desktopImages,
      path.join(desktopDir, "full_report_desktop.pdf"),
    );
    await createPDF(
      mobileImages,
      path.join(mobileDir, "full_report_mobile.pdf"),
    );

    console.log(`\n✨ Done! Screenshots and PDFs saved in: ${targetDir}\n`);
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    process.exit(1);
  }
}

run();
