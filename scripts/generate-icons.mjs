import { chromium } from '@playwright/test';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temp = join(root, '.cache/tmp');
await mkdir(temp, { recursive: true });
process.env.TEMP = temp; process.env.TMP = temp;
const output = join(root, '.cache/icon-exports');
await mkdir(output, { recursive: true });
const appSvg = await readFile(join(root, 'public/assets/app-icon.svg'), 'utf8');
const traySvg = await readFile(join(root, 'public/assets/app-mark.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  async function render(svg, size, target) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    await writeFile(target, png);
    return png;
  }
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) images.push(await render(appSvg, size, join(output, `icon-${size}.png`)));
  await render(appSvg, 512, join(output, 'icon-512.png'));
  for (const size of [16, 32, 64]) await render(traySvg, size, join(output, `tray-${size}.png`));
  // Windows ICO container with lossless RGBA PNG entries at each scale.
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((png, index) => {
    const at = 6 + index * 16;
    header[at] = sizes[index] === 256 ? 0 : sizes[index]; header[at + 1] = header[at];
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  const ico = Buffer.concat([header, ...images]);
  await writeFile(join(output, 'icon.ico'), ico);
  await writeFile(join(root, 'src-tauri/icons/icon.ico'), ico);
  await copyFile(join(output, 'icon-256.png'), join(root, 'src-tauri/icons/icon.png'));
  await copyFile(join(output, 'tray-64.png'), join(root, 'src-tauri/icons/tray.png'));
  console.log('Needle exported: multi-size ICO, PNGs, transparent tray and app assets.');
} finally { await browser.close(); }
