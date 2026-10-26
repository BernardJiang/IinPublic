/**
 * OPEN-81 G7 physical gate for G6: a real Android receiver with its Activity asleep must consume
 * the encrypted Talk body in the native foreground-service path, send its exact approved answer,
 * survive a hard app restart before WebView reconciliation, and replay one idempotent outcome.
 */
import { test, expect } from '@playwright/test';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { promisify } from 'util';
import { bootstrapNativeWindow, enterNearbyAt } from './helpers/native-app';
import {
  closeAndroidUser,
  collectAndroidDiagnostics,
  isAndroidDeviceReady,
  launchAndroidUserViaAdb,
  resetAndroidAppData,
  type AndroidUser,
} from './helpers/native-app-android';
import { createTagTalk, everyoneListsEveryone, type NearbyParticipant } from '../journeys/nearby-ring-journey';
import type { TestActor } from '../helpers/test-actor';

const execFileAsync = promisify(execFile);
const RUN = process.env.E2E_REAL_ANDROID_BACKGROUND_AGENT === '1';
const HUB_GUN_PORT = Number(process.env.NATIVE_APP_E2E_GUN_PORT || '9078');
const AUTHOR_SERIAL = process.env.NATIVE_APP_ANDROID_AUTHOR?.trim() || 'DUM0219418001663';
const RECEIVER_SERIAL = process.env.NATIVE_APP_ANDROID_RECEIVER?.trim() || 'PADC100013000534';
const PACKAGE = 'com.iinpublic.app';
const FIXED_LOCATION = { latitude: 32.7157, longitude: -117.1611, accuracy: 10, timestamp: new Date().toISOString() };

process.env.E2E_PORT_OFFSET = String(HUB_GUN_PORT - 8080);

function resolveLanIp(): string {
  if (process.env.NATIVE_APP_ANDROID_HOST) return process.env.NATIVE_APP_ANDROID_HOST;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) if (address.family === 'IPv4' && !address.internal) return address.address;
  }
  throw new Error('No LAN IPv4 address found; set NATIVE_APP_ANDROID_HOST.');
}

