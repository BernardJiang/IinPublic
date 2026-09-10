/** @jest-environment jsdom */

import { showDetailsPopupFor } from '../../web/ui/item-details-popup';

const t = (key: string): string => key;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('showDetailsPopupFor', () => {
  it('moves the details element into the popup body', () => {
    const original = document.createElement('div');
    const details = document.createElement('div');
    details.id = 'my-details';
    details.style.display = 'none';
    original.appendChild(details);
    document.body.appendChild(original);

    showDetailsPopupFor(details, original, t);

    expect(document.querySelector('.item-details-popup-body')!.contains(details)).toBe(true);
    expect(details.style.display).toBe('block');
    expect(original.contains(details)).toBe(false);
  });

  it('restores the details element to its original parent, hidden, on close', () => {
    const original = document.createElement('div');
    const details = document.createElement('div');
    original.appendChild(details);
    document.body.appendChild(original);

    showDetailsPopupFor(details, original, t);
    document.getElementById('close-item-details-popup')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(original.contains(details)).toBe(true);
    expect(details.style.display).toBe('none');
    expect(document.getElementById('item-details-popup')).toBeNull();
  });

  it('closes on a backdrop click but not on a click inside the modal content', () => {
    const original = document.createElement('div');
    const details = document.createElement('div');
    original.appendChild(details);
    document.body.appendChild(original);

    showDetailsPopupFor(details, original, t);
    const modal = document.getElementById('item-details-popup')!;
    modal.querySelector('.modal-content')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('item-details-popup')).not.toBeNull();

    modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.getElementById('item-details-popup')).toBeNull();
  });

  it('replaces a stale popup from a previous call', () => {
    const original = document.createElement('div');
    const detailsA = document.createElement('div');
    const detailsB = document.createElement('div');
    original.append(detailsA, detailsB);
    document.body.appendChild(original);

    showDetailsPopupFor(detailsA, original, t);
    showDetailsPopupFor(detailsB, original, t);

    expect(document.querySelectorAll('#item-details-popup').length).toBe(1);
    expect(document.querySelector('.item-details-popup-body')!.contains(detailsB)).toBe(true);
  });
});
