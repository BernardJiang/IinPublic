/**
 * Prefix each browser tab's document.title during E2E so parallel runs are easy
 * to tell apart (worker index, spec file, current test title, role label).
 */
import * as path from 'path';
import type { Page, TestInfo } from '@playwright/test';

let specBasename = '';
let workerIndex = 0;
let testTitleShort = '';

export function setE2eBrowserTabTitleRunContext(info: TestInfo): void {
  specBasename = path.basename(info.file, path.extname(info.file));
  workerIndex = info.workerIndex;
  const t = info.title.trim();
  testTitleShort = t.length > 40 ? `${t.slice(0, 37)}…` : t;
}

export function clearE2eBrowserTabTitleRunContext(): void {
  specBasename = '';
  workerIndex = 0;
  testTitleShort = '';
}

function buildPrefix(roleLabel: string): string {
  const role = roleLabel.trim() || 'browser';
  if (!specBasename) return `[e2e] ${role}`;
  const mid = testTitleShort ? ` · ${testTitleShort}` : '';
  return `[w${workerIndex}] ${specBasename}${mid} · ${role}`;
}

const attachedPages = new WeakSet<Page>();

/**
 * Keep document.title prefixed for this page (main frame navigations + <title> mutations).
 */
export function attachE2eBrowserTabLabel(page: Page, roleLabel: string): void {
  if (attachedPages.has(page)) return;
  attachedPages.add(page);

  const install = () => {
    const mark = `${buildPrefix(roleLabel)} | `;
    void page
      .evaluate((m) => {
        const w = window as unknown as { __e2eTitleObs?: MutationObserver };
        w.__e2eTitleObs?.disconnect();

        const apply = () => {
          const t = document.title;
          if (!t.startsWith(m)) document.title = m + t;
        };
        apply();

        const titleEl = document.querySelector('title');
        if (titleEl) {
          const obs = new MutationObserver(apply);
          obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
          w.__e2eTitleObs = obs;
        }
      }, mark)
      .catch(() => {});
  };

  install();
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) install();
  });
}
