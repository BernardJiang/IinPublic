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
  'Failed to load resource: net::ERR_INSUFFICIENT_RESOURCES',
  'refreshCustomChatroomsFromServer failed: AbortError:',
];

export function attachFilteredConsoleLog(page: { on(event: 'console', handler: (message: ConsoleMessage) => void): void }, label: string): void {
  page.on('console', (message) => {
    let text = message.text();
    // Network failures ('Failed to load resource: ... 400') carry the URL only in the
    // message location, not the text — without it, recurring 4xx spam is undiagnosable.
    if (text.startsWith('Failed to load resource')) {
      const url = message.location()?.url;
      if (url) text += ` [${url}]`;
    }
    if (process.env.E2E_VERBOSE_CONSOLE !== '1') {
      if (message.type() === 'log') return;
      if (NOISY_BROWSER_LOG_PATTERNS.some((pattern) => text.includes(pattern))) return;
      if (/^\s+-\s+[\w-]+:\s+\d+\s+members$/.test(text)) return;
    }
    console.log(`[${label}]:`, text);
  });
}
