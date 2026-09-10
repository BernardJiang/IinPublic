/**
 * Saves a blob: URL to disk. Prefers the File System Access API's save picker (lets the user
 * choose where; falls through to the anchor-download trick below on cancel/AbortError or when
 * unavailable — most browsers besides Chromium-based ones).
 */
export async function saveObjectUrlAs(objectUrl: string, name: string, mimeType: string): Promise<void> {
  const anySelf = window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<unknown> };
  if (typeof anySelf.showSaveFilePicker === 'function') {
    try {
      const dot = name.lastIndexOf('.');
      const ext = dot > 0 ? name.slice(dot) : '';
      const handle = await anySelf.showSaveFilePicker({
        suggestedName: name,
        ...(ext ? { types: [{ description: 'File', accept: { [mimeType || 'application/octet-stream']: [ext] } }] } : {}),
      }) as { createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }> };
      const blob = await (await fetch(objectUrl)).blob();
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled the picker, or it's unavailable — fall through to the anchor.
      if ((err as Error)?.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
