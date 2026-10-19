import { blockPairHash } from './block-pair';
import {
  buildQuestionDefaultKey,
  putQuestionDefault,
  resolveQuestionDefault,
  type QuestionDefaultContractMap,
} from './question-default-contracts';
import { isNearbyPublicMode, nearbyBasePrecisionMeters } from './nearby-rooms';
import { compareVersions, isNewerVersion } from './semver-compare';
import { filterTalkPeersByContactPolicy } from './talk-contact-policy';

export const PORTABLE_CORE_CONTRACT_SCHEMA_VERSION = 1 as const;

export type PortableCoreContractResult = {
  id: string;
  passed: boolean;
  durationMs: number;
  error?: string;
};

export type PortableCoreContractReport = {
  schemaVersion: typeof PORTABLE_CORE_CONTRACT_SCHEMA_VERSION;
  passed: number;
  failed: number;
  total: number;
  results: PortableCoreContractResult[];
};

type PortableCoreContract = {
  id: string;
  run: () => void;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (!Object.is(actual, expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

function assertArrayEqual<T>(actual: readonly T[], expected: readonly T[], label: string): void {
  assertEqual(JSON.stringify(actual), JSON.stringify(expected), label);
}

/**
 * Small, high-value contracts that execute unchanged in Jest, an Android WebView, and the
 * embedded Node runtime. Keep cases deterministic and free of DOM, filesystem, server, and Gun
 * dependencies. This is a portable parity layer, not a replacement for the complete host suite.
 */
export function portableCoreContracts(): PortableCoreContract[] {
  return [
    {
      id: 'release-version-ordering',
      run: () => {
        assertEqual(compareVersions('1.0.150', '1.0.149'), 1, 'newer patch');
        assertEqual(compareVersions('1.2', '1.2.0'), 0, 'missing segment');
        assertEqual(compareVersions('1.2.0', '1.10.0'), -1, 'numeric ordering');
        assert(isNewerVersion('2.0.0', '1.999.999'), 'major release should be newer');
      },
    },
    {
      id: 'contact-audience-fails-closed',
      run: () => {
        const peers = ['friend', 'stranger', 'traveler'];
        const contacts = [{ userId: 'friend' }];
        assertArrayEqual(
          filterTalkPeersByContactPolicy(peers, { contactsOnlyTalks: true }, contacts),
          ['friend'],
          'contacts-only audience',
        );
        assertArrayEqual(
          filterTalkPeersByContactPolicy(
            peers,
            { residentsOnlyTalks: true },
            contacts,
            new Set(['friend', 'traveler']),
          ),
          ['friend', 'stranger'],
          'known contacts override traveler filtering',
        );
        assertArrayEqual(
          filterTalkPeersByContactPolicy(peers, { contactsOnlyTalks: true }, undefined),
          [],
          'unloaded contacts fail closed',
        );
      },
    },
    {
      id: 'question-default-survives-answer-id-change',
      run: () => {
        const contracts: QuestionDefaultContractMap = {};
        const questionKey = buildQuestionDefaultKey(
          { language: 'en' },
          { text: 'Tea or coffee?', answerSelectionMode: 'single' },
        );
        putQuestionDefault(contracts, {
          questionKey,
          questionText: 'Tea or coffee?',
          answerText: 'Coffee',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
        const answer = resolveQuestionDefault(contracts, questionKey, [
          { id: 'new-tea-id', text: 'Tea' },
          { id: 'new-coffee-id', text: 'Coffee' },
        ]);
        assertEqual(answer?.answerId, 'new-coffee-id', 'resolved answer id');
        assertEqual(answer?.answerText, 'Coffee', 'resolved answer text');
      },
    },
    {
      id: 'nearby-location-policy-is-portable',
      run: () => {
        assert(isNearbyPublicMode('close-nearby'), 'close-nearby should be public');
        assert(!isNearbyPublicMode('contacts-only'), 'contacts-only should not publish location');
        assertEqual(nearbyBasePrecisionMeters('close-nearby'), 400, 'close range');
        assertEqual(nearbyBasePrecisionMeters('neighborhood'), 1_000, 'neighborhood range');
      },
    },
    {
      id: 'block-pair-key-is-direction-independent',
      run: () => {
        const forward = blockPairHash('alice', 'bob');
        const reverse = blockPairHash('bob', 'alice');
        assertEqual(forward, reverse, 'pair key');
        assertEqual(forward.length, 64, 'SHA-256 hex length');
      },
    },
  ];
}

export function runPortableCoreContracts(): PortableCoreContractReport {
  const results = portableCoreContracts().map(({ id, run }): PortableCoreContractResult => {
    const startedAt = Date.now();
    try {
      run();
      return { id, passed: true, durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        id,
        passed: false,
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const passed = results.filter((result) => result.passed).length;
  return {
    schemaVersion: PORTABLE_CORE_CONTRACT_SCHEMA_VERSION,
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
  };
}
