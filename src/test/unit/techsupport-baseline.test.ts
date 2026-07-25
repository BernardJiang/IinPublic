import {
  assertTechSupportBaseline,
  duplicateSupportGreeting,
  techSupportBaselineProblem,
} from '../../../tests/e2e/helpers/techsupport-baseline';
import {
  TECHSUPPORT_NETWORK_ROLE,
  TECHSUPPORT_ROOT_USER_ID,
  TECHSUPPORT_STAGE_NAME,
} from '../../shared/techsupport';

/**
 * Guard for docs/TODO.md K4: every E2E baseline except the deliberate stage0 empty
 * reset must contain the built-in TechSupport root.
 */

function validGraph(): Record<string, any> {
  return {
    [`users/${TECHSUPPORT_ROOT_USER_ID}`]: {
      id: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      networkRole: TECHSUPPORT_NETWORK_ROLE,
    },
    'network-root-techsupport': {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      networkRole: TECHSUPPORT_NETWORK_ROLE,
    },
    [`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`]: {
      userId: TECHSUPPORT_ROOT_USER_ID,
      stageName: TECHSUPPORT_STAGE_NAME,
      isActive: true,
    },
  };
}

describe('techSupportBaselineProblem', () => {
  it('accepts a graph with the canonical root, network marker, and active Global membership', () => {
    expect(techSupportBaselineProblem(validGraph())).toBeNull();
  });

  it('rejects an empty or missing graph', () => {
    expect(techSupportBaselineProblem(undefined)).toMatch(/empty or missing/);
    expect(techSupportBaselineProblem({})).toMatch(/canonical TechSupport user root/);
  });

  it('rejects a root with the wrong network role', () => {
    const graph = validGraph();
    graph[`users/${TECHSUPPORT_ROOT_USER_ID}`].networkRole = 'ordinary';
    expect(techSupportBaselineProblem(graph)).toMatch(/canonical TechSupport user root/);
  });

  it('rejects a graph missing the network marker', () => {
    const graph = validGraph();
    delete graph['network-root-techsupport'];
    expect(techSupportBaselineProblem(graph)).toMatch(/network marker/);
  });

  it('rejects TechSupport being inactive in Global', () => {
    const graph = validGraph();
    graph[`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`].isActive = false;
    expect(techSupportBaselineProblem(graph)).toMatch(/active in Global/);
  });

  it('rejects TechSupport missing from Global entirely', () => {
    const graph = validGraph();
    delete graph[`chatrooms/global/users/${TECHSUPPORT_ROOT_USER_ID}`];
    expect(techSupportBaselineProblem(graph)).toMatch(/active in Global/);
  });
});

describe('assertTechSupportBaseline', () => {
  it('does not throw on a valid baseline', () => {
    expect(() => assertTechSupportBaseline(validGraph(), 'unit')).not.toThrow();
  });

  it('names the calling context and points at the contract doc', () => {
    expect(() => assertTechSupportBaseline({}, 'after clearGunDatabases')).toThrow(
      /after clearGunDatabases/,
    );
    expect(() => assertTechSupportBaseline({}, 'unit')).toThrow(/techsupport-bootstrap-contract/);
  });
});

describe('duplicateSupportGreeting', () => {
  const soul = (conv: string, user: string) =>
    `conversations/conv_support_${conv}/messages/support_welcome_${user}`;

  it('returns null when every receiver has at most one greeting', () => {
    const graph = {
      ...validGraph(),
      [soul('a', 'user-a')]: { text: 'hi' },
      [soul('b', 'user-b')]: { text: 'hi' },
    };
    expect(duplicateSupportGreeting(graph)).toBeNull();
  });

  it('flags a receiver greeted twice through different conversations', () => {
    const graph = {
      ...validGraph(),
      [soul('a', 'user-a')]: { text: 'hi' },
      [soul('b', 'user-a')]: { text: 'hi again' },
    };
    expect(duplicateSupportGreeting(graph)).toBe('user-a');
  });

  it('ignores non-greeting souls', () => {
    expect(duplicateSupportGreeting({ 'conversations/conv_x/messages/m1': {} })).toBeNull();
  });
});
