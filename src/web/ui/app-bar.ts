export interface AppBarAction {
    icon: string;
    label: string;
    onClick: () => void;
    testId?: string;
    hidden?: boolean;
    disabled?: boolean;
}

export interface AppBarConfig {
    title?: string;
    statusText: string;
    backAction?: AppBarAction;
    actions: AppBarAction[];
}

interface AppBarElement extends HTMLDivElement {
    _actions: AppBarAction[];
    _backAction?: AppBarAction;
}

const OVERFLOW_BTN_SPACE = 50;
const OVERFLOW_ZONE_PADDING = 32;

let openOverflowAppBar: AppBarElement | null = null;
let globalListenersAttached = false;

function isAppBarElement(el: HTMLDivElement): el is AppBarElement {
    return Array.isArray((el as AppBarElement)._actions);
}

function openOverflowPanelFor(appBar: AppBarElement): void {
    if (openOverflowAppBar && openOverflowAppBar !== appBar) {
        closeOverflowPanelFor(openOverflowAppBar);
    }
    const panel = appBar.querySelector<HTMLElement>('.app-bar-overflow-panel');
    if (panel) panel.classList.add('open');
    openOverflowAppBar = appBar;
}

function closeOverflowPanelFor(appBar: AppBarElement): void {
    const panel = appBar.querySelector<HTMLElement>('.app-bar-overflow-panel');
    if (panel) panel.classList.remove('open');
    if (openOverflowAppBar === appBar) openOverflowAppBar = null;
}

function toggleOverflowPanelFor(appBar: AppBarElement): void {
    const panel = appBar.querySelector<HTMLElement>('.app-bar-overflow-panel');
    if (panel && panel.classList.contains('open')) {
        closeOverflowPanelFor(appBar);
    } else {
        openOverflowPanelFor(appBar);
    }
}

function ensureGlobalListeners(): void {
    if (globalListenersAttached) return;
    globalListenersAttached = true;

    document.addEventListener('click', (event) => {
        if (!openOverflowAppBar) return;
        const target = event.target;
        if (target instanceof Node && openOverflowAppBar.contains(target)) return;
        closeOverflowPanelFor(openOverflowAppBar);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openOverflowAppBar) {
            closeOverflowPanelFor(openOverflowAppBar);
        }
    });
}

function handleAppBarClick(appBar: AppBarElement, event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const overflowBtn = target.closest('.app-bar-overflow-btn');
    if (overflowBtn && appBar.contains(overflowBtn)) {
        toggleOverflowPanelFor(appBar);
        return;
    }

    const overflowItem = target.closest('.app-bar-overflow-item');
    if (overflowItem instanceof HTMLElement && appBar.contains(overflowItem)) {
        const index = Number(overflowItem.dataset.actionIndex);
        const action = appBar._actions[index];
        if (action && !action.disabled) {
            action.onClick();
        }
        closeOverflowPanelFor(appBar);
        return;
    }

    const backBtn = target.closest('.app-bar-back-btn');
    if (backBtn && appBar.contains(backBtn)) {
        if (appBar._backAction && !appBar._backAction.disabled) {
            appBar._backAction.onClick();
        }
        return;
    }

    const actionBtn = target.closest('.app-bar-action-btn');
    if (actionBtn instanceof HTMLElement && appBar.contains(actionBtn)) {
        const index = Number(actionBtn.dataset.actionIndex);
        const action = appBar._actions[index];
        if (action && !action.disabled) {
            action.onClick();
        }
    }
}

function buildOverflowItem(index: number, action: AppBarAction): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'app-bar-overflow-item' + (action.disabled ? ' disabled' : '');
    item.dataset.actionIndex = String(index);
    if (action.testId) item.setAttribute('data-testid', `${action.testId}-overflow`);
    if (action.disabled) item.setAttribute('aria-disabled', 'true');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'app-bar-overflow-item-icon';
    iconSpan.textContent = action.icon;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'app-bar-overflow-item-label';
    labelSpan.textContent = action.label;

    item.appendChild(iconSpan);
    item.appendChild(labelSpan);
    return item;
}

export function updateOverflow(appBar: HTMLDivElement): void {
    if (!isAppBarElement(appBar)) return;

    const leftZone = appBar.querySelector<HTMLElement>('.app-bar-left');
    const centerZone = appBar.querySelector<HTMLElement>('.app-bar-center');
    const actionsContainer = appBar.querySelector<HTMLElement>('.app-bar-actions');
    const overflowMenu = appBar.querySelector<HTMLElement>('.app-bar-overflow-menu');
    const overflowPanel = appBar.querySelector<HTMLElement>('.app-bar-overflow-panel');
    if (!leftZone || !centerZone || !actionsContainer || !overflowMenu || !overflowPanel) return;

    const barWidth = appBar.offsetWidth;
    if (barWidth === 0) return;

    const available = barWidth - leftZone.offsetWidth - centerZone.offsetWidth - OVERFLOW_BTN_SPACE - OVERFLOW_ZONE_PADDING;

    const buttons = Array.from(actionsContainer.querySelectorAll<HTMLButtonElement>('.app-bar-action-btn'));
    for (const btn of buttons) {
        btn.style.display = '';
    }

    let cumulative = 0;
    const overflowIndices: number[] = [];
    for (const btn of buttons) {
        cumulative += btn.offsetWidth;
        if (cumulative > available) {
            overflowIndices.push(Number(btn.dataset.actionIndex));
            btn.style.display = 'none';
        }
    }

    overflowPanel.innerHTML = '';
    for (const index of overflowIndices) {
        const action = appBar._actions[index];
        if (!action) continue;
        overflowPanel.appendChild(buildOverflowItem(index, action));
    }

    if (overflowIndices.length > 0) {
        overflowMenu.style.display = 'flex';
    } else {
        overflowMenu.style.display = 'none';
        closeOverflowPanelFor(appBar);
    }
}

