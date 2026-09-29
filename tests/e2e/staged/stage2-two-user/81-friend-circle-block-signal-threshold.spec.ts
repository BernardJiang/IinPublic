/**
 * Friend-circle block signal (src/shared/block-signal.ts) — real cross-browser proof.
 *
 * Alice adds Victor as a known contact, then blocks a target identity and fans out a
 * block-signal to her contacts (the real send path: ECDH-encrypt via Alice's own keypair,
 * post to Victor's mailbox — exercised directly via fanOutBlockSignal rather than clicking
 * through the notify modal, since that piece is already covered by unit tests for the pure
 * group-resolution/threshold logic; what unit tests CANNOT cover is real SEA encryption
 * between two distinct browsers' keypairs and the mailbox drain/decrypt/dispatch wiring).
 * Victor's mailbox poll picks it up and records exactly one signal for that target.
 *
 * The remaining two signals needed to cross BLOCK_SIGNAL_THRESHOLD (3) are seeded directly via
 * recordReceivedBlockSignal on Victor's own browser (same on-device store the real receive
 * path writes to) — reaching three real send/receive round-trips would need three additional
 * browser contexts for no extra coverage, since the aggregation/threshold math itself is
 * already exhaustively unit-tested in src/test/unit/block-signal.test.ts.
 */
import { chromium, Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect } from '../../helpers/fixtures';
import { clearGunForStage2Spec } from '../../helpers/e2e-stage-pipeline';
import { afterSync, headless } from '../../helpers/timing';
import { bootstrapUser } from '../../helpers/talks-matching-flow';
import { WEBRTC_CHROMIUM_ARGS } from '../../helpers/webrtc-chromium';

