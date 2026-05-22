import type { ConsoleMessage } from '@playwright/test';

const NOISY_BROWSER_LOG_PATTERNS = [
  'Hello wonderful person!',
  'Warning: No localStorage exists to persist data to!',
  'Gun put success:',
  'Chatroom members updated:',
  'Updating member count for',
  'Member count update for',
  'Setting member count for',
  'Subscribing to member count for chatroom:',
  'Subscribed to all chatroom member counts',
  'Received talk announcement:',
  'Full talk data:',
  'Chatbot auto-reply skipped:',
  'Failed to load resource: the server responded with a status of 404',
  'refreshCustomChatroomsFromServer failed: AbortError:',
];

export function attachFilteredConsoleLog(page: { on(event: 'console', handler: (message: ConsoleMessage) => void): void }, label: string): void {
  page.on('console', (message) => {
    const text = message.text();
    if (process.env.E2E_VERBOSE_CONSOLE !== '1') {
      if (message.type() === 'log') return;
      if (NOISY_BROWSER_LOG_PATTERNS.some((pattern) => text.includes(pattern))) return;
      if (/^\s+-\s+[\w-]+:\s+\d+\s+members$/.test(text)) return;
    }
    console.log(`[${label}]:`, text);
  });
}
