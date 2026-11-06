/** @jest-environment jsdom */

import { IinPublicApp } from '../../web/app/app';
import type { TechSupportDelegateGrant } from '../../shared/techsupport-delegate';

function appWithoutConstructor(): any {
  return Object.create(IinPublicApp.prototype) as any;
}

function validGrant(): TechSupportDelegateGrant {
  return {
    delegatePub: 'delegate-pub',
    delegateUserId: 'delegate-user',
    label: 'Field support phone',
    issuedAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2099-12-01T00:00:00.000Z',
    revokedAt: null,
    masterPub: 'root-pub',
    signature: 'verified-signature',
  };
}

describe('TechSupport mailbox retention (OPEN-107)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('leaves a support envelope queued when this session did not ingest it', async () => {
    const app = appWithoutConstructor();
    const deleteEnvelope = jest.fn(async () => true);
    app.currentUser = { id: 'delegate-user' };
    app.gunService = { getStoredPair: () => ({ priv: 'recipient-private-key' }) };
    app.mailboxClient = {
      fetchEnvelopes: jest.fn(async () => [{ id: 'support-envelope', ciphertext: '{}' }]),
      decryptEnvelope: jest.fn(async () => ({ kind: 'support-question-v1', questionKey: 'q1' })),
      deleteEnvelope,
    };
    app.ingestSupportQuestionFromMailbox = jest.fn(async () => false);

    await app.drainMailboxOnce();

    expect(app.ingestSupportQuestionFromMailbox).toHaveBeenCalledTimes(1);
    expect(deleteEnvelope).not.toHaveBeenCalled();
  });

  it('deletes a support envelope only after the handler confirms ingestion', async () => {
    const app = appWithoutConstructor();
    const deleteEnvelope = jest.fn(async () => true);
    app.currentUser = { id: 'delegate-user' };
    app.gunService = { getStoredPair: () => ({ priv: 'recipient-private-key' }) };
    app.mailboxClient = {
      fetchEnvelopes: jest.fn(async () => [{ id: 'support-envelope', ciphertext: '{}' }]),
      decryptEnvelope: jest.fn(async () => ({ kind: 'support-question-v1', questionKey: 'q1' })),
      deleteEnvelope,
    };
    app.ingestSupportQuestionFromMailbox = jest.fn(async () => true);

    await app.drainMailboxOnce();

    expect(deleteEnvelope).toHaveBeenCalledWith('delegate-user', 'support-envelope');
  });

  it('retains the last valid grant when both live paths are unavailable', async () => {
    const app = appWithoutConstructor();
    const grant = validGrant();
    app.currentUser = { id: 'delegate-user' };
    app.gunService = { getStoredPair: () => ({ pub: grant.delegatePub }) };
    app.techSupportDelegateGrant = grant;
    app.techSupportDelegateOptedIn = true;
    app.fetchOwnGrantLiveOrRelay = jest.fn(async () => { throw new Error('hub request aborted'); });
    app.loadDelegateOptInFromStorage = jest.fn(() => true);
    app.subscribeToSupportInboxIfTechSupport = jest.fn();
    app.uiManager = { setTechSupportDelegateEligibility: jest.fn() };

    await app.checkOwnDelegateEligibility();

    expect(app.techSupportDelegateGrant).toBe(grant);
    expect(app.techSupportDelegateOptedIn).toBe(true);
    expect(app.uiManager.setTechSupportDelegateEligibility)
      .toHaveBeenCalledWith(true, grant.label, true);
    expect(app.subscribeToSupportInboxIfTechSupport).toHaveBeenCalledTimes(1);
  });

  it('still disables delegate mode after an authoritative absent result', async () => {
    const app = appWithoutConstructor();
    const grant = validGrant();
    app.currentUser = { id: 'delegate-user' };
    app.gunService = { getStoredPair: () => ({ pub: grant.delegatePub }) };
    app.techSupportDelegateGrant = grant;
    app.techSupportDelegateOptedIn = true;
    app.fetchOwnGrantLiveOrRelay = jest.fn(async () => null);
    app.loadDelegateOptInFromStorage = jest.fn(() => true);
    app.subscribeToSupportInboxIfTechSupport = jest.fn();
    app.uiManager = { setTechSupportDelegateEligibility: jest.fn() };

    await app.checkOwnDelegateEligibility();

    expect(app.techSupportDelegateGrant).toBeNull();
    expect(app.techSupportDelegateOptedIn).toBe(false);
    expect(app.uiManager.setTechSupportDelegateEligibility)
      .toHaveBeenCalledWith(false, '', false);
  });

  it('does not retain an expired last-known grant during a lookup failure', async () => {
    const app = appWithoutConstructor();
    const grant = { ...validGrant(), expiresAt: '2020-01-01T00:00:00.000Z' };
    app.currentUser = { id: 'delegate-user' };
    app.gunService = { getStoredPair: () => ({ pub: grant.delegatePub }) };
    app.techSupportDelegateGrant = grant;
    app.techSupportDelegateOptedIn = true;
    app.fetchOwnGrantLiveOrRelay = jest.fn(async () => { throw new Error('hub request aborted'); });
    app.loadDelegateOptInFromStorage = jest.fn(() => true);
    app.subscribeToSupportInboxIfTechSupport = jest.fn();
    app.uiManager = { setTechSupportDelegateEligibility: jest.fn() };

    await app.checkOwnDelegateEligibility();

    expect(app.techSupportDelegateGrant).toBeNull();
    expect(app.techSupportDelegateOptedIn).toBe(false);
    expect(app.uiManager.setTechSupportDelegateEligibility)
      .toHaveBeenCalledWith(false, '', false);
  });
});
