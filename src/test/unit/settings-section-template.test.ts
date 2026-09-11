import { renderSettingsSection } from '../../web/ui/settings-section-template';

describe('renderSettingsSection', () => {
  it('renders the title and body html', () => {
    const html = renderSettingsSection({ title: 'My Section' }, '<p>body</p>');
    expect(html).toContain('My Section');
    expect(html).toContain('<p>body</p>');
  });

  it('includes the id attribute only when provided', () => {
    const withId = renderSettingsSection({ id: 'sec-1', title: 'T' }, '');
    expect(withId).toContain('id="sec-1"');

    const withoutId = renderSettingsSection({ title: 'T' }, '');
    expect(withoutId).not.toContain('id="');
  });

  it('renders the subtitle only when provided', () => {
    const withSubtitle = renderSettingsSection({ title: 'T', subtitle: 'Sub' }, '');
    expect(withSubtitle).toContain('Sub');

    const withoutSubtitle = renderSettingsSection({ title: 'T' }, '');
    expect(withoutSubtitle).not.toContain('settings-section-summary"><div');
  });

  it('renders the action html in a flex-end wrapper only when provided', () => {
    const withAction = renderSettingsSection({ title: 'T', action: '<button>Go</button>' }, '');
    expect(withAction).toContain('<button>Go</button>');
    expect(withAction).toContain('justify-content:flex-end');

    const withoutAction = renderSettingsSection({ title: 'T' }, '');
    expect(withoutAction).not.toContain('<button>Go</button>');
  });

  it('uses danger-tinted colors when danger is true, and normal colors otherwise', () => {
    const danger = renderSettingsSection({ title: 'T', danger: true }, '');
    expect(danger).toContain('var(--danger-border)');
    expect(danger).toContain('var(--danger-hover)');

    const normal = renderSettingsSection({ title: 'T', danger: false }, '');
    expect(normal).not.toContain('var(--danger-border)');
    expect(normal).toContain('var(--border)');
  });
});