test.describe('Friend-circle block signal — threshold-gated warning', () => {
  let browserAlice: Browser;
  let browserVictor: Browser;
  let contextAlice: BrowserContext;
  let contextVictor: BrowserContext;
  let pageAlice: Page;
  let pageVictor: Page;

  test.beforeAll(async ({ e2eWorkerSlot: _ws }) => {
    await clearGunForStage2Spec();
    browserAlice = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=0,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
    browserVictor = await chromium.launch({
      headless,
      args: [...WEBRTC_CHROMIUM_ARGS, '--window-position=640,0', '--window-size=640,1100', '--force-device-scale-factor=1'],
    });
  });

  test.afterAll(async () => {
    await pageAlice?.close().catch(() => {});
    await pageVictor?.close().catch(() => {});
    await contextAlice?.close().catch(() => {});
    await contextVictor?.close().catch(() => {});
    await browserAlice?.close().catch(() => {});
    await browserVictor?.close().catch(() => {});
    await clearGunForStage2Spec();
  });

  test('viewer accumulates signals from contacts and crosses the threshold', async () => {
    const alice = await bootstrapUser(browserAlice, 'Alice', 'Alice');
    contextAlice = alice.context;
    pageAlice = alice.page;

    const victor = await bootstrapUser(browserVictor, 'Victor', 'Victor');
    contextVictor = victor.context;
    pageVictor = victor.page;

    // Presence for resolvePeerEpub's primary lookup path (Gun getPublicUser is the fallback).
    await pageAlice.click('.chatroom-item:has-text("Global")');
    await afterSync();
    await pageVictor.click('.chatroom-item:has-text("Global")');
    await afterSync();

    const aliceUserId = await pageAlice.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    const victorUserId = await pageVictor.evaluate(
      () => (window as any).__iinpublic_app?.getApp()?.currentUser?.id || '',
    );
    expect(aliceUserId).toBeTruthy();
    expect(victorUserId).toBeTruthy();

    const targetIdentity = `synthetic-target-${Date.now()}`;

    // Alice adds Victor as a contact — the fan-out recipient list is resolved from the
    // blocker's own knownPeople, so Victor must be one of Alice's contacts to receive this.
    await pageAlice.evaluate(async (victorId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      await app.userService.addKnownPerson(app.currentUser.id, victorId, ['friend']);
    }, victorUserId);
    await afterSync();

    // Real block + real opt-in fan-out — exercises actual SEA encryption (Alice's keypair,
    // Victor's resolved epub) and the real mailbox post, not a mocked/simulated payload.
    await pageAlice.evaluate(async ({ targetId, recipientId }) => {
      const app = (window as any).__iinpublic_app?.getApp();
      await app.userService.blockUser(app.currentUser.id, targetId);
      await app.fanOutBlockSignal(targetId, 'all', [recipientId]);
    }, { targetId: targetIdentity, recipientId: victorUserId });

    // Victor's mailbox poll (every 3s, app.ts startMailboxPolling) drains, decrypts with his
    // own keypair, and calls recordReceivedBlockSignal — proving the full real round-trip.
    await expect
      .poll(
        async () => pageVictor.evaluate(
          (targetId) => {
            const app = (window as any).__iinpublic_app?.getApp();
            return (app.currentUser?.receivedBlockSignals?.[targetId] || []).length;
          },
          targetIdentity,
        ),
        { timeout: 20_000 },
      )
      .toBe(1);

    // The other two signals a real threshold-3 case needs — same on-device store the real
    // receive path (ingestBlockSignalFromMailbox) writes to, seeded directly rather than via
    // two more browser contexts (see file doc comment for why that adds no extra coverage).
    // recordReceivedBlockSignal does its own fresh getUser()-under-lock read/write cycle, so
    // sequential calls must be polled (not read back immediately) — same Gun eventual-
    // consistency reason every other assertion in this codebase polls rather than reads once.
    const seedAndPollCount = async (signalId: string, expected: number) => {
      await pageVictor.evaluate(
        ({ targetId, victorId, sig }) => {
          const app = (window as any).__iinpublic_app?.getApp();
          return app.userService.recordReceivedBlockSignal(victorId, targetId, sig);
        },
        { targetId: targetIdentity, victorId: victorUserId, sig: signalId },
      );
      await expect
        .poll(
          async () => pageVictor.evaluate(
            ({ targetId, victorId }) => (window as any).__iinpublic_app?.getApp()?.userService
              .getUser(victorId)
              .then((u: any) => (u.receivedBlockSignals?.[targetId] || []).length),
            { targetId: targetIdentity, victorId: victorUserId },
          ),
          { timeout: 15_000 },
        )
        .toBe(expected);
    };
    await seedAndPollCount('seeded-signal-2', 2);
    await seedAndPollCount('seeded-signal-3', 3);

    // Mirror app.ts's own in-memory refresh after a mailbox-driven write
    // (ingestBlockSignalFromMailbox does the same) for the rest of this test to read from.
    await pageVictor.evaluate(async (victorId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      const updated = await app.userService.getUser(victorId);
      app.currentUser.receivedBlockSignals = updated.receivedBlockSignals;
    }, victorUserId);

    // Persists across restart — same SEA-private round trip as knownPeople/blockedUserIds.
    await pageVictor.reload({ waitUntil: 'domcontentloaded' });
    await afterSync();
    await expect
      .poll(
        async () => pageVictor.evaluate(
          (targetId) => {
            const app = (window as any).__iinpublic_app?.getApp();
            return (app.currentUser?.receivedBlockSignals?.[targetId] || []).length;
          },
          targetIdentity,
        ),
        { timeout: 15_000 },
      )
      .toBe(3);

    // "Block is a status, not a one-time notification": Alice shares a DIFFERENT block scoped
    // to 'coworker' while Victor is still only labeled 'friend' — he does not qualify yet, so
    // the immediate fan-out excludes him (recipientUserIds is empty for this call).
    const coworkerScopedTarget = `synthetic-coworker-target-${Date.now()}`;
    await pageAlice.evaluate(async (targetId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      await app.userService.blockUser(app.currentUser.id, targetId);
      await app.fanOutBlockSignal(targetId, 'coworker', []); // no current 'coworker' contacts yet
    }, coworkerScopedTarget);
    await afterSync();

    // Victor never receives it at share time.
    const victorSignalsBeforeRelabel = await pageVictor.evaluate(
      (targetId) => {
        const app = (window as any).__iinpublic_app?.getApp();
        return (app.currentUser?.receivedBlockSignals?.[targetId] || []).length;
      },
      coworkerScopedTarget,
    );
    expect(victorSignalsBeforeRelabel).toBe(0);

    // Alice relabels Victor to include 'coworker' — the exact "Tom is invited to my coworkers
    // group" case. Goes through the REAL UI event ('saveKnownPerson' → app.ts's handler →
    // addKnownPerson → resendSharedBlockSignalsToNewContact), not a direct method call, since
    // the trigger wiring itself is what this phase is proving.
    await pageAlice.evaluate((victorId) => {
      const app = (window as any).__iinpublic_app?.getApp();
      app.uiManager.emit('saveKnownPerson', { userId: victorId, labels: ['friend', 'coworker'] });
    }, victorUserId);

    // Victor's mailbox poll catches the retroactive signal — proving a contact added/relabeled
    // AFTER a block was shared still ends up with it, matching the "status" framing.
    await expect
      .poll(
        async () => pageVictor.evaluate(
          (targetId) => {
            const app = (window as any).__iinpublic_app?.getApp();
            return (app.currentUser?.receivedBlockSignals?.[targetId] || []).length;
          },
          coworkerScopedTarget,
        ),
        { timeout: 20_000 },
      )
      .toBe(1);

    await pageVictor.evaluate(() => (window as any).__iinpublic_app?.getApp()?.manualCleanup());
  });
});