export function renderAppBar(config: AppBarConfig): HTMLDivElement {
    registerAppBarStyles();

    const appBar = document.createElement('div') as AppBarElement;
    appBar.className = 'app-bar';
    appBar._actions = config.actions;
    if (config.backAction) {
        appBar._backAction = config.backAction;
    }

    const leftZone = document.createElement('div');
    leftZone.className = 'app-bar-left';
    if (config.backAction) {
        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'app-bar-back-btn';
        backBtn.title = 'Back';
        backBtn.textContent = '‹';
        backBtn.dataset.actionIndex = '-1';
        if (config.backAction.testId) backBtn.setAttribute('data-testid', config.backAction.testId);
        leftZone.appendChild(backBtn);
    } else {
        const spacer = document.createElement('div');
        spacer.className = 'app-bar-left-spacer';
        leftZone.appendChild(spacer);
    }

    const centerZone = document.createElement('div');
    centerZone.className = 'app-bar-center';
    if (config.title) {
        const titleEl = document.createElement('span');
        titleEl.className = 'app-bar-title';
        titleEl.textContent = config.title;
        centerZone.appendChild(titleEl);
    }
    const statusEl = document.createElement('span');
    statusEl.className = 'app-bar-status-text';
    statusEl.textContent = config.statusText;
    centerZone.appendChild(statusEl);

    const rightZone = document.createElement('div');
    rightZone.className = 'app-bar-right';

    const actionsContainer = document.createElement('span');
    actionsContainer.className = 'app-bar-actions';
    config.actions.forEach((action, index) => {
        if (action.hidden) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'app-bar-action-btn' + (action.disabled ? ' disabled' : '');
        btn.title = action.label;
        btn.textContent = action.icon;
        btn.dataset.actionIndex = String(index);
        if (action.testId) btn.setAttribute('data-testid', action.testId);
        if (action.disabled) btn.setAttribute('aria-disabled', 'true');
        actionsContainer.appendChild(btn);
    });

    const overflowMenu = document.createElement('div');
    overflowMenu.className = 'app-bar-overflow-menu';
    overflowMenu.style.display = 'none';
    const overflowBtn = document.createElement('button');
    overflowBtn.type = 'button';
    overflowBtn.className = 'app-bar-overflow-btn';
    overflowBtn.title = 'More';
    overflowBtn.textContent = '⋯';
    overflowBtn.setAttribute('data-testid', 'app-bar-overflow-btn');
    const overflowPanel = document.createElement('div');
    overflowPanel.className = 'app-bar-overflow-panel';
    overflowMenu.appendChild(overflowBtn);
    overflowMenu.appendChild(overflowPanel);

    rightZone.appendChild(actionsContainer);
    rightZone.appendChild(overflowMenu);

    appBar.appendChild(leftZone);
    appBar.appendChild(centerZone);
    appBar.appendChild(rightZone);

    appBar.addEventListener('click', (event) => handleAppBarClick(appBar, event));
    appBar.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeOverflowPanelFor(appBar);
        }
    });

    ensureGlobalListeners();
    updateOverflow(appBar);

    return appBar;
}

export function registerAppBarStyles(): void {
    if (document.getElementById('app-bar-styles')) return;

    const style = document.createElement('style');
    style.id = 'app-bar-styles';
    style.textContent = `
.app-bar {
    display: flex;
    align-items: center;
    height: 48px;
    background: #fff;
    border-bottom: 1px solid var(--border);
    padding: 0 16px;
    gap: 8px;
    position: relative;
    flex-shrink: 0;
}
.app-bar-left {
    display: flex;
    align-items: center;
    min-width: 36px;
}
.app-bar-left-spacer {
    width: 36px;
    height: 36px;
}
.app-bar-back-btn {
    width: 36px;
    height: 36px;
    background: none;
    border: none;
    font-size: 1.4em;
    cursor: pointer;
    color: #000;
    border-radius: 6px;
}
.app-bar-back-btn:hover {
    background: var(--bg-muted);
}
.app-bar-center {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 6px;
    overflow: hidden;
    white-space: nowrap;
}
.app-bar-title {
    font-size: 1.05em;
    font-weight: 600;
    color: #000;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}
.app-bar-status-text {
    font-size: 0.85em;
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
}
.app-bar-right {
    display: flex;
    align-items: center;
    gap: 2px;
    position: relative;
}
.app-bar-actions {
    display: flex;
    align-items: center;
    gap: 2px;
}
.app-bar-action-btn,
.app-bar-overflow-btn {
    width: 36px;
    height: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    font-size: 1.2em;
    cursor: pointer;
    border-radius: 6px;
    color: #000;
}
.app-bar-action-btn:hover,
.app-bar-overflow-btn:hover {
    background: var(--bg-muted);
}
.app-bar-action-btn.disabled,
.app-bar-overflow-item.disabled {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
}
.app-bar-overflow-menu {
    display: none;
    align-items: center;
    position: relative;
}
.app-bar-overflow-panel {
    display: none;
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 999;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    min-width: 180px;
    overflow: hidden;
    flex-direction: column;
}
.app-bar-overflow-panel.open {
    display: flex;
}
.app-bar-overflow-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    font-size: 0.95em;
    color: #000;
}
.app-bar-overflow-item:hover {
    background: var(--bg-muted);
}
.app-bar-overflow-item-icon {
    font-size: 1.1em;
}
`;
    document.head.appendChild(style);
}
