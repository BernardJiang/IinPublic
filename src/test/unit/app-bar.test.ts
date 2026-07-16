/**
 * @jest-environment jsdom
 */

import { renderAppBar, updateOverflow, registerAppBarStyles, AppBarAction } from '../../web/ui/app-bar';

function stubWidth(el: HTMLElement, width: number): void {
    Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
}

function makeAction(overrides: Partial<AppBarAction> = {}): AppBarAction {
    return {
        icon: '➕',
        label: 'Create',
        onClick: jest.fn(),
        ...overrides,
    };
}

describe('renderAppBar', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    it('renders back button when backAction provided', () => {
        const backAction = makeAction({ icon: '‹', label: 'Back' });
        const appBar = renderAppBar({ statusText: 'Status', backAction, actions: [] });

        const backBtn = appBar.querySelector('.app-bar-back-btn');
        expect(backBtn).not.toBeNull();
        expect(appBar.querySelector('.app-bar-left-spacer')).toBeNull();

        (backBtn as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(backAction.onClick).toHaveBeenCalledTimes(1);
    });

    it('renders a spacer instead of a back button when no backAction', () => {
        const appBar = renderAppBar({ statusText: 'Status', actions: [] });
        expect(appBar.querySelector('.app-bar-back-btn')).toBeNull();
        expect(appBar.querySelector('.app-bar-left-spacer')).not.toBeNull();
    });

    it('renders all actions inline when they fit', () => {
        const actions = [makeAction({ icon: '➕' }), makeAction({ icon: '📣' })];
        const appBar = renderAppBar({ statusText: 'Status', actions });

        const inlineButtons = appBar.querySelectorAll('.app-bar-actions .app-bar-action-btn');
        expect(inlineButtons.length).toBe(2);
        expect((appBar.querySelector('.app-bar-overflow-menu') as HTMLElement).style.display).toBe('none');
    });

    it('pushes low-priority actions to overflow when narrow', () => {
        const actions = [
            makeAction({ icon: '➕', label: 'Create' }),
            makeAction({ icon: '📣', label: 'Broadcast' }),
            makeAction({ icon: '🏠', label: 'Home' }),
        ];
        const appBar = renderAppBar({ statusText: 'Status', actions });

        stubWidth(appBar, 200);
        stubWidth(appBar.querySelector('.app-bar-left') as HTMLElement, 0);
        stubWidth(appBar.querySelector('.app-bar-center') as HTMLElement, 0);
        const buttons = Array.from(appBar.querySelectorAll<HTMLElement>('.app-bar-actions .app-bar-action-btn'));
        for (const btn of buttons) stubWidth(btn, 60);

        updateOverflow(appBar);

        const hiddenInline = buttons.filter((btn) => btn.style.display === 'none');
        expect(hiddenInline.length).toBeGreaterThan(0);
        // Highest-priority action (index 0) stays inline; lower-priority ones overflow first.
        expect(hiddenInline.map((btn) => btn.dataset.actionIndex)).not.toContain('0');

        const overflowItems = appBar.querySelectorAll('.app-bar-overflow-panel .app-bar-overflow-item');
        expect(overflowItems.length).toBe(hiddenInline.length);
        expect((appBar.querySelector('.app-bar-overflow-menu') as HTMLElement).style.display).toBe('flex');
    });

    it('hides overflow menu when all actions inline', () => {
        const actions = [makeAction({ icon: '➕' })];
        const appBar = renderAppBar({ statusText: 'Status', actions });

        stubWidth(appBar, 1000);
        stubWidth(appBar.querySelector('.app-bar-left') as HTMLElement, 0);
        stubWidth(appBar.querySelector('.app-bar-center') as HTMLElement, 0);
        const btn = appBar.querySelector('.app-bar-action-btn') as HTMLElement;
        stubWidth(btn, 36);

        updateOverflow(appBar);

        expect((appBar.querySelector('.app-bar-overflow-menu') as HTMLElement).style.display).toBe('none');
        expect(appBar.querySelectorAll('.app-bar-overflow-panel .app-bar-overflow-item').length).toBe(0);
    });

    it('overflow panel appears on click and closes on outside click', () => {
        const actions = [makeAction({ icon: '➕' }), makeAction({ icon: '📣' })];
        const appBar = renderAppBar({ statusText: 'Status', actions });
        document.body.appendChild(appBar);

        stubWidth(appBar, 150);
        stubWidth(appBar.querySelector('.app-bar-left') as HTMLElement, 0);
        stubWidth(appBar.querySelector('.app-bar-center') as HTMLElement, 0);
        for (const btn of Array.from(appBar.querySelectorAll<HTMLElement>('.app-bar-action-btn'))) {
            stubWidth(btn, 60);
        }
        updateOverflow(appBar);

        const overflowBtn = appBar.querySelector('.app-bar-overflow-btn') as HTMLElement;
        const overflowPanel = appBar.querySelector('.app-bar-overflow-panel') as HTMLElement;
        expect(overflowPanel.classList.contains('open')).toBe(false);

        overflowBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(overflowPanel.classList.contains('open')).toBe(true);

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(overflowPanel.classList.contains('open')).toBe(false);
    });

    it('disabled action is greyed out and not clickable', () => {
        const disabledAction = makeAction({ icon: '🚫', label: 'Blocked', disabled: true });
        const appBar = renderAppBar({ statusText: 'Status', actions: [disabledAction] });

        const btn = appBar.querySelector('.app-bar-action-btn') as HTMLElement;
        expect(btn.classList.contains('disabled')).toBe(true);
        expect(btn.getAttribute('aria-disabled')).toBe('true');

        btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(disabledAction.onClick).not.toHaveBeenCalled();
    });

    it('hidden action is not rendered at all', () => {
        const actions = [makeAction({ icon: '➕' }), makeAction({ icon: '🆕', hidden: true })];
        const appBar = renderAppBar({ statusText: 'Status', actions });

        const inlineButtons = appBar.querySelectorAll('.app-bar-actions .app-bar-action-btn');
        expect(inlineButtons.length).toBe(1);
        expect((inlineButtons[0] as HTMLElement).dataset.actionIndex).toBe('0');
    });

    it('registerAppBarStyles injects styles once', () => {
        registerAppBarStyles();
        registerAppBarStyles();
        expect(document.head.querySelectorAll('#app-bar-styles').length).toBe(1);
    });
});
