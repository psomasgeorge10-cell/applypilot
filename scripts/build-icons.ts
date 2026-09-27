/**
 * Regenerates the app icons in assets/ (and the site favicon) from
 * assets/applypilot.svg:
 *
 *   CHROMIUM_PATH=/path/to/chrome npx tsx scripts/build-icons.ts
 *
 * Chromium renders the SVG at every size; the Windows .ico and macOS .icns
 * containers are then assembled by hand - both formats can hold PNG images
 * directly, so no image library is needed.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const SVG = readFileSync("assets/applypilot.svg", "utf8");

async function renderAll(sizes: number[], inset = 0): Promise<Map<number, Buffer>> {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const page = await browser.newPage();
  const images = new Map<number, Buffer>();
  for (const size of sizes) {
    const pad = Math.round(size * inset);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent">
         <div style="width:${size}px;height:${size}px;padding:${pad}px;box-sizing:border-box">
           ${SVG.replace("<svg ", '<svg width="100%" height="100%" ')}
         </div>
       </body>`,
    );
    images.set(size, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }));
  }
  await browser.close();
  return images;
}

/** ICO with PNG-compressed entries (supported since Windows Vista). */
function packIco(images: Map<number, Buffer>): Buffer {
  const entries = [...images.entries()];
  const header = Buffer.alloc(6 + entries.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  let offset = header.length;
  entries.forEach(([size, png], index) => {
    const at = 6 + index * 16;
    header.writeUInt8(size >= 256 ? 0 : size, at); // 0 means 256
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt8(0, at + 2); // palette size
    header.writeUInt8(0, at + 3); // reserved
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...entries.map(([, png]) => png)]);
}

/** ICNS with PNG entries, keyed by the OSType each pixel size is stored under. */
function packIcns(images: Map<number, Buffer>): Buffer {
  const types: [string, number][] = [
    ["icp4", 16],
    ["icp5", 32],
    ["ic11", 32], // 16pt @2x
    ["icp6", 64],
    ["ic12", 64], // 32pt @2x
    ["ic07", 128],
    ["ic08", 256],
    ["ic13", 256], // 128pt @2x
    ["ic09", 512],
    ["ic14", 512], // 256pt @2x
    ["ic10", 1024], // 512pt @2x
  ];
  const chunks = types.map(([type, size]) => {
    const png = images.get(size)!;
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

async function main() {
  const flat = await renderAll([16, 24, 32, 48, 64, 128, 256, 512]);
  writeFileSync("assets/applypilot.ico", packIco(new Map([16, 24, 32, 48, 64, 128, 256].map((s) => [s, flat.get(s)!]))));
  writeFileSync("assets/applypilot.png", flat.get(512)!);
  writeFileSync("src/app/favicon.ico", packIco(new Map([16, 32, 48].map((s) => [s, flat.get(s)!]))));

  // macOS icons sit inside a transparent margin (Apple's icon grid) so they
  // match the size of other apps in the Dock and Finder.
  writeFileSync("assets/applypilot.icns", packIcns(await renderAll([16, 32, 64, 128, 256, 512, 1024], 0.1)));
  console.log("Icons written to assets/ and src/app/favicon.ico");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
