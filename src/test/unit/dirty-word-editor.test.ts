/** @jest-environment jsdom */

import { bindDirtyWordEditor } from '../../web/ui/dirty-word-editor';

function chipWords(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.dirty-word-chip')).map(
    (el) => el.getAttribute('data-word') || '',
  );
}

function renderFixture(initialWords: string[] = ['damn', 'heck']): void {
  document.body.innerHTML = `
    <div id="dirty-word-chips">
      ${initialWords
        .map(
          (word) =>
            `<span class="dirty-word-chip" data-word="${word}"><span>${word}</span><button type="button" class="dirty-word-chip-remove" data-word="${word}">x</button></span>`,
        )
        .join('')}
    </div>
    <input type="text" id="dirty-word-add-input">
    <button type="button" id="dirty-word-add-btn">Add</button>
    <button type="button" id="dirty-word-reset-btn">Reset</button>
    <div id="dirty-word-error"></div>
  `;
}

const t = (key: string): string => key;

function bind(onChange = jest.fn()) {
  bindDirtyWordEditor({ onChange, t: t as any });
  return { onChange };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('bindDirtyWordEditor', () => {
  it('does nothing when the chips container is absent', () => {
    document.body.innerHTML = '<div></div>';
    expect(() => bind()).not.toThrow();
  });

  it('adds a new word as a chip and clears the input, firing onChange', () => {
    renderFixture([]);
    const { onChange } = bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = 'darn';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chipWords()).toEqual(['darn']);
    expect(input.value).toBe('');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('adds on Enter in the input, not on other keys', () => {
    renderFixture([]);
    bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = 'darn';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    expect(chipWords()).toEqual([]);

    input.value = 'darn';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(chipWords()).toEqual(['darn']);
  });

  it('rejects a word shorter than 2 characters with an error, no chip, no onChange', () => {
    renderFixture([]);
    const { onChange } = bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = 'a';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chipWords()).toEqual([]);
    expect(document.getElementById('dirty-word-error')!.textContent).toBe('settingsDirtyWordTooShort');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects a duplicate word (case/whitespace-insensitive) with an error', () => {
    renderFixture(['darn']);
    const { onChange } = bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = '  DARN  ';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chipWords()).toEqual(['darn']);
    expect(document.getElementById('dirty-word-error')!.textContent).toBe('settingsDirtyWordDuplicate');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('rejects adding a 51st word at the 50-word limit', () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `word${i}`);
    renderFixture(fifty);
    const { onChange } = bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = 'onemore';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chipWords()).toHaveLength(50);
    expect(document.getElementById('dirty-word-error')!.textContent).toBe('settingsDirtyWordLimit');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a chip when its remove button is clicked, firing onChange', () => {
    renderFixture(['damn', 'heck']);
    const { onChange } = bind();
    document
      .querySelector('.dirty-word-chip-remove[data-word="damn"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(chipWords()).toEqual(['heck']);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears any error message on a subsequent successful action', () => {
    renderFixture([]);
    bind();
    const input = document.getElementById('dirty-word-add-input') as HTMLInputElement;
    input.value = 'a';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('dirty-word-error')!.textContent).toBe('settingsDirtyWordTooShort');

    input.value = 'darn';
    document.getElementById('dirty-word-add-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('dirty-word-error')!.textContent).toBe('');
  });

  it('reset restores the compiled default word list, firing onChange', () => {
    renderFixture(['custom-only-word']);
    const { onChange } = bind();
    document.getElementById('dirty-word-reset-btn')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const words = chipWords();
    expect(words).not.toContain('custom-only-word');
    expect(words.length).toBeGreaterThan(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
