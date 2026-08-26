import { escapeHtml } from './ui-formatters';
import { syncAdultLockFromBuiltInKinds } from './talk-editor-form-helpers';
import type { BuiltInQuestionKind } from '../../shared/types';
import type { RouteEditorQuestion, RouteEditorText } from './route-editor-model';

export interface RouteEditorRenderDeps {
  getQuestions: () => RouteEditorQuestion[];
  replaceQuestions: (questions: RouteEditorQuestion[]) => void;
  text: RouteEditorText;
}

/** Renders and binds the route DAG editor while all mutable state remains explicitly injected. */
export function renderRouteEditor(host: HTMLElement, deps: RouteEditorRenderDeps): void {
  let questions = deps.getQuestions();
  const text = deps.text;
  const rerender = (): void => {
    deps.replaceQuestions(questions);
    renderRouteEditor(host, deps);
  };
  // Build children index from parentAnswer refs.
  const childrenOf = new Map<string, string[]>(); // key = parentAnswerId "qid::aid", value = child question ids
  const roots: string[] = [];
  for (const q of questions) {
    if (!q.parentAnswer) {
      roots.push(q.id);
    } else {
      const key = `${q.parentAnswer.questionId}::${q.parentAnswer.answerId}`;
      const arr = childrenOf.get(key) ?? [];
      arr.push(q.id);
      childrenOf.set(key, arr);
    }
  }
  const byId = new Map(questions.map((q) => [q.id, q]));
  // Position labels (e.g. "1.2", "1.2.1") so an author can find which on-screen box a
  // validation error like "question q_15" refers to — internal ids don't reveal depth or
  // position, and a deep DAG can have dozens of nodes that look identical at a glance. Each
  // child's label is its parent's label + a running index over ALL of that parent's children
  // (builtIn's synthetic compatible-branch child, or any ordinary answer's child) in render
  // order; each answer's label is its question's label + its own 1-based position.
  const renderNode = (qid: string, depth: number, label: string): string => {
    const q = byId.get(qid);
    if (!q) return '';
    const indent = `margin-left:${depth * 20}px;`;
    let childCounter = 0;
    const nextChildLabel = (): string => `${label}.${++childCounter}`;
    // §BB / spec §30.5: a builtIn node has no AUTHORED answers (TalkAutofix.fix / this
    // editor's own `collectRouteEditorQuestions` generate the synthetic "Compatible"/"Not
    // compatible" pair) but its one implicit "compatible" outcome CAN still fork further —
    // this is exactly the "shared timeFrame/location asked once at the root, then the route
    // branches" pattern spec §30.5 describes. The synthetic compatible answer's fixed id
    // (`${q.id}_compatible`, matching TalkAutofix's own naming) is the parent-answer key a
    // child links against, kept in sync with `collectRouteEditorQuestions` below.
    const builtInKind = q.builtIn?.kind || '';
    const builtInCompatibleAid = `${q.id}_compatible`;
    const builtInChildIds = q.builtIn
      ? (childrenOf.get(`${q.id}::${builtInCompatibleAid}`) ?? [])
      : [];
    const builtInAddChildLabel =
      builtInChildIds.length === 0 ? text('editorRouteAddChild') : text('editorRouteAddParallel');
    const builtInHtml = `
        <div class="route-builtin-controls" style="margin: 6px 0 6px 18px; display:flex; flex-wrap:wrap; align-items:center; gap:8px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:0.85em; color:var(--text-secondary);">
            ${text('editorBuiltInKindLabel')}
            <select class="form-input route-builtin-kind" data-qid="${q.id}" style="flex:0 0 auto; width:auto; font-size:0.9em;">
              <option value="" ${builtInKind === '' ? 'selected' : ''}>${text('editorBuiltInKindNone')}</option>
              <option value="quantity" ${builtInKind === 'quantity' ? 'selected' : ''}>${text('editorBuiltInKindQuantity')}</option>
              <option value="priceRange" ${builtInKind === 'priceRange' ? 'selected' : ''}>${text('editorBuiltInKindPriceRange')}</option>
              <option value="timeFrame" ${builtInKind === 'timeFrame' ? 'selected' : ''}>${text('editorBuiltInKindTimeFrame')}</option>
              <option value="location" ${builtInKind === 'location' ? 'selected' : ''}>${text('editorBuiltInKindLocation')}</option>
              <option value="ageRange" ${builtInKind === 'ageRange' ? 'selected' : ''}>${text('editorBuiltInKindAgeRange')}</option>
            </select>
          </label>
          ${
            builtInKind === 'quantity'
              ? `
            <label style="font-size:0.85em;">${text('editorBuiltInQuantityLabel')}
              <input type="number" class="form-input route-builtin-quantity-input" data-qid="${q.id}" value="${q.builtIn?.quantity ?? ''}" style="width:120px; display:inline-block;">
            </label>`
              : ''
          }
          ${
            builtInKind === 'priceRange'
              ? `
            <label style="font-size:0.85em;">${text('editorBuiltInPriceMinLabel')}
              <input type="number" class="form-input route-builtin-pricerange-min" data-qid="${q.id}" value="${q.builtIn?.priceRange?.min ?? ''}" style="width:100px; display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${text('editorBuiltInPriceMaxLabel')}
              <input type="number" class="form-input route-builtin-pricerange-max" data-qid="${q.id}" value="${q.builtIn?.priceRange?.max ?? ''}" style="width:100px; display:inline-block;">
            </label>`
              : ''
          }
          ${
            builtInKind === 'timeFrame'
              ? `
            <label style="font-size:0.85em;">${text('editorBuiltInTimeStartLabel')}
              <input type="date" class="form-input route-builtin-timeframe-start" data-qid="${q.id}" value="${q.builtIn?.timeFrame ? new Date(q.builtIn.timeFrame.start).toISOString().slice(0, 10) : ''}" style="display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${text('editorBuiltInTimeEndLabel')}
              <input type="date" class="form-input route-builtin-timeframe-end" data-qid="${q.id}" value="${q.builtIn?.timeFrame ? new Date(q.builtIn.timeFrame.end).toISOString().slice(0, 10) : ''}" style="display:inline-block;">
            </label>`
              : ''
          }
          ${builtInKind === 'location' ? `<span style="font-size:0.8em; color:var(--text-secondary);">${text('editorBuiltInLocationNote')}</span>` : ''}
          ${
            builtInKind === 'ageRange'
              ? `
            <label style="font-size:0.85em;">${text('editorBuiltInAgeLabel')}
              <input type="number" class="form-input route-builtin-agerange-age" data-qid="${q.id}" value="${q.builtIn?.ageRange?.age ?? ''}" style="width:90px; display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${text('editorBuiltInAgeMinLabel')}
              <input type="number" class="form-input route-builtin-agerange-min" data-qid="${q.id}" value="${q.builtIn?.ageRange?.acceptableRange?.min ?? ''}" style="width:90px; display:inline-block;">
            </label>
            <label style="font-size:0.85em;">${text('editorBuiltInAgeMaxLabel')}
              <input type="number" class="form-input route-builtin-agerange-max" data-qid="${q.id}" value="${q.builtIn?.ageRange?.acceptableRange?.max ?? ''}" style="width:90px; display:inline-block;">
            </label>`
              : ''
          }
        </div>
      `;
    // Reuses the exact same `.route-add-child-btn`/`.route-parallel-threshold` handlers an
    // ordinary answer row already wires (they key off data-qid/data-aid alone, not on
    // whether `parentQ.answers` actually contains that id — a builtIn node's synthetic
    // answer never lives in the live editor's `q.answers`, only in what gets emitted at
    // save time, exactly like TalkAutofix already treats it for the leaf-only case).
    const builtInChildHtml = builtInKind
      ? `
        <div style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
          <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${builtInCompatibleAid}" style="font-size:0.8em; background:var(--accent); color:white; padding:2px 6px;">${builtInAddChildLabel}</button>
        </div>
        ${builtInChildIds.map((c) => renderNode(c, depth + 1, nextChildLabel())).join('')}
      `
      : '';
    // docs/TODO.md §LL.2 follow-up: a Simple/Pair tag question is structurally fixed to exactly
    // one non-ignore answer (TalkValidator.validateTagKindFields) — the editor now reflects
    // that instead of showing free-form multi-answer chrome the data model can never actually
    // use. Non-destructive: only the RENDER is filtered, `q.answers` itself is untouched, so
    // unchecking either box later restores every previously-hidden answer exactly as it was.
    const isTagKind = !q.builtIn && (q.tagKind === 'simple' || !!q.reciprocalTagContext);
    const visibleAnswers = isTagKind ? q.answers.filter((a) => !a.isIgnore).slice(0, 1) : q.answers;
    const answersHtml = q.builtIn
      ? ''
      : visibleAnswers
          .map((a, answerIdx) => {
            const answerLabel = `${label}.${answerIdx + 1}`;
            const childIds = childrenOf.get(`${q.id}::${a.id}`) ?? [];
            const kind = a.isMatch
              ? text('editorRouteKindMatch')
              : a.isIgnore
                ? text('editorRouteKindIgnore')
                : a.isTerminal
                  ? text('editorRouteKindTerminal')
                  : text('editorRouteKindLink');
            // Fan-out (types.ts's Answer.nextQuestionIds): once an answer has its first child,
            // the button adds a PARALLEL sibling instead of extending a single chain — e.g. an
            // "iPhone" answer fanning out into Model/Condition/Price-range, each side answerable
            // in either order. No cap on the number of children (the old one-child limit only
            // ever reflected a UI gate, not a real data-model constraint for 2+).
            const addChildLabel =
              childIds.length === 0 ? text('editorRouteAddChild') : text('editorRouteAddParallel');
            const thresholdHtml =
              childIds.length >= 2
                ? `
            <label style="display:flex; align-items:center; gap:6px; margin:4px 0 4px 18px; font-size:0.8em; color:var(--text-secondary);">
              ${text('editorRouteParallelThresholdLabel').replace('{count}', String(childIds.length))}
              <input type="number" class="form-input route-parallel-threshold" data-qid="${q.id}" data-aid="${a.id}"
                min="1" max="${childIds.length}" placeholder="${text('editorRouteParallelThresholdAll')}"
                value="${a.parallelMatchThreshold ?? ''}" style="width:70px; display:inline-block;">
            </label>`
                : '';
            // Simple tag (self-match): frozen — matches the answer text to the question, mirroring
            // TalkAutofix's already-enforced invariant. Pair tag keeps this editable (the whole
            // point is a divergent accepted answer).
            const frozen = isTagKind && q.tagKind === 'simple';
            // No answer auto-defaults to Ignore anymore (a responder always has their own
            // universal decline regardless of the talk's own answers) — new answers default to
            // Match instead. An outcome answer (no child yet — a Link's kind isn't editable,
            // there's nothing to toggle once it continues the DAG) still gets an explicit
            // Match/Ignore choice here for the rare branch an author DOES want to design as a
            // deliberate decline distinct from silence.
            const kindHtml =
              childIds.length === 0
                ? `
              <select class="form-input route-answer-kind-select" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; padding:2px 4px; width:auto; flex:0 0 auto;">
                <option value="match" ${!a.isIgnore ? 'selected' : ''}>${text('editorRouteKindMatch')}</option>
                <option value="ignore" ${a.isIgnore ? 'selected' : ''}>${text('editorRouteKindIgnore')}</option>
              </select>`
                : `<span class="route-answer-kind" style="font-size:0.8em; padding:2px 6px; border-radius:10px; background:var(--accent-soft); color:var(--accent-text);">${kind}</span>`;
            return `
            <div class="route-answer" data-qid="${q.id}" data-aid="${a.id}" style="display:flex; align-items:center; gap:8px; margin:4px 0 4px 18px;">
              <span class="route-answer-label" style="font-size:0.72em; opacity:0.55; min-width:32px;" title="${a.id}">a${answerLabel}</span>
              ${kindHtml}
              <input type="text" class="form-input route-answer-text" value="${escapeHtml(a.text)}" placeholder="${text('editorRouteAnswerPlaceholder')}" data-qid="${q.id}" data-aid="${a.id}" ${frozen ? 'readonly' : ''} style="flex:1; ${frozen ? 'background:var(--bg-subtle);' : ''}">
              <button type="button" class="btn route-add-child-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--accent); color:white; padding:2px 6px;">${addChildLabel}</button>
              <button type="button" class="btn route-remove-answer-btn" data-qid="${q.id}" data-aid="${a.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">×</button>
            </div>
            ${thresholdHtml}
            ${childIds.map((c) => renderNode(c, depth + 1, nextChildLabel())).join('')}
          `;
          })
          .join('');
    return `
        <div class="route-node" data-qid="${q.id}" style="border:1px solid var(--border); border-radius:6px; padding:8px; margin:6px 0; ${indent} background:var(--bg-subtle);">
          <div style="display:flex; align-items:center; gap:8px;">
            <strong style="color:var(--accent);">${text('editorRouteQuestionPrefix')} ${label}</strong>
            <span style="font-size:0.72em; opacity:0.55;" title="internal id">(${q.id})</span>
            <input type="text" class="form-input route-question-text" value="${escapeHtml(q.text)}" placeholder="${text('editorRouteQuestionPlaceholder')}" data-qid="${q.id}" style="flex:1;">
            ${q.builtIn || isTagKind ? '' : `<button type="button" class="btn route-add-answer-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--success); color:white; padding:2px 6px;">${text('editorAddAnswer')}</button>`}
            ${q.parentAnswer ? `<button type="button" class="btn route-remove-question-btn" data-qid="${q.id}" style="font-size:0.8em; background:var(--danger); color:white; padding:2px 6px;">${text('editorRouteRemoveQuestion')}</button>` : ''}
          </div>
          <details class="route-node-advanced" data-qid="${q.id}" style="margin-top:6px;" ${(q.tagKind === 'simple' || q.reciprocalTagContext || q.builtIn?.kind) ? 'open' : ''}>
            <summary style="cursor:pointer; font-size:0.82em; color:var(--text-secondary); user-select:none;">${text('editorAdvancedToggle')}</summary>
            <div style="margin-top:4px;">
              ${
                q.builtIn
                  ? ''
                  : `
              <label style="display:flex; align-items:center; gap:6px; margin:6px 0 0 0; font-size:0.82em; color:var(--text-secondary);">
                <input type="checkbox" class="route-question-simple-tag" data-qid="${q.id}" ${q.tagKind === 'simple' ? 'checked' : ''}>
                ${text('editorSimpleTagLabel')}
              </label>
              <label style="display:flex; align-items:center; gap:6px; margin:6px 0 0 0; font-size:0.82em; color:var(--text-secondary);">
                <input type="checkbox" class="route-question-reciprocal-tag" data-qid="${q.id}" ${q.reciprocalTagContext ? 'checked' : ''}>
                ${text('editorReciprocalTagLabel')}
              </label>`
              }
              ${builtInHtml}
            </div>
          </details>
          ${builtInChildHtml}
          ${answersHtml}
        </div>
      `;
  };
  host.innerHTML = roots.map((r, i) => renderNode(r, 0, String(i + 1))).join('');

  // Bind events (delegation-free for clarity).
  host.querySelectorAll<HTMLInputElement>('.route-question-text').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q) return;
      q.text = inp.value;
      // Tag-style self-match: mirror the question text onto its one real answer until the
      // author edits that answer directly (matchAnswerDirty), same convenience §LL gives
      // type:'tag' talks. Ambiguous with 2+ non-Ignore answers, so skip those.
      if (!q.matchAnswerDirty) {
        const real = q.answers.filter((a) => !a.isIgnore);
        if (real.length === 1) {
          real[0].text = inp.value;
          const answerInput = host.querySelector<HTMLInputElement>(
            `.route-answer-text[data-qid="${q.id}"][data-aid="${real[0].id}"]`,
          );
          if (answerInput) answerInput.value = inp.value;
        }
      }
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-question-reciprocal-tag').forEach((cb) => {
    cb.addEventListener('change', () => {
      const q = byId.get(cb.dataset.qid!);
      if (!q) return;
      q.reciprocalTagContext = cb.checked;
      // docs/TODO.md §LL follow-up: mutually exclusive with "Simple tag" — see the flow/survey
      // editor's identical exclusion (talk-editor-form-helpers.ts). A full re-render (not just
      // a DOM patch) picks up the answer-row freeze/hide rules that now depend on this state.
      if (cb.checked) delete q.tagKind;
      rerender();
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-question-simple-tag').forEach((cb) => {
    cb.addEventListener('change', () => {
      const q = byId.get(cb.dataset.qid!);
      if (!q) return;
      if (cb.checked) {
        q.tagKind = 'simple';
        q.reciprocalTagContext = false;
      } else {
        delete q.tagKind;
      }
      rerender();
    });
  });
  host.querySelectorAll<HTMLSelectElement>('.route-builtin-kind').forEach((sel) => {
    sel.addEventListener('change', () => {
      const q = byId.get(sel.dataset.qid!);
      if (!q) return;
      if (!sel.value) {
        delete q.builtIn;
      } else {
        q.builtIn = { kind: sel.value as BuiltInQuestionKind };
      }
      rerender();
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-quantity-input').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.quantity = Number(inp.value);
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-pricerange-min').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.priceRange = { min: Number(inp.value), max: q.builtIn.priceRange?.max ?? NaN };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-pricerange-max').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.priceRange = { min: q.builtIn.priceRange?.min ?? NaN, max: Number(inp.value) };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-timeframe-start').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      const start = inp.value ? new Date(inp.value).getTime() : NaN;
      q.builtIn.timeFrame = { start, end: q.builtIn.timeFrame?.end ?? NaN };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-timeframe-end').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      const end = inp.value ? new Date(inp.value).getTime() : NaN;
      q.builtIn.timeFrame = { start: q.builtIn.timeFrame?.start ?? NaN, end };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-agerange-age').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.ageRange = {
        age: Number(inp.value),
        acceptableRange: q.builtIn.ageRange?.acceptableRange ?? { min: NaN, max: NaN },
      };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-agerange-min').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.ageRange = {
        age: q.builtIn.ageRange?.age ?? NaN,
        acceptableRange: { min: Number(inp.value), max: q.builtIn.ageRange?.acceptableRange?.max ?? NaN },
      };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-builtin-agerange-max').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q?.builtIn) return;
      q.builtIn.ageRange = {
        age: q.builtIn.ageRange?.age ?? NaN,
        acceptableRange: { min: q.builtIn.ageRange?.acceptableRange?.min ?? NaN, max: Number(inp.value) },
      };
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-answer-text').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q) return;
      const a = q.answers.find((x) => x.id === inp.dataset.aid);
      if (a) a.text = inp.value;
      // Editing the answer directly opts out of the question-text auto-mirror above.
      q.matchAnswerDirty = true;
    });
  });
  host.querySelectorAll<HTMLSelectElement>('.route-answer-kind-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const q = byId.get(sel.dataset.qid!);
      if (!q) return;
      const a = q.answers.find((x) => x.id === sel.dataset.aid);
      if (!a) return;
      a.isIgnore = sel.value === 'ignore';
      a.isMatch = sel.value === 'match';
    });
  });
  host.querySelectorAll<HTMLInputElement>('.route-parallel-threshold').forEach((inp) => {
    inp.addEventListener('input', () => {
      const q = byId.get(inp.dataset.qid!);
      if (!q) return;
      const a = q.answers.find((x) => x.id === inp.dataset.aid);
      if (!a) return;
      const n = Number(inp.value);
      if (inp.value.trim() && Number.isInteger(n) && n > 0) {
        a.parallelMatchThreshold = n;
      } else {
        delete a.parallelMatchThreshold;
      }
    });
  });
  host.querySelectorAll<HTMLButtonElement>('.route-add-answer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = byId.get(btn.dataset.qid!);
      if (!q) return;
      const idx = q.answers.length;
      q.answers.push({
        id: `${q.id}_a${idx}`,
        text: text('editorRouteNewAnswer'),
        isMatch: true,
        isTerminal: true,
      });
      rerender();
    });
  });
  host.querySelectorAll<HTMLButtonElement>('.route-remove-answer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = byId.get(btn.dataset.qid!);
      if (!q) return;
      q.answers = q.answers.filter((a) => a.id !== btn.dataset.aid);
      // Also cascade-remove any children of this answer.
      const killKey = `${btn.dataset.qid}::${btn.dataset.aid}`;
      questions = questions.filter((qq) => {
        if (!qq.parentAnswer) return true;
        const key = `${qq.parentAnswer.questionId}::${qq.parentAnswer.answerId}`;
        return key !== killKey;
      });
      rerender();
    });
  });
  host.querySelectorAll<HTMLButtonElement>('.route-add-child-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const parentQid = btn.dataset.qid!;
      const parentAid = btn.dataset.aid!;
      const newId = `q_${questions.length}`;
      // Promote the chosen parent answer to a linking answer (not terminal/match/ignore).
      const parentQ = byId.get(parentQid);
      if (parentQ) {
        const parentAnswer = parentQ.answers.find((a) => a.id === parentAid);
        if (parentAnswer) {
          delete parentAnswer.isMatch;
          delete parentAnswer.isIgnore;
          parentAnswer.isTerminal = false;
        }
      }
      // No auto-seeded "Ignore" answer here either (see route-editor-model.ts's blank
      // default) — just the one Match outcome; add another answer and mark it Ignore
      // explicitly if this branch actually needs a designed decline.
      questions.push({
        id: newId,
        text: '',
        parentAnswer: { questionId: parentQid, answerId: parentAid },
        answers: [{ id: `${newId}_match`, text: '', isMatch: true, isTerminal: true }],
        matchAnswerDirty: false,
      });
      rerender();
    });
  });
  host.querySelectorAll<HTMLButtonElement>('.route-remove-question-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.qid!;
      // Remove target and its descendants.
      const keep = new Set<string>();
      const mark = (id: string) => {
        keep.add(id);
        for (const qq of questions) {
          if (qq.parentAnswer && qq.parentAnswer.questionId === id) {
            // Do not keep descendants of target.
          }
        }
      };
      // Build a child map and BFS from target to collect descendants.
      const childMap = new Map<string, string[]>();
      for (const qq of questions) {
        if (qq.parentAnswer) {
          const arr = childMap.get(qq.parentAnswer.questionId) ?? [];
          arr.push(qq.id);
          childMap.set(qq.parentAnswer.questionId, arr);
        }
      }
      const dead = new Set<string>([target]);
      const stack = [target];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const child of childMap.get(cur) ?? []) {
          if (!dead.has(child)) {
            dead.add(child);
            stack.push(child);
          }
        }
      }
      questions = questions.filter((qq) => !dead.has(qq.id));
      void keep; // silence unused
      void mark;
      rerender();
    });
  });

  // Keeps the "Adult content" lock in sync with a route ageRange node, same as the flow editor's
  // own builtin-kind change handler — every route re-render (initial load or user edit) passes
  // back through here, so a single call after each render covers both cases.
  const form = host.closest('form');
  if (form) syncAdultLockFromBuiltInKinds(form);
}
