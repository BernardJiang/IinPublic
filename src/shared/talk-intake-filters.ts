import type { GPSCoordinate, TalkIntakeFilters } from './types';
import { ContentFilter } from './reputation';

export type IncomingTalkFilterSubject = {
  title?: string;
  type?: string;
  language?: string;
  updatedAt?: string;
  createdAt?: string;
  authorLocation?: { latitude: number; longitude: number };
  questionsJson?: string;
  questions?: Array<{ text?: string; answers?: Array<{ text?: string }> }>;
  isAdult?: boolean;
};

export function getDefaultTalkIntakeFilters(seedLanguages?: string[]): TalkIntakeFilters {
  return {
    allowedLanguages: Array.isArray(seedLanguages) && seedLanguages.length > 0 ? seedLanguages : ['en'],
    requireGoodGrammar: false,
    blockDirtyWords: false,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
  };
}

function parseQuestionsText(subject: IncomingTalkFilterSubject): string[] {
  if (Array.isArray(subject.questions)) {
    return subject.questions.flatMap((question) => {
      const parts = [String(question?.text || '').trim()];
      for (const answer of Array.isArray(question?.answers) ? question.answers : []) {
        const text = String(answer?.text || '').trim();
        if (text) parts.push(text);
      }
      return parts.filter(Boolean);
    });
  }

  if (!subject.questionsJson) return [];
  try {
    const parsed = JSON.parse(subject.questionsJson) as Array<{ text?: string; answers?: Array<{ text?: string }> }>;
    return parsed.flatMap((question) => {
      const parts = [String(question?.text || '').trim()];
      for (const answer of Array.isArray(question?.answers) ? question.answers : []) {
        const text = String(answer?.text || '').trim();
        if (text) parts.push(text);
      }
      return parts.filter(Boolean);
    });
  } catch {
    return [];
  }
}

function buildSubjectText(subject: IncomingTalkFilterSubject): string {
  return [subject.title || '', ...parseQuestionsText(subject)].filter(Boolean).join('. ');
}

function haversineMiles(a: GPSCoordinate, b: { latitude: number; longitude: number }): number {
  const R = 3958.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function talkPassesIntakeFilters(
  subject: IncomingTalkFilterSubject,
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
): boolean {
  const type = String(subject.type || 'flow').toLowerCase() as 'flow' | 'survey' | 'tag' | 'route';
  if (Array.isArray(filters.allowedTalkTypes) && filters.allowedTalkTypes.length > 0) {
    if (!filters.allowedTalkTypes.includes(type)) return false;
  }

  if (filters.sentAfter) {
    const sentAt = new Date(subject.updatedAt || subject.createdAt || 0).getTime();
    const minTime = new Date(filters.sentAfter).getTime();
    if (!Number.isNaN(sentAt) && !Number.isNaN(minTime) && sentAt < minTime) return false;
  }

  if (
    currentLocation &&
    subject.authorLocation &&
    (typeof filters.minDistanceMiles === 'number' || typeof filters.maxDistanceMiles === 'number')
  ) {
    const distance = haversineMiles(currentLocation, subject.authorLocation);
    if (typeof filters.minDistanceMiles === 'number' && distance < filters.minDistanceMiles) return false;
    if (typeof filters.maxDistanceMiles === 'number' && distance > filters.maxDistanceMiles) return false;
  }

  const subjectText = buildSubjectText(subject);
  if (filters.allowedLanguages.length > 0) {
    const knownLanguage = String(subject.language || '').trim().toLowerCase();
    const normalizedAllowedLanguages = filters.allowedLanguages.map((lang) => lang.toLowerCase());
    if (knownLanguage) {
      if (!normalizedAllowedLanguages.includes(knownLanguage)) return false;
    } else if (
      !ContentFilter.applyFilters(
        subjectText,
        {
          language: true,
          grammar: false,
          dirtyWords: false,
          location: { enabled: false, maxDistance: 0 },
          age: { enabled: false, minAge: 0, maxAge: 0 },
        },
        normalizedAllowedLanguages,
      ).passed
    ) {
      return false;
    }
  }

  if (filters.requireGoodGrammar) {
    const result = ContentFilter.applyFilters(
      subjectText,
      {
        language: false,
        grammar: true,
        dirtyWords: false,
        location: { enabled: false, maxDistance: 0 },
        age: { enabled: false, minAge: 0, maxAge: 0 },
      },
      filters.allowedLanguages,
    );
    if (!result.passed) return false;
  }

  if (filters.blockDirtyWords) {
    const result = ContentFilter.applyFilters(
      subjectText,
      {
        language: false,
        grammar: false,
        dirtyWords: true,
        location: { enabled: false, maxDistance: 0 },
        age: { enabled: false, minAge: 0, maxAge: 0 },
      },
      filters.allowedLanguages,
    );
    if (!result.passed) return false;
  }

  return true;
}

export function filterIncomingTalkClusters(
  subjects: IncomingTalkFilterSubject[],
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
): { visible: IncomingTalkFilterSubject[]; hiddenCount: number } {
  const visible = subjects.filter((subject) => talkPassesIntakeFilters(subject, filters, currentLocation));
  return {
    visible,
    hiddenCount: Math.max(0, subjects.length - visible.length),
  };
}
