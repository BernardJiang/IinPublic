// Renders the app icon (taiji with a speech bubble in its centre) to every
// Android launcher PNG, and the desktop/web icons. Run: node scripts/gen-app-icons.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const INDIGO = '#40437a';
const AMBER = '#e5a036';
const CREAM = '#faf3ea';

// Taiji on a 1000x1000 disc centred at (500,500). `a` = upper/left colour, `b` = the other.
const taiji = (a, b) => `
  <circle cx="500" cy="500" r="500" fill="${a}"/>
  <path d="M500 0 A500 500 0 0 1 500 1000 A250 250 0 0 1 500 500 A250 250 0 0 0 500 0 Z" fill="${b}"/>
  <circle cx="500" cy="250" r="62" fill="${b}"/>
  <circle cx="500" cy="750" r="62" fill="${a}"/>`;

// Speech bubble in the centre of the disc; tail points down-left, inside the disc.
const BUBBLE = 'M350 372 h300 a60 60 0 0 1 60 60 v96 a60 60 0 0 1 -60 60 h-170 l-95 75 v-75 h-35 a60 60 0 0 1 -60 -60 v-96 a60 60 0 0 1 60 -60 z';
const disc = `
  <defs><clipPath id="b"><path d="${BUBBLE}"/></clipPath></defs>
  ${taiji(INDIGO, AMBER)}
  <path d="${BUBBLE}" fill="${CREAM}" stroke="${CREAM}" stroke-width="44" stroke-linejoin="round"/>
  <g clip-path="url(#b)">${taiji(AMBER, INDIGO)}</g>`;

// Layers: `scale` = disc diameter as a fraction of the canvas.
const svg = (size, { scale, bg, radius }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg ? `<rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>` : ''}
  <g transform="translate(${(size * (1 - scale)) / 2} ${(size * (1 - scale)) / 2}) scale(${(size * scale) / 1000})">${disc}</g></svg>`;

const root = path.resolve(import.meta.dirname, '..');
const res = path.join(root, 'android/app/src/main/res');
const dens = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function render(size, opts, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent">${svg(size, opts)}</body>`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true });
}

for (const [d, px] of Object.entries(dens)) {
  const dir = path.join(res, `mipmap-${d}`);
  await render(px * 2.25, { scale: 0.62 }, path.join(dir, 'ic_launcher_foreground.png')); // 108dp adaptive layer
  await render(px, { scale: 1, bg: CREAM, radius: px * 0.12 }, path.join(dir, 'ic_launcher.png'));
  await render(px, { scale: 1 }, path.join(dir, 'ic_launcher_round.png'));
}
await render(1024, { scale: 0.86, bg: CREAM, radius: 224 }, path.join(root, 'assets/icon/app-icon-1024.png'));
await render(1024, { scale: 1 }, path.join(root, 'assets/icon/app-icon-1024-transparent.png'));
await browser.close();
console.log('done');
