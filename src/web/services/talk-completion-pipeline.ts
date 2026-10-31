/**
 * Order for Talk completions (answer submissions).
 *
 * The work itself runs one at a time: GUN/SEA signs writes in the user namespace and overlapping
 * completions race that signer ("Unverified data", commit 83b5be1e). What a completion first has
 * to wait for — the author's encryption key, a network lookup of up to ~26 s — is not part of that
 * line: each completion waits for its own prerequisite and only then joins the line, so one
 * unknown key no longer holds up every later answer (docs/testing/gui-responsiveness-audit.md F7).
 * Completions with the same order key (the same Talk) still run in the order submitted.
 */
export class TalkCompletionPipeline {
  private line: Promise<void> = Promise.resolve();
  private readonly byKey = new Map<string, Promise<void>>();

  submit<T>(orderKey: string, prerequisite: Promise<unknown>, run: () => Promise<T>): Promise<T> {
    const ready = (this.byKey.get(orderKey) ?? Promise.resolve())
      .then(() => prerequisite)
      .then(() => undefined, () => undefined);
    const finished = ready.then(() => {
      const work = this.line.then(run);
      this.line = work.then(() => undefined, () => undefined);
      return work;
    });
    // The next completion with this key starts after this one has run, not just after its key.
    const settled = finished.then(() => undefined, () => undefined);
    this.byKey.set(orderKey, settled);
    void settled.then(() => {
      if (this.byKey.get(orderKey) === settled) this.byKey.delete(orderKey);
    });
    return finished;
  }
}
