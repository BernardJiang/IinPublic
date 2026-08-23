import { Talk, type IpfsAttachment, type Question } from '../../shared/types';
import { FlowCapture } from '../../shared/talk-engine';
import { WebGunService } from './web-gun-service';
import { computeTalkCIDv1, computeCIDv1, normalizeIdentityText } from '../../shared/cid';
import { GunTalkRepository } from './gun-talk-repository';

// ── Local authored-talks store (R-f debt: replaces Gun talks/* author writes) ──
const AUTHORED_TALKS_KEY = 'myAuthoredTalks';
const RECEIVED_TALKS_KEY = 'myReceivedTalks';

function loadAuthoredTalks(): Record<string, { talkJson: string; createdAt: string }> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTHORED_TALKS_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAuthoredTalk(talkId: string, talk: Talk): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const store = loadAuthoredTalks();
    store[talkId] = {
      talkJson: JSON.stringify(talk),
      createdAt: talk.createdAt instanceof Date ? talk.createdAt.toISOString() : String(talk.createdAt),
    };
    localStorage.setItem(AUTHORED_TALKS_KEY, JSON.stringify(store));
  } catch {
    // Non-fatal: localStorage unavailable (e.g. SSR/Jest without jsdom)
  }
}

/**
 * Keep the user-facing OUT list immediately usable while the authoritative Gun commit waits
 * for relay acknowledgement. UIManager.saveCreatedTalk later merges self-answer metadata into
 * the same entry, so this compatibility projection is intentionally idempotent.
 */
function projectAuthoredTalkToMyTalks(talkId: string, talk: Talk): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem('myTalks');
    const myTalks = raw ? JSON.parse(raw) : {};
    const now = new Date().toISOString();
    myTalks[talkId] = {
      ...myTalks[talkId], talkId, title: talk.title, type: talk.type,
      language: talk.language || 'en', timestamp: now, role: 'created', fullTalk: talk,
      disabled: myTalks[talkId]?.disabled ?? false,
      expiresAt: talk.expiresAt ?? undefined,
      locationRadiusMiles: talk.locationRadiusMiles ?? undefined,
      lastInteraction: now,
    };
    localStorage.setItem('myTalks', JSON.stringify(myTalks));
  } catch {
    // Compatibility projection only; Gun remains authoritative.
  }
}

function loadAuthoredTalk(talkId: string): Talk | null {
  try {
    const store = loadAuthoredTalks();
    const entry = store[talkId];
    if (!entry?.talkJson) return null;
    return JSON.parse(entry.talkJson) as Talk;
  } catch {
    return null;
  }
}

