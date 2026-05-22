# Contributing

## Before you start

- Run `npm run health` to confirm the repo is clean (typecheck, lint, unit + integration tests, build).
- Check [docs/TODO.md](../TODO.md) to understand what is currently prioritized.
- For large changes, open a discussion or check an existing issue first.

## Branching

Work on a feature or fix branch off `main`. Keep branches short-lived and focused.

## Making changes

- Match the style of the surrounding code.
- Add a narrow test when you change a seam that is user-visible or integration-critical.
  Prefer tests in `src/test/unit/` or `src/test/integration/` over broad speculative coverage.
- Do not expand Android or iOS surface until the web/server talk loop is stable.

## Validation

Run the full health check before pushing:

```bash
npm run health
```

For end-to-end scenarios:

```bash
npm run test:e2e
```

## Pull requests

- Keep the PR focused on one concern.
- The description should explain *why*, not just *what*.
- CI runs `npm run health` automatically; fix failures before requesting review.

## Docs

If your change affects a user-visible code path, update the relevant doc in `docs/`:

- `docs/guides/HOW_TO_RUN.md` for run/build/test command changes
- `docs/reports/PROJECT_STATUS.md` for significant architectural changes
- `docs/roadmap/` for decisions about authority or long-term direction
- `docs/TODO.md` to add forward work
- `docs/completed.md` when finished TODO items are moved out of the backlog
