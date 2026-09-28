// Renders Play Console's required 1024x500 "Feature graphic" (Store listing > Graphics).
// Reuses the exact taiji/speech-bubble mark and brand colors from gen-app-icons.mjs so the
// listing matches the app icon and in-app branding. Run: node scripts/gen-play-feature-graphic.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const INDIGO = '#40437a';
const AMBER = '#e5a036';
const CREAM = '#faf3ea';

const taiji = (a, b) => `
  <circle cx="500" cy="500" r="500" fill="${a}"/>
  <path d="M500 0 A500 500 0 0 1 500 1000 A250 250 0 0 1 500 500 A250 250 0 0 0 500 0 Z" fill="${b}"/>
  <circle cx="500" cy="250" r="62" fill="${b}"/>
  <circle cx="500" cy="750" r="62" fill="${a}"/>`;

const BUBBLE = 'M350 372 h300 a60 60 0 0 1 60 60 v96 a60 60 0 0 1 -60 60 h-170 l-95 75 v-75 h-35 a60 60 0 0 1 -60 -60 v-96 a60 60 0 0 1 60 -60 z';
const disc = `
  <defs><clipPath id="b"><path d="${BUBBLE}"/></clipPath></defs>
  ${taiji(INDIGO, AMBER)}
  <path d="${BUBBLE}" fill="${CREAM}" stroke="${CREAM}" stroke-width="44" stroke-linejoin="round"/>
  <g clip-path="url(#b)">${taiji(AMBER, INDIGO)}</g>`;

const W = 1024, H = 500;
const discSize = 420;
const discX = 46, discY = (H - discSize) / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <g transform="translate(${discX} ${discY}) scale(${discSize / 1000})">${disc}</g>
  <g font-family="-apple-system, 'Helvetica Neue', Arial, sans-serif">
    <text x="530" y="235" font-size="76" font-weight="700" fill="${INDIGO}">IinPublic</text>
    <text x="532" y="295" font-size="32" font-weight="500" fill="${AMBER}">Build your digital you.</text>
    <text x="532" y="335" font-size="24" fill="#5a5652">Answer once. Your chatbot repeats you.</text>
  </g>
</svg>`;

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'assets/icon/play-store-feature-graphic-1024x500.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0">${svg}</body>`);
fs.mkdirSync(path.dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
