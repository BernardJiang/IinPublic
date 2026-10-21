/**
 * Test automation on a phone skips the first-run tour (debug app: `--ez skip_first_run_tour true`
 * → `?skip_tour=1`); a release app never adds the parameter, so real installs see the tour.
 * @jest-environment jsdom
 */
import { showFirstRunIfNeeded } from '../../web/ui/first-run-controller';
import { getHasSeenActionableGuide } from '../../web/ui/ui-settings-storage';

describe('first-run tour skip for test automation', () => {
  const deps = { t: (key: string) => key, openStarterTalks: () => undefined } as never;
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('skips and remembers the tour when the debug app asks', () => {
    window.history.replaceState(null, '', '/?mode=native&skip_tour=1');
    showFirstRunIfNeeded(deps);
    expect(document.querySelector('[data-testid="walkthrough-modal"]')).toBeNull();
    expect(getHasSeenActionableGuide()).toBe(true);
  });

  it('shows the tour without the parameter (outside the web E2E build)', () => {
    window.history.replaceState(null, '', '/?mode=native');
    const hmr = process.env.DISABLE_HMR;
    delete process.env.DISABLE_HMR;
    try {
      showFirstRunIfNeeded(deps);
    } finally {
      if (hmr !== undefined) process.env.DISABLE_HMR = hmr;
    }
    expect(getHasSeenActionableGuide()).toBe(false);
  });
});