function loadReceivedTalks(): Record<string, { talkJson: string; receivedAt: string }> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(RECEIVED_TALKS_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function loadReceivedTalk(talkId: string): Talk | null {
  try {
    const entry = loadReceivedTalks()[talkId];
    return entry?.talkJson ? JSON.parse(entry.talkJson) as Talk : null;
  } catch {
    return null;
  }
}

export class WebTalkService {
  private readonly talkRepository: GunTalkRepository;

  constructor(
    private gunService: WebGunService,
    /** When set, incomplete Gun reads fall back to GET this host + /api/talks/:id (server graph). */
    private apiBase?: string,
    private opts?: { meshLocalFirst?: boolean; gunTalkRepository?: boolean },
  ) {
    this.talkRepository = new GunTalkRepository(gunService);
  }

  private repositoryEnabled(): boolean {
    return this.opts?.gunTalkRepository !== false;
  }

  private ownerSeaPub(): string {
    return String(this.gunService.getStoredPair?.()?.pub || '').trim();
  }

  /**
   * Compute a stable CIDv1 content hash for each question in the talk, per spec
   * §20.3 (REQ-LEDGER-14): `questionId = CIDv1({ text, type, options })` — derived
   * from what the question *asks*, not from which talk it belongs to or where in
   * that talk it sits. Only stable content (question text + answer *texts*, sorted)
   * is hashed; routing fields (next, isMatch, isIgnore, isTerminal, branchingLogic)
   * AND answer `.id`s are excluded — the latter matters because `answer.id` is
   * itself position-derived (`a_${questionIndex}_${answerIndex}`) elsewhere in this
   * codebase, so including it would silently reintroduce a positional dependency
   * into what's supposed to be a content-only hash. Two questions with identical
   * text and identical answer options always get the same `cidId`, regardless of
   * which talk asks them or in what position — that's what lets the Me tab (and
   * the per-question chatbot cache) treat them as "the same question."
   *
   * Updates each question in-place and returns the array.
   */
  private async stampQuestionCids(questions: Question[]): Promise<Question[]> {
    return Promise.all(
      questions.map(async (q) => {
        const stable = {
          text: normalizeIdentityText(q.text),
          answers: (q.answers || []).map((a) => normalizeIdentityText(a.text)).sort(),
        };
        const cidId = await computeCIDv1(stable);
        return { ...q, cidId };
      }),
    );
  }

  /** Gun sometimes exposes arrays as wrapped objects after graph merge. */
  private normalizeAnswersArray(answers: any): any[] {
    if (Array.isArray(answers)) return answers;
    if (answers && typeof answers === 'object' && (answers._isArray || answers.isArray)) {
      const alen = Number(answers._length ?? answers.length) || 0;
      const ans: any[] = [];
      for (let j = 0; j < alen; j++) {
        if (Object.prototype.hasOwnProperty.call(answers, String(j))) ans.push(answers[String(j)]);
      }
      return ans;
    }
    if (answers && typeof answers === 'object') {
      const keys = Object.keys(answers).filter((k) => /^\d+$/.test(k));
      if (keys.length > 0) {
        return keys
          .map((k) => Number(k))
          .sort((a, b) => a - b)
          .map((i) => answers[String(i)]);
      }
    }
    return [];
  }

  private normalizeQuestion(qu: any): any {
    if (!qu || typeof qu !== 'object') return qu;
    return { ...qu, answers: this.normalizeAnswersArray(qu.answers) };
  }

  private normalizeIpfsAttachments(attachments: unknown): IpfsAttachment[] {
    if (!Array.isArray(attachments)) return [];
    const normalized: IpfsAttachment[] = [];
    for (const attachment of attachments) {
      if (!attachment || typeof attachment !== 'object') continue;
      const cid = String((attachment as { cid?: unknown }).cid || '').trim();
      const name = String((attachment as { name?: unknown }).name || '').trim();
      const mimeType = String((attachment as { mimeType?: unknown }).mimeType || '').trim();
      const sizeBytes = Number((attachment as { sizeBytes?: unknown }).sizeBytes);
      const enc = (attachment as { enc?: unknown }).enc;
      if (!cid || !name || !mimeType || !Number.isFinite(sizeBytes)) continue;
      if (enc !== 'sea-pair' && enc !== 'none') continue;
      normalized.push({ cid, name, mimeType, sizeBytes, enc });
    }
    return normalized;
  }

  private normalizeTalkFromStorage(talk: any): Talk {
    if (!talk || typeof talk !== 'object') return talk as Talk;
    const q = talk.questions;
    const attachments = this.normalizeIpfsAttachments(talk.ipfsAttachments);
    if (Array.isArray(q)) {
      return { ...talk, questions: q.map((qu) => this.normalizeQuestion(qu)), ipfsAttachments: attachments } as Talk;
    }
    if (q && typeof q === 'object' && (q._isArray || q.isArray)) {
      const len = Number(q._length ?? q.length) || 0;
      const arr: any[] = [];
      for (let i = 0; i < len; i++) {
        if (!Object.prototype.hasOwnProperty.call(q, String(i))) continue;
        arr.push(this.normalizeQuestion(q[String(i)]));
      }
      return { ...talk, questions: arr, ipfsAttachments: attachments } as Talk;
    }
    return { ...talk, ipfsAttachments: attachments } as Talk;
  }

  async createTalk(talkData: Partial<Talk>): Promise<Talk> {
    const talk: Talk = {
      id: '',
      title: talkData.title || '',
      authorId: talkData.authorId || '',
      type: talkData.type || 'flow',
      isAdult: talkData.isAdult || false,
      language: talkData.language || 'en',
      tags: talkData.tags || [],
      questions: talkData.questions || [],
      ipfsAttachments: this.normalizeIpfsAttachments(talkData.ipfsAttachments),
      createdAt: new Date(),
      isTemplate: talkData.isTemplate || false,
      usageCount: 0,
    };
    if (talkData.expiresAt != null) talk.expiresAt = talkData.expiresAt;
    if (talkData.locationRadiusMiles != null) talk.locationRadiusMiles = talkData.locationRadiusMiles;
    if (talkData.authorLocation != null) talk.authorLocation = talkData.authorLocation;
    // docs/TODO.md §V/§Y1 — a revise-mints-new-id draft (buildRevisedTalkDraft) carries the
    // original-author lineage and the predecessor link; without this they were silently
    // dropped since this constructor only copied known base fields.
    if (talkData.originalAuthorId != null) talk.originalAuthorId = talkData.originalAuthorId;
    if (talkData.originalCreatedAt != null) talk.originalCreatedAt = talkData.originalCreatedAt;
    if (talkData.originalAuthorLocation != null) talk.originalAuthorLocation = talkData.originalAuthorLocation;
    if (talkData.supersedesTalkId != null) talk.supersedesTalkId = talkData.supersedesTalkId;
    if (talkData.selfTag != null) talk.selfTag = talkData.selfTag;
    if (talkData.preferenceSet != null) talk.preferenceSet = talkData.preferenceSet;
    if (talkData.matchThreshold != null) talk.matchThreshold = talkData.matchThreshold;

    // Stamp each question with a CIDv1 content hash (excludes routing fields)
    talk.questions = await this.stampQuestionCids(talk.questions);

    talk.id = talkData.id || await computeTalkCIDv1(talk);

    // AFTER the content hash: attach the author's public encryption key so every delivery
    // path hands responders the key material to pair-encrypt their responses without a
    // network lookup. Resolving the author's epub at respond time failed under
    // simultaneous-boot load and permanently dropped responses ([Step9] Failed to encrypt);
    // attaching it post-hash keeps content-addressed talk identity/dedup unchanged.
    const authorPair = this.gunService.getStoredPair?.();
    if (authorPair?.epub && !talk.authorEpub) talk.authorEpub = authorPair.epub;

    // Project locally before waiting on a relay ACK so OUT rows and Broadcast are immediately
    // available; the awaited Gun repository write below is still the authoritative commit.
    projectAuthoredTalkToMyTalks(talk.id, talk);
    const ownerSeaPub = this.ownerSeaPub() || talk.authorId;
    if (this.repositoryEnabled()) await this.talkRepository.putAuthored(ownerSeaPub, talk);
    saveAuthoredTalk(talk.id, talk);
    console.log('Talk committed to local Gun repository:', talk.id);
    return talk;
  }

  /**
   * Persist a body received over the mesh in the receiver-owned content cache.
   * The key is the content-addressed talk id; this local block store is the
   * browser-side boundary that can later be backed by Helia/IPFS.
   */
  async cacheReceivedTalk(talkId: string, talkData: Talk | Record<string, unknown>): Promise<void> {
    if (!talkId) return;
    const talk = { ...talkData, id: talkId } as Talk;
    const ownerSeaPub = this.ownerSeaPub();
    const authorKey = String(talk.authorId || 'unknown-author');
    if (this.repositoryEnabled() && ownerSeaPub) {
      await this.talkRepository.putReceived(ownerSeaPub, authorKey, talk);
    }
    if (typeof localStorage === 'undefined') return;
    try {
      const store = loadReceivedTalks();
      store[talkId] = {
        talkJson: JSON.stringify(talk),
        receivedAt: new Date().toISOString(),
      };
      localStorage.setItem(RECEIVED_TALKS_KEY, JSON.stringify(store));
    } catch {
      // Non-fatal: the live mesh cache still serves the current session.
    }
  }

  async getTalk(talkId: string): Promise<Talk | null> {
    const ownerSeaPub = this.ownerSeaPub();
    if (this.repositoryEnabled() && ownerSeaPub) {
      const authored = await this.talkRepository.getAuthored(ownerSeaPub, talkId);
      if (authored) return this.normalizeTalkFromStorage(authored);
      const receivedFromGun = await this.talkRepository.getReceivedById(ownerSeaPub, talkId);
      if (receivedFromGun) return this.normalizeTalkFromStorage(receivedFromGun);
      // Received records are author-partitioned; compatibility storage supplies
      // the author key during migration, then the record is promoted idempotently.
      const compatReceived = loadReceivedTalk(talkId);
      if (compatReceived) {
        await this.talkRepository.putReceived(ownerSeaPub, String(compatReceived.authorId || 'unknown-author'), compatReceived);
        return this.normalizeTalkFromStorage(compatReceived);
      }
    }
    // Compatibility reads remain available for rollback and migrate on read.
    const local = loadAuthoredTalk(talkId);
    if (local) {
      if (this.repositoryEnabled() && ownerSeaPub) await this.talkRepository.putAuthored(ownerSeaPub, local);
      return this.normalizeTalkFromStorage(local);
    }
    const received = loadReceivedTalk(talkId);
    if (received) return this.normalizeTalkFromStorage(received);
    try {
      const raw = await this.gunService.get(`talks/${talkId}`);
      if (!raw || !raw.data) return null;
      const parsed = typeof raw.data === 'string' ? JSON.parse(raw.data) : raw.data;
      return this.normalizeTalkFromStorage(parsed);
    } catch {
      return null;
    }
  }

  async listReceivedTalksFromGun(): Promise<Talk[]> {
    const ownerSeaPub = this.ownerSeaPub();
    if (!this.repositoryEnabled() || !ownerSeaPub) return [];
    return this.talkRepository.listReceived(ownerSeaPub);
  }

  /** Server is authoritative for complete talk data; Gun is used as a low-latency cache. */
  async getTalkWithRetry(
    talkId: string,
    opts?: { attempts?: number; gapMs?: number },
  ): Promise<Talk | null> {
    const attempts = opts?.attempts ?? 20;
    const gapMs = opts?.gapMs ?? 250;
    const looksComplete = (t: Talk | null): boolean => {
      if (!t) return false;
      // Tag talks have no questions; treat them as complete if they have a title and authorId
      if ((t as any).type === 'tag') return !!(t.title && t.authorId);
      if (!Array.isArray(t.questions) || t.questions.length === 0) return false;
      const q0 = t.questions[0];
      return !!(q0 && Array.isArray(q0.answers) && q0.answers.length > 0);
    };

    const tryServer = async (): Promise<Talk | null> => {
      const base = this.apiBase?.replace(/\/$/, '');
      if (!base) return null;
      try {
        const res = await fetch(`${base}/api/talks/${encodeURIComponent(talkId)}`);
        // 202 means the server is still replicating — not a permanent failure
        if (res.status === 202) return null;
        if (!res.ok) return null;
        const raw = await res.json();
        if (raw && typeof raw === 'object' && (raw as { pending?: boolean }).pending === true) {
          return null;
        }
        const normalized = this.normalizeTalkFromStorage(raw);
        return looksComplete(normalized) ? (normalized as Talk) : null;
      } catch {
        return null;
      }
    };

    // 1. Quick Gun cache check — no wait.
    const cached = await this.getTalk(talkId);
    if (looksComplete(cached)) return cached as Talk;

    if (!this.opts?.meshLocalFirst) {
      // 2. Server is authoritative; try it before entering the retry loop.
      const fromServer = await tryServer();
      if (fromServer) return fromServer;
    }

    // 3. Retry Gun (P0: mesh/local only — no server fallback).
    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, gapMs));
      const t = await this.getTalk(talkId);
      if (looksComplete(t)) return t as Talk;
      if (!this.opts?.meshLocalFirst) {
        const s = await tryServer();
        if (s) return s;
      }
    }

    return null;
  }

  /**
   * TODO §V follow-up, resolved: in-place edit of a talk I already own — `authorId`/
   * `createdAt`/`authorLocation` are ALWAYS preserved from `existing`, regardless of whether
   * `talkData` only touches metadata (tags/expiry/locationRadiusMiles) or also touches
   * content fields (questions/type/language). This is deliberate, not an oversight: the only
   * mechanism in this codebase that ever reassigns authorship is minting a NEW talk id
   * (`buildRevisedTalkDraft`, used when editing a copied-but-not-yet-owned talk) — this
   * function never changes `talkId`, so there is no id-transfer event to hang a reassignment
   * on. Consistent with the separately-settled "title edits don't count as authorship"
   * precedent, generalized: no in-place edit of an already-owned talk reassigns authorship,
   * whatever fields it touches.
   */
  async updateTalk(talkId: string, talkData: Partial<Talk>): Promise<Talk> {
    const existing = await this.getTalk(talkId);
    if (!existing) {
      throw new Error(`Talk not found: ${talkId}`);
    }
    const updated: Talk = {
      ...existing,
      ...talkData,
      id: talkId,
      title: talkData.title ?? existing.title,
      authorId: existing.authorId,
      type: talkData.type ?? existing.type,
      isAdult: talkData.isAdult ?? existing.isAdult,
      language: talkData.language ?? existing.language,
      tags: talkData.tags ?? existing.tags,
      questions: talkData.questions ?? existing.questions,
      createdAt: existing.createdAt,
      isTemplate: talkData.isTemplate ?? existing.isTemplate,
      usageCount: existing.usageCount,
    };
    const nextAttachments = talkData.ipfsAttachments !== undefined
      ? this.normalizeIpfsAttachments(talkData.ipfsAttachments)
      : existing.ipfsAttachments;
    if (nextAttachments !== undefined) {
      updated.ipfsAttachments = nextAttachments;
    }
    if (talkData.expiresAt !== undefined) updated.expiresAt = talkData.expiresAt;
    else if (existing.expiresAt != null) updated.expiresAt = existing.expiresAt;
    if (talkData.locationRadiusMiles !== undefined) updated.locationRadiusMiles = talkData.locationRadiusMiles;
    else if (existing.locationRadiusMiles != null) updated.locationRadiusMiles = existing.locationRadiusMiles;
    if (talkData.authorLocation !== undefined) updated.authorLocation = talkData.authorLocation;
    else if (existing.authorLocation != null) updated.authorLocation = existing.authorLocation;
    // Re-stamp CIDs on edit so routing-only changes don't affect cidId
    updated.questions = await this.stampQuestionCids(updated.questions);
    const ownerSeaPub = this.ownerSeaPub() || updated.authorId;
    if (this.repositoryEnabled()) await this.talkRepository.putAuthored(ownerSeaPub, updated);
    saveAuthoredTalk(talkId, updated);
    return updated;
  }

  async processAnswer(
    conversationId: string,
    questionId: string,
    answerId: string,
    userId: string,
  ): Promise<any> {
    // Simplified implementation
    const result = {
      conversationId: conversationId,
      questionId: questionId,
      answerId: answerId,
      userId: userId,
      isComplete: false,
      outcome: 'continue',
    };

    await this.gunService.put(`conversations/${conversationId}/answers/${questionId}`, {
      answerId: answerId,
      userId: userId,
      timestamp: new Date(),
    });

    return result;
  }

  async sendMessage(conversationId: string, senderId: string, message: string): Promise<void> {
    await this.gunService.put(`conversations/${conversationId}/messages/${Date.now()}`, {
      senderId: senderId,
      message: message,
      timestamp: new Date(),
      isFromChatbot: false,
    });
  }

  /**
   * STAT-01 — generic stats inquiry across all four talk types.
   * Forwards to the server aggregation endpoint that matches {@link dimension}.
   */
  async queryStats(
    talkId: string,
    dimension: 'summary' | 'by-day' | 'by-region' | 'by-answer',
    params?: { questionId?: string; from?: number; to?: number; bucket?: 'day' | 'week' | 'month' },
  ): Promise<any> {
    const base = this.apiBase?.replace(/\/$/, '');
    if (!base) throw new Error('queryStats requires apiBase');
    const q = new URLSearchParams();
    if (params?.questionId) q.set('questionId', params.questionId);
    if (params?.from != null) q.set('from', String(params.from));
    if (params?.to != null) q.set('to', String(params.to));
    if (params?.bucket) q.set('bucket', params.bucket);
    const qs = q.toString();
    const url = `${base}/api/stats/talks/${encodeURIComponent(talkId)}/${dimension}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`queryStats ${dimension} failed: ${res.status}`);
    return res.json();
  }

  checkForLinearCapture(message: string): any | null {
    const parsed = FlowCapture.parseChatLine(message);
    if (parsed) {
      return { question: parsed.question, answers: parsed.answers };
    }
    return null;
  }
}
