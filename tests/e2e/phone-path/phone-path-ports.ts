/** Moves the whole suite, so two checkouts on one machine can run it side by side. */
const OFFSET = Number(process.env.E2E_PHONE_PATH_PORT_OFFSET) || 0;

/** Ports for the phone-path suite, outside the root suite's 3001+N / 8080+N bands. */
export const PHONE_PATH_PORTS = {
  hub: 18180 + OFFSET,
  phoneA: 18188 + OFFSET,
  phoneB: 18189 + OFFSET,
} as const;

/**
 * Ports for phone nodes a spec starts itself (a phone restarted on the same data; a phone whose
 * hub is unreachable). Nothing listens on `deadHub`.
 */
export const PHONE_PATH_SPEC_PORTS = {
  restartPhone: 18190 + OFFSET,
  offlinePhone: 18191 + OFFSET,
  deadHub: 18199 + OFFSET,
  /** Accepts connections and never answers: a hung network, not a refused one. */
  hungHub: 18198 + OFFSET,
  hungHubPhone: 18192 + OFFSET,
  /** phone-path/12: a phone whose stored chain is tampered while it is stopped. */
  chainPhone: 18193 + OFFSET,
} as const;

export type PhonePathOrigin = keyof typeof PHONE_PATH_PORTS;

export function phonePathURL(origin: PhonePathOrigin): string {
  return `http://127.0.0.1:${PHONE_PATH_PORTS[origin]}`;
}
