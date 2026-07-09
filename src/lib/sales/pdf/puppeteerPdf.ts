/**
 * Puppeteer PDF helper — uses system-installed Chrome on Windows.
 * Falls back to common install paths so no separate browser download is needed.
 *
 * The `puppeteer` npm package is NOT a dependency of this repo (deliberate —
 * only nodemailer + pdfmake were added by the sales port). It is loaded
 * lazily so the module can be imported safely everywhere; actually rendering
 * an HTML PDF (PI Quartz / PI Granite) requires `npm install puppeteer` on the
 * server and throws a clear, catchable error until then. The pdfmake-based
 * documents (commercial invoice, packing/stuffing lists, …) are unaffected.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");

function loadPuppeteer(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return eval("require")("puppeteer"); // eval keeps webpack from resolving an optional dep
  } catch {
    throw new Error(
      "PDF engine not installed: this document is rendered from HTML via puppeteer. Run `npm install puppeteer` on the server to enable it.",
    );
  }
}

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Users\\" + (process.env.USERNAME || "user") + "\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome(): string | undefined {
  return CHROME_PATHS.find((p) => fs.existsSync(p));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browser: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getBrowser(): Promise<any> {
  if (_browser && _browser.connected) return _browser;
  const puppeteer = loadPuppeteer();
  const executablePath = findChrome();
  const launchOpts: any = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  // Prefer a system Chrome/Edge (Windows paths above); otherwise let puppeteer
  // use its own bundled browser if one was downloaded at install time.
  if (executablePath) launchOpts.executablePath = executablePath;
  _browser = await puppeteer.launch(launchOpts);
  return _browser;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", right: "18mm", bottom: "18mm", left: "18mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}
