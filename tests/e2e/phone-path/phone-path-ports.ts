/** Fixed ports for the phone-path suite, outside the root suite's 3001+N / 8080+N bands. */
export const PHONE_PATH_PORTS = {
  hub: 18180,
  phoneA: 18188,
  phoneB: 18189,
} as const;

/**
 * Ports for phone nodes a spec starts itself (a phone restarted on the same data; a phone whose
 * hub is unreachable). Nothing listens on `deadHub`.
 */
export const PHONE_PATH_SPEC_PORTS = {
  restartPhone: 18190,
  offlinePhone: 18191,
  deadHub: 18199,
  /** Accepts connections and never answers: a hung network, not a refused one. */
  hungHub: 18198,
  hungHubPhone: 18192,
} as const;

export type PhonePathOrigin = keyof typeof PHONE_PATH_PORTS;

export function phonePathURL(origin: PhonePathOrigin): string {
  return `http://127.0.0.1:${PHONE_PATH_PORTS[origin]}`;
}