async function adb(serial: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('adb', ['-s', serial, 'shell', ...args], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  return String(result.stdout);
}

async function wake(serial: string): Promise<void> {
  await adb(serial, 'dumpsys', 'deviceidle', 'unforce').catch(() => '');
  await adb(serial, 'input', 'keyevent', 'KEYCODE_WAKEUP').catch(() => '');
  await adb(serial, 'wm', 'dismiss-keyguard').catch(() => '');
  await adb(serial, 'cmd', 'statusbar', 'collapse').catch(() => '');
}

function participant(label: string, user: AndroidUser, userId: string): NearbyParticipant {
  const actor: TestActor = { id: label, runtime: 'android-webview', page: user.window };
  return { actor, userId, stageName: label };
}

async function configureAlwaysExactAnswer(receiver: AndroidUser, talkData: any): Promise<void> {
  await receiver.window.evaluate(({ talk }) => {
    const app = (window as any).__iinpublic_app?.getApp?.();
    const question = talk?.questions?.[0];
    const answer = question?.answers?.find((candidate: any) => candidate?.id === 'a_0_match');
    if (!question || !answer || typeof app?.uiManager?.saveAnswerPreference !== 'function') {
      throw new Error('production answer-preference writer unavailable');
    }
    const connectivity = {
      version: 2,
      preset: 'automatic',
      nearbyMode: 'always',
      nearbyPrivacyMode: 'neighborhood',
      locationSource: 'resident',
      activeRoomSelection: 'manual',
      wifiOnlyForwarding: true,
      identityReveal: 'matches-only',
      freeFirst: true,
      directFirst: true,
      batteryAware: true,
      meteredPermission: 'wait-for-free',
      forwarding: {
        enabled: false,
        wifiForwarding: true,
        cellularForwarding: false,
        lowBatteryPause: true,
        routeByteBudget: 52_428_800,
        cellularByteBudget: 0,
        maxFramesPerRoutePerMinute: 600,
      },
    };
    localStorage.setItem('chatbotEnabled', 'true');
    localStorage.setItem('iinpublic_auto_answer_scope', 'whenever');
    app.uiManager.saveAnswerPreference(
      talk,
      talk.id,
      question,
      answer.id,
      answer.text,
      [{ questionId: question.id, answerId: answer.id, answerText: answer.text }],
      'auto',
    );
    localStorage.setItem('iinpublic_talk_intake_filters', JSON.stringify({
      contactsOnlyTalks: false,
      allowedLanguages: ['en'],
      requireGoodGrammar: false,
      blockDirtyWords: false,
      allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
      customBlockedTerms: [],
      dirtyWords: [],
    }));
    localStorage.setItem('iinpublic_connectivity_settings_v1', JSON.stringify(connectivity));
    app?.uiManager?.emit?.('connectivitySettingsChanged', connectivity);
    app?.syncNativeBackgroundAgent?.();
  }, { talk: talkData });

  await expect.poll(() => receiver.window.evaluate(() => {
    const raw = (window as any).IinPublicBackground?.status?.();
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  }), { timeout: 60_000, intervals: [1_000, 2_000] }).toMatchObject({ provisioned: true, enabled: true });
}

test.describe('Native app: unattended encrypted Talk exchange (OPEN-81 G7)', () => {
  test.skip(!RUN, 'Set E2E_REAL_ANDROID_BACKGROUND_AGENT=1 to run the destructive physical gate.');

  let author: AndroidUser | undefined;
  let receiver: AndroidUser | undefined;

  test.afterAll(async () => {
    await wake(RECEIVER_SERIAL).catch(() => {});
    await closeAndroidUser(author);
    await closeAndroidUser(receiver);
  });

  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    for (const serial of [AUTHOR_SERIAL, RECEIVER_SERIAL]) {
      const diagnostics = await collectAndroidDiagnostics(serial);
      await testInfo.attach(`${serial}-logcat.txt`, { body: Buffer.from(diagnostics.logcat), contentType: 'text/plain' });
      await testInfo.attach(`${serial}-node-stdio.txt`, { body: Buffer.from(diagnostics.nodeStdio), contentType: 'text/plain' });
    }
  });

  test('screen-off exact response survives restart and reconciles once', async ({ browserName: _browserName }, testInfo) => {
    test.setTimeout(12 * 60_000);
    test.skip(!(await isAndroidDeviceReady(AUTHOR_SERIAL)) || !(await isAndroidDeviceReady(RECEIVER_SERIAL)), 'Both phones must be connected.');
    await Promise.all([wake(AUTHOR_SERIAL), wake(RECEIVER_SERIAL)]);
    await Promise.all([resetAndroidAppData(AUTHOR_SERIAL), resetAndroidAppData(RECEIVER_SERIAL)]);
    const hubGunUrl = `http://${resolveLanIp()}:${HUB_GUN_PORT}/gun`;

    author = await launchAndroidUserViaAdb({ deviceSerial: AUTHOR_SERIAL, hubGunUrl, disableLanDiscovery: true });
    const authorId = await bootstrapNativeWindow(author.window, 'G7 Author', { waitForSupportGreeting: false, readinessTimeoutMs: 150_000, pinStableLocation: false });
    receiver = await launchAndroidUserViaAdb({ deviceSerial: RECEIVER_SERIAL, hubGunUrl, disableLanDiscovery: true });
    const receiverId = await bootstrapNativeWindow(receiver.window, 'G7 Receiver', { waitForSupportGreeting: false, readinessTimeoutMs: 150_000, pinStableLocation: false });
    await Promise.all([enterNearbyAt(author.window, FIXED_LOCATION), enterNearbyAt(receiver.window, FIXED_LOCATION)]);
    await everyoneListsEveryone([
      participant('G7 Author', author, authorId),
      participant('G7 Receiver', receiver, receiverId),
    ], 180_000);

    const title = `G7 unattended ${Date.now()}`;
    const talk = await createTagTalk(participant('G7 Author', author, authorId).actor, title);
    await configureAlwaysExactAnswer(receiver, talk.talkData);
    await author.window.evaluate(() => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      app?.uiManager?.emit?.('startMatchCollection', { scopeId: 'nearby-v3', label: 'G7 physical background' });
    });
    await expect.poll(() => author!.window.evaluate(() => {
      const store = JSON.parse((((window as any).__iinpublic_collection?.('appData') ?? {})['iinpublic_match_collection_sessions_v1'] ?? null) || '{}');
      return String(store.activeSessionId || '');
    }), { timeout: 30_000 }).not.toBe('');
    const collectionSessionId = await author.window.evaluate(() => {
      const store = JSON.parse((((window as any).__iinpublic_collection?.('appData') ?? {})['iinpublic_match_collection_sessions_v1'] ?? null) || '{}');
      return String(store.activeSessionId || '');
    });

    await adb(RECEIVER_SERIAL, 'input', 'keyevent', 'KEYCODE_HOME');
    await adb(RECEIVER_SERIAL, 'input', 'keyevent', 'KEYCODE_SLEEP');
    const processPidBeforeKill = (await adb(RECEIVER_SERIAL, 'pidof', PACKAGE)).trim().split(/\s+/)[0] || '';
    expect(processPidBeforeKill).not.toBe('');
    const processKilled = await adb(RECEIVER_SERIAL, 'run-as', PACKAGE, 'kill', '-9', processPidBeforeKill)
      .then(() => true)
      .catch(() => false);
    expect(processKilled).toBe(true);
    let backgroundServicePid = '';
    await expect.poll(async () => {
      backgroundServicePid = (await adb(RECEIVER_SERIAL, 'pidof', PACKAGE).catch(() => '')).trim().split(/\s+/)[0] || '';
      return backgroundServicePid && backgroundServicePid !== processPidBeforeKill;
    }, { timeout: 90_000, intervals: [1_000, 2_000, 3_000], message: 'foreground service should restart without the Activity' }).toBe(true);
    await adb(RECEIVER_SERIAL, 'dumpsys', 'deviceidle', 'force-idle').catch(() => '');
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const sentAt = Date.now();
    const sent = await author.window.evaluate(async ({ userId, stageName }) => {
      const app = (window as any).__iinpublic_app?.getApp?.();
      return app?.deliverPendingBroadcastTalksForE2e?.(1, { receiverUsers: [{ userId, stageName }] });
    }, { userId: receiverId, stageName: 'G7 Receiver' });
    expect(sent).toMatchObject({ talksSent: 1, receivers: 1 });
    await author.window.evaluate(() => {
      (window as any).__iinpublic_app?.getApp?.()?.uiManager?.emit?.('endMatchCollection');
    });
    await expect.poll(() => author!.window.evaluate((sessionId) => {
      const store = JSON.parse((((window as any).__iinpublic_collection?.('appData') ?? {})['iinpublic_match_collection_sessions_v1'] ?? null) || '{}');
      const endedAt = String((store.sessions || []).find((row: any) => row.id === sessionId)?.endedAt || '');
      return !store.activeSessionId && endedAt.length > 0;
    }, collectionSessionId), { timeout: 30_000 }).toBe(true);

    await expect.poll(() => author!.window.evaluate(({ talkId, responderId }) => {
      const doc = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
      return Object.values(doc?.outcomes || {}).filter((row: any) =>
        row?.talkId === talkId && row?.responderId === responderId && row?.outcome === 'matched').length;
    }, { talkId: talk.talkId, responderId: receiverId }), {
      timeout: 240_000,
      intervals: [2_000, 3_000, 5_000],
      message: 'author should receive the native background exact response',
    }).toBe(1);
    const responseReceivedAt = Date.now();

    const collection = await author.window.evaluate(({ sessionId, talkId, responderId }) => {
      const store = JSON.parse((((window as any).__iinpublic_collection?.('appData') ?? {})['iinpublic_match_collection_sessions_v1'] ?? null) || '{}');
      const session = (store.sessions || []).find((row: any) => row.id === sessionId);
      const matchingResults = (session?.results || []).filter(
        (row: any) => row.talkId === talkId && row.peerId === responderId && row.outcome === 'match',
      );
      return {
        sessionId: session?.id || '',
        endedAt: session?.endedAt || '',
        associations: (store.associations || []).filter((row: any) => row.talkId === talkId && row.peerId === responderId).length,
        results: matchingResults.length,
        resultCapturedAt: matchingResults[0]?.capturedAt || '',
      };
    }, { sessionId: collectionSessionId, talkId: talk.talkId, responderId: receiverId });
    expect(collection).toMatchObject({ sessionId: collectionSessionId, associations: 1, results: 1 });
    expect(Date.parse(collection.resultCapturedAt)).toBeGreaterThanOrEqual(Date.parse(collection.endedAt));

    await wake(RECEIVER_SERIAL);
    receiver = await launchAndroidUserViaAdb({ deviceSerial: RECEIVER_SERIAL, hubGunUrl, disableLanDiscovery: true });
    await expect.poll(() => receiver!.window.evaluate(() => Boolean((window as any).__iinpublic_app?.getApp?.()?.currentUser?.id)), { timeout: 90_000 }).toBe(true);

    await expect.poll(() => receiver!.window.evaluate((talkId) => {
      const doc = (window as any).__iinpublic_app?.getApp?.()?.getTalkLedgerDocForE2e?.();
      return Object.values(doc?.exchanged || {}).filter((row: any) => row?.role === 'responder' && row?.talkId === talkId).length;
    }, talk.talkId), { timeout: 120_000, intervals: [1_000, 2_000, 3_000] }).toBe(1);
    await expect.poll(() => receiver!.window.evaluate(() => {
      const raw = (window as any).IinPublicBackground?.status?.();
      try { return JSON.parse(raw || '{}').pendingEvents ?? -1; } catch { return -1; }
    }), { timeout: 60_000 }).toBe(0);

    const evidence = {
      authorSerial: AUTHOR_SERIAL,
      receiverSerial: RECEIVER_SERIAL,
      talkId: talk.talkId,
      responseWhileScreenOffMs: responseReceivedAt - sentAt,
      collection,
      lateReplyAttachedToEndedOuting: true,
      processKilled,
      processPidBeforeKill,
      backgroundServicePid,
      processPidAfterActivityRelaunch: (await adb(RECEIVER_SERIAL, 'pidof', PACKAGE)).trim(),
      exactResponderLedgerRows: 1,
    };
    const evidencePath = testInfo.outputPath('g7-background-agent-evidence.json');
    fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
    await testInfo.attach('g7-background-agent-evidence.json', { path: evidencePath, contentType: 'application/json' });
  });
});
