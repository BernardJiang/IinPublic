/** Fixed ports for the phone-path suite, outside the root suite's 3001+N / 8080+N bands. */
export const PHONE_PATH_PORTS = {
  hub: 18180,
  phoneA: 18188,
  phoneB: 18189,
} as const;

export type PhonePathOrigin = keyof typeof PHONE_PATH_PORTS;

export function phonePathURL(origin: PhonePathOrigin): string {
  return `http://127.0.0.1:${PHONE_PATH_PORTS[origin]}`;
}
