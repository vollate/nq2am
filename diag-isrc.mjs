import { chromium } from "playwright";
import { loadCookies } from "./dist/src/fetchers/auth.js";

const cookies = await loadCookies("apple");
const userToken = cookies?.find((c) => c.name === "media-user-token")?.value;
if (!userToken) {
  console.error("no apple token");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies(cookies);
const page = await context.newPage();

let dev;
page.on("request", (req) => {
  const a = req.headers().authorization;
  if (!dev && req.url().includes("api.music.apple.com") && a?.startsWith("Bearer ")) dev = a.slice(7);
});
await page.goto("https://music.apple.com/", { waitUntil: "domcontentloaded" });
for (let i = 0; i < 20 && !dev; i++) await page.waitForTimeout(500);
console.log("dev token captured:", !!dev, "\n");

async function call(path) {
  return page.evaluate(
    async ({ path, dev, userToken }) => {
      const res = await fetch(`https://amp-api.music.apple.com${path}`, {
        headers: { Authorization: `Bearer ${dev}`, "Music-User-Token": userToken },
      });
      const text = await res.text();
      return { status: res.status, text };
    },
    { path, dev, userToken },
  );
}

const term = encodeURIComponent("Burn My Dread 川村ゆみ");

// account storefront
const sf = await call("/v1/me/storefront");
console.log("=== storefront ===\n", sf.text.slice(0, 400), "\n");

// search in JP (native) to grab an ISRC
const jp = await call(`/v1/catalog/jp/search?types=songs&term=${term}&limit=3`);
const jpJson = JSON.parse(jp.text);
const jpSong = jpJson?.results?.songs?.data?.[0];
const isrc = jpSong?.attributes?.isrc;
console.log("jp top:", jpSong?.attributes?.name, "/", jpSong?.attributes?.artistName, "/", jpSong?.attributes?.albumName);
console.log("jp id:", jpSong?.id, "| isrc:", isrc, "\n");

if (isrc) {
  // filter[isrc] in the ACCOUNT store (tr) — the critical test
  const tr = await call(`/v1/catalog/tr/songs?filter[isrc]=${isrc}&limit=10`);
  console.log("=== tr filter[isrc] status", tr.status, "===");
  try {
    const d = JSON.parse(tr.text);
    for (const s of d.data ?? []) {
      console.log(`  tr id=${s.id} name="${s.attributes.name}" artist="${s.attributes.artistName}" album="${s.attributes.albumName}"`);
    }
    if (!(d.data ?? []).length) console.log("  (no data)", tr.text.slice(0, 300));
  } catch {
    console.log("  parse err:", tr.text.slice(0, 300));
  }

  // filter[isrc] in us for comparison
  const us = await call(`/v1/catalog/us/songs?filter[isrc]=${isrc}&limit=10`);
  console.log("\n=== us filter[isrc] status", us.status, "===");
  try {
    const d = JSON.parse(us.text);
    for (const s of d.data ?? []) {
      console.log(`  us id=${s.id} name="${s.attributes.name}" artist="${s.attributes.artistName}"`);
    }
  } catch {
    console.log("  parse err:", us.text.slice(0, 200));
  }
}

await browser.close();
