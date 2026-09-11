/** @jest-environment jsdom */

import { saveObjectUrlAs } from '../../web/ui/browser-file-save';

describe('saveObjectUrlAs', () => {
  afterEach(() => {
    delete (window as any).showSaveFilePicker;
    jest.restoreAllMocks();
  });

  it('uses the File System Access API save picker when available', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    const close = jest.fn().mockResolvedValue(undefined);
    const createWritable = jest.fn().mockResolvedValue({ write, close });
    const showSaveFilePicker = jest.fn().mockResolvedValue({ createWritable });
    (window as any).showSaveFilePicker = showSaveFilePicker;
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) }) as any;

    await saveObjectUrlAs('blob:abc', 'photo.png', 'image/png');

    expect(showSaveFilePicker).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestedName: 'photo.png',
        types: [{ description: 'File', accept: { 'image/png': ['.png'] } }],
      }),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('omits the types entry when the file name has no extension', async () => {
    const createWritable = jest.fn().mockResolvedValue({ write: jest.fn(), close: jest.fn() });
    const showSaveFilePicker = jest.fn().mockResolvedValue({ createWritable });
    (window as any).showSaveFilePicker = showSaveFilePicker;
    global.fetch = jest.fn().mockResolvedValue({ blob: () => Promise.resolve(new Blob(['x'])) }) as any;

    await saveObjectUrlAs('blob:abc', 'noext', 'application/octet-stream');

    expect(showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'noext' });
  });

  it('silently returns when the user cancels the save picker (AbortError)', async () => {
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const showSaveFilePicker = jest.fn().mockRejectedValue(abortError);
    (window as any).showSaveFilePicker = showSaveFilePicker;
    const appendSpy = jest.spyOn(document.body, 'appendChild');

    await saveObjectUrlAs('blob:abc', 'photo.png', 'image/png');

    // Never falls through to the anchor-download path on a genuine cancel.
    expect(appendSpy.mock.calls.some(([node]) => (node as HTMLElement).tagName === 'A')).toBe(false);
  });

  it('falls through to the anchor-download trick when the picker throws a non-abort error', async () => {
    const showSaveFilePicker = jest.fn().mockRejectedValue(new Error('not supported here'));
    (window as any).showSaveFilePicker = showSaveFilePicker;
    let clicked = false;
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      clicked = true;
    });

    await saveObjectUrlAs('blob:abc', 'photo.png', 'image/png');

    expect(clicked).toBe(true);
    clickSpy.mockRestore();
  });

  it('uses the anchor-download trick directly when the File System Access API is unavailable', async () => {
    const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await saveObjectUrlAs('blob:xyz', 'file.txt', 'text/plain');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('file.txt');
    expect(anchor.getAttribute('href')).toBe('blob:xyz');
    expect(document.body.contains(anchor)).toBe(false); // removed immediately after click
    clickSpy.mockRestore();
  });
});
