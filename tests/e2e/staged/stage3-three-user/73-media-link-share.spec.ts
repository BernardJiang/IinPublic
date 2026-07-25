/**
 * 73 — Multimedia link sharing: DM composer 📎 and talk-editor attachment.
 *
 * The feature shares a LINK to a file (uploaded to IPFS), not the bytes inline.
 *   - DM composer: Adam attaches notes.txt; both Adam and Bob see an attachment card with the
 *     filename + ipfs:// link (non-image icon), and the raw IPFS_SHARE payload never shows.
 *   - Talk editor: creating a talk with a file attached stores it as ipfsAttachments (real cid),
 *     which the existing matched-talk auto-share delivers on match.
 *
 * See companion 73-media-link-share.md for a plain-English description.
 */

import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { maybeClearGunDatabases } from '../../helpers/clear-database';
import { afterLoad, afterSync, afterAction } from '../../helpers/timing';
import { bootstrapUser, ensureMeshNeighbors } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';
import { webAppURLStableChatroom } from '../../helpers/ports';

const E2E_TIMEOUT_MS = 30_000;

test.describe('Multimedia link sharing (composer + talk editor)', () => {
  const browsers: Browser[] = [];
  let contextAdam: BrowserContext | undefined;
  let contextBob: BrowserContext | undefined;
  let pageAdam: Page | undefined;
  let pageBob: Page | undefined;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    test.setTimeout(240_000);
    await maybeClearGunDatabases();
    const mk = (x: number) => ({
      headless: !!process.env.CI,
      args: [`--window-position=${x},40`, '--window-size=640,1200', '--force-device-scale-factor=1', ...WEBRTC_CHROMIUM_ARGS],
    });
    const [adam, bob] = await Promise.all([chromium.launch(mk(0)), chromium.launch(mk(680))]);
    browsers.push(adam, bob);
  });

  test.afterAll(async () => {
    await Promise.all([contextAdam, contextBob].map((c) => c?.close().catch(() => {})));
    await Promise.all(browsers.map((b) => b.close().catch(() => {})));
    await maybeClearGunDatabases();
  });

  async function openConversation(page: Page, conversationId: string): Promise<void> {
    await page.evaluate((id) => {
      (window as any).__iinpublic_app.getApp().uiManager.showConversationDetail(id);
    }, conversationId);
    await expect(page.locator('#conversation-detail-overlay')).toBeVisible({ timeout: 15_000 });
  }

  test('DM composer shares a document link; talk editor stores an attachment cid', async () => {
    test.setTimeout(240_000);
    void webAppURLStableChatroom();
    const [adamResult, bobResult] = await Promise.all([
      bootstrapUser(browsers[0], 'Adam', 'Adam'),
      bootstrapUser(browsers[1], 'Bob', 'Bob'),
    ]);
    contextAdam = adamResult.context;
    contextBob = bobResult.context;
    pageAdam = adamResult.page;
    pageBob = bobResult.page;
    await afterLoad();

    const idOf = (p: Page) => p.evaluate(() =>
      String((window as any).__iinpublic_app.getApp().currentUser?.id || ''));
    const [adamId, bobId] = await Promise.all([idOf(pageAdam), idOf(pageBob)]);
    expect(adamId && bobId).toBeTruthy();
    await afterSync();
    await ensureMeshNeighbors([
      { label: 'Adam', page: pageAdam, otherIds: [bobId] },
      { label: 'Bob', page: pageBob, otherIds: [adamId] },
    ]);

    // Adam broadcasts a tag talk; Bob matches → pair conversation exists both sides.
    const talkId = `media-share-e2e-${Date.now()}`;
    const adamEpub = await pageAdam.evaluate(() =>
      String((window as any).__iinpublic_app.getApp().gunService.getStoredPair()?.epub || ''));
    const talkDef = {
      id: talkId, type: 'tag', title: 'Dogs', authorId: adamId, authorName: 'Adam', authorEpub: adamEpub,
      questions: [{ id: 'q1', text: 'Do you like dogs?', answers: [
        { id: 'a-match', text: 'Yes', isMatch: true },
        { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true }] }],
    };
    await pageAdam.evaluate(async ({ def }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService.cacheTalkBody(def.id, def);
      const mt = JSON.parse(localStorage.getItem('myTalks') || '{}'); mt[def.id] = { role: 'created', fullTalk: def };
      localStorage.setItem('myTalks', JSON.stringify(mt));
      await a.peerMeshService.broadcastTalk(def, { roomBroadcast: true });
    }, { def: talkDef });
    await afterAction();
    await pageBob.evaluate(async ({ def }) => {
      const a = (window as any).__iinpublic_app.getApp();
      a.peerMeshService?.cacheTalkBody?.(def.id, def);
      await a.submitTalkResponsePairDirect({
        talkId: def.id, talkData: { ...def, authorName: 'Adam' },
        answers: [{ questionId: 'q1', answerId: 'a-match', answerText: 'Yes', mode: 'manual', isMatch: true }],
        isChatbotResponse: false, authorId: def.authorId, authorName: 'Adam', isAutoResponse: false,
      });
    }, { def: talkDef });
    await afterAction();

    const convIdFor = (page: Page, peerId: string) => page.evaluate(({ pid }) => {
      const conversations = JSON.parse(localStorage.getItem('myConversations') ?? '{}');
      const entry = Object.entries(conversations).find(([, c]: [string, any]) => c?.otherUserId === pid);
      return entry ? entry[0] : '';
    }, { pid: peerId });
    await expect.poll(() => convIdFor(pageAdam!, bobId), { timeout: E2E_TIMEOUT_MS }).not.toBe('');
    await expect.poll(() => convIdFor(pageBob!, adamId), { timeout: E2E_TIMEOUT_MS }).not.toBe('');
    const adamBob = await convIdFor(pageAdam, bobId);
    const bobAdam = await convIdFor(pageBob, adamId);

    // ── Part A: DM composer attaches a document; a link card lands on both ends ──
    await openConversation(pageAdam, adamBob);
    await pageAdam.setInputFiles('#conversation-attach-input', {
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('my dog notes: loves fetch', 'utf-8'),
    });

    // Adam's own thread shows the file card (not an inline image, not raw JSON).
    await expect(pageAdam.locator('#conversation-messages [data-testid="ipfs-attachment"]'))
      .toBeVisible({ timeout: E2E_TIMEOUT_MS });
    await expect(pageAdam.locator('#conversation-messages .ipfs-attachment-name')).toContainText('notes.txt');
    await expect(pageAdam.locator('#conversation-messages .ipfs-attachment-link')).toContainText('ipfs://');
    await expect(pageAdam.locator('#conversation-messages')).not.toContainText('IPFS_SHARE:');

    // The Shared-media gallery collects shared items out of the DM stream, tabbed.
    await pageAdam.locator('#conversation-media-btn').click();
    await expect(pageAdam.locator('#conversation-media-gallery')).toBeVisible();
    // notes.txt is a file, not media → the default Media tab is empty, Files holds it.
    await expect(pageAdam.locator('#conversation-media-grid [data-testid="media-tile"]')).toHaveCount(0);
    await pageAdam.locator('.conversation-media-tab[data-media-tab="files"]').click();
    await expect(pageAdam.locator('#conversation-media-grid [data-testid="media-tile"]')).toHaveCount(1);
    await expect(pageAdam.locator('#conversation-media-grid .media-tile-name')).toContainText('notes.txt');
    // Gallery hides the message thread; going back restores it.
    await expect(pageAdam.locator('#conversation-messages')).toBeHidden();
    await pageAdam.locator('#back-from-media').click();
    await expect(pageAdam.locator('#conversation-media-gallery')).toBeHidden();
    await expect(pageAdam.locator('#conversation-messages')).toBeVisible();

    // Bob receives the same link card.
    await openConversation(pageBob, bobAdam);
    await expect(pageBob.locator('#conversation-messages [data-testid="ipfs-attachment"]'))
      .toBeVisible({ timeout: E2E_TIMEOUT_MS });
    await expect(pageBob.locator('#conversation-messages .ipfs-attachment-name')).toContainText('notes.txt');
    await expect(pageBob.locator('#conversation-messages .ipfs-attachment-link')).toContainText('ipfs://');
    await expect(pageBob.locator('#conversation-messages')).not.toContainText('IPFS_SHARE:');
    // A text file is not rendered as an inline image.
    await expect(pageBob.locator('#conversation-messages img.ipfs-attachment-img')).toHaveCount(0);

    // ── Part B: talk editor attachment → the created talk carries an ipfs cid ────
    const editorTalkId = `editor-media-e2e-${Date.now()}`;
    await pageAdam.evaluate(async ({ tId }) => {
      const app = (window as any).__iinpublic_app.getApp();
      const file = new File([new Uint8Array([1, 2, 3, 4])], 'brochure.pdf', { type: 'application/pdf' });
      app.uiManager.emit('createTalk', {
        id: tId, title: 'With Brochure', type: 'tag', isAdult: false, language: 'en', tags: [],
        sendToChatroom: false, selfAnswers: [],
        questions: [{ id: 'q1', text: 'Interested?', answers: [
          { id: 'a-match', text: 'Yes', isMatch: true },
          { id: 'a-ignore', text: 'No', isMatch: false, isIgnore: true }] }],
        mediaFile: file,
      });
    }, { tId: editorTalkId });

    // The created talk must carry a real IPFS attachment (published from the file).
    await expect
      .poll(() => pageAdam!.evaluate(() => {
        const myTalks = JSON.parse(localStorage.getItem('myTalks') || '{}');
        const talk = Object.values(myTalks).map((t: any) => t?.fullTalk).find(
          (t: any) => t?.title === 'With Brochure');
        const att = talk?.ipfsAttachments?.[0];
        return att && att.cid && att.name === 'brochure.pdf' ? att.cid : '';
      }), { timeout: E2E_TIMEOUT_MS, message: 'talk editor did not attach an IPFS media cid' })
      .not.toBe('');
  });
});
