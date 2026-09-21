/**
 * Manual list pins: Contacts, Talks, and Me questions/answers all expose the same
 * user-facing pin/unpin interaction. A pin must override the list's active sort,
 * survive a full page reload, and unpin back into the underlying sort order.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { gotoWebApp, injectIdbClear } from '../../helpers/clear-database';
import { clearGunForStage1Spec } from '../../helpers/e2e-stage-pipeline';
import { afterAction, afterNav } from '../../helpers/timing';
import { webBaseURL } from '../../helpers/ports';

test.describe('manual pins across Contacts, Talks, and Me', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    await clearGunForStage1Spec();
    context = await browser.newContext({ viewport: { width: 960, height: 1200 } });
    page = await context.newPage();
    await injectIdbClear(page);
    await gotoWebApp(page, webBaseURL());
  });

  test.afterEach(async () => {
    await page?.evaluate(() => (window as any).__iinpublic_app?.getApp?.()?.manualCleanup?.()).catch(() => {});
    await context?.close().catch(() => {});
    await clearGunForStage1Spec();
  });

  async function seedAllThreeLists(): Promise<void> {
    await page.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      const authorId = String(app?.currentUser?.id || 'pin-e2e-user');
      const newest = '2026-09-20T12:00:00.000Z';
      const oldest = '2026-09-19T12:00:00.000Z';

      localStorage.removeItem('iinpublic_list_pins_v1');
      localStorage.removeItem('iinpublic_contacts_tab_state');
      localStorage.removeItem('iinpublic_talks_tab_state');
      localStorage.setItem('localTalkExchanges', JSON.stringify({
        'pin-contact-new::pin-contact-talk-new': {
          peerId: 'pin-contact-new', peerName: 'Newer Contact', talkId: 'pin-contact-talk-new',
          title: 'Newer contact exchange', direction: 'received', outcome: 'match', type: 'flow',
          language: 'en', date: newest,
        },
        'pin-contact-old::pin-contact-talk-old': {
          peerId: 'pin-contact-old', peerName: 'Older Contact', talkId: 'pin-contact-talk-old',
          title: 'Older contact exchange', direction: 'received', outcome: 'match', type: 'flow',
          language: 'en', date: oldest,
        },
      }));

      const makeTalk = (id: string, title: string, lastInteraction: string) => {
        const fullTalk = {
          id, authorId, title, type: 'flow', language: 'en', isAdult: false,
          createdAt: lastInteraction,
          questions: [{
            id: `${id}-q`, text: 'Pin this talk?',
            answers: [
              { id: `${id}-yes`, text: 'Yes', isMatch: true, isTerminal: true },
              { id: `${id}-no`, text: 'No', isIgnore: true, isTerminal: true },
            ],
          }],
        };
        return {
          id, talkId: id, role: 'created', title, type: 'flow', language: 'en',
          timestamp: lastInteraction, createdAt: lastInteraction, lastInteraction,
          status: 'OUT', stats: { responses: 0, matched: 0 }, disabled: false, fullTalk,
        };
      };
      localStorage.setItem('myTalks', JSON.stringify({
        'pin-talk-new': makeTalk('pin-talk-new', 'Newer Talk', newest),
        'pin-talk-old': makeTalk('pin-talk-old', 'Older Talk', oldest),
      }));

      const makeHistory = (
        id: string,
        talkId: string,
        questionId: string,
        prompt: string,
        choice: string,
        answeredAt: string,
      ) => ({
        id, talkId, title: `${prompt} source`, type: 'flow', language: 'en', outcome: 'match',
        answeredAt, senderIds: [],
        items: [{
          questionId, answerId: `${questionId}-answer`, prompt, choice, kind: 'question',
          contextLabel: '', contextPath: [], contextHash: '',
        }],
      });
      localStorage.setItem('myAnswerHistory', JSON.stringify({
        'pin-answer-new-history': makeHistory(
          'pin-answer-new-history', 'pin-answer-new-talk', 'pin-answer-new',
          'Newer question?', 'Newer answer', newest,
        ),
        'pin-answer-old-history': makeHistory(
          'pin-answer-old-history', 'pin-answer-old-talk', 'pin-answer-old',
          'Older question?', 'Older answer', oldest,
        ),
      }));
    });
  }

  const ordinaryContacts = () => page.locator('#contacts-list .contact-item:not([data-support-contact="true"])');
  const outgoingTalks = () => page.locator('#talks-list .talk-list-item[data-role="created"]');
  const answerRows = () => page.locator('#answers-list .answer-talk-item');

  async function openContacts(): Promise<void> {
    await page.locator('.nav-btn[data-view="contacts"]').click();
    await afterNav();
    await page.locator('#contacts-sort-order').selectOption('recent');
    await expect(ordinaryContacts()).toHaveCount(2);
  }

  async function openOutgoingTalks(): Promise<void> {
    await page.locator('.nav-btn[data-view="talks"]').click();
    await afterNav();
    await page.locator('#talks-filter-incoming').uncheck();
    await page.locator('#talks-filter-outgoing').check();
    await page.locator('#talks-out-sort-order').selectOption('recent');
    await expect(outgoingTalks()).toHaveCount(2);
  }

  async function openAnswers(): Promise<void> {
    await page.locator('.nav-btn[data-view="me"]').click();
    await afterNav();
    await page.locator('#me-answer-sort').selectOption('answered-desc');
    await expect(answerRows()).toHaveCount(2);
  }

  test('pins, persists, and unpins rows in all three tabs', async () => {
    await seedAllThreeLists();

    await openContacts();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-new');
    await page.locator('[data-contact-user-id="pin-contact-old"] .contact-pin-button').click();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-old');
    await expect(page.locator('[data-contact-user-id="pin-contact-old"] .contact-pin-button')).toHaveAttribute('aria-pressed', 'true');

    await openOutgoingTalks();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-new');
    await page.locator('[data-talk-id="pin-talk-old"] .talk-pin-button').click();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-old');
    await expect(page.locator('[data-talk-id="pin-talk-old"] .talk-pin-button')).toHaveAttribute('aria-pressed', 'true');

    await openAnswers();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-new');
    await page.locator('[data-question-id="pin-answer-old"] .answer-pin-button').click();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-old');
    await expect(page.locator('[data-question-id="pin-answer-old"] .answer-pin-button')).toHaveAttribute('aria-pressed', 'true');

    // A genuine document reload proves these are persisted preferences, not DOM-only moves.
    await gotoWebApp(page, webBaseURL());
    await afterAction();

    await openContacts();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-old');
    await page.locator('[data-contact-user-id="pin-contact-old"] .contact-pin-button').click();
    await expect(ordinaryContacts().first()).toHaveAttribute('data-contact-user-id', 'pin-contact-new');

    await openOutgoingTalks();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-old');
    await page.locator('[data-talk-id="pin-talk-old"] .talk-pin-button').click();
    await expect(outgoingTalks().first()).toHaveAttribute('data-talk-id', 'pin-talk-new');

    await openAnswers();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-old');
    await page.locator('[data-question-id="pin-answer-old"] .answer-pin-button').click();
    await expect(answerRows().first()).toHaveAttribute('data-question-id', 'pin-answer-new');
  });
});
