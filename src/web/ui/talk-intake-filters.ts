import type { GPSCoordinate, TalkIntakeFilters } from '../../shared/types';
import { ContentFilter } from '../../shared/reputation';

const TALK_FILTERS_KEY = 'iinpublic_talk_intake_filters';

export type IncomingTalkCluster = {
  title?: string;
  type?: string;
  language?: string;
  updatedAt?: string;
  authorLocation?: { latitude: number; longitude: number };
  questionsJson?: string;
};

export function getDefaultTalkIntakeFilters(): TalkIntakeFilters {
  return {
    allowedLanguages: ['en'],
    requireGoodGrammar: false,
    blockDirtyWords: false,
    allowedTalkTypes: ['flow', 'survey', 'tag', 'route'],
  };
}

export function getTalkIntakeFilters(): TalkIntakeFilters {
  try {
    const raw = localStorage.getItem(TALK_FILTERS_KEY);
    if (!raw) return getDefaultTalkIntakeFilters();
    const parsed = JSON.parse(raw) as Partial<TalkIntakeFilters>;
    return {
      ...getDefaultTalkIntakeFilters(),
      ...parsed,
      allowedLanguages: Array.isArray(parsed.allowedLanguages) && parsed.allowedLanguages.length > 0
        ? parsed.allowedLanguages
        : ['en'],
      allowedTalkTypes: Array.isArray(parsed.allowedTalkTypes) && parsed.allowedTalkTypes.length > 0
        ? parsed.allowedTalkTypes
        : ['flow', 'survey', 'tag', 'route'],
    };
  } catch {
    return getDefaultTalkIntakeFilters();
  }
}

export function setTalkIntakeFilters(filters: TalkIntakeFilters): void {
  localStorage.setItem(TALK_FILTERS_KEY, JSON.stringify(filters));
}

function parseQuestionsText(questionsJson?: string): string[] {
  if (!questionsJson) return [];
  try {
    const parsed = JSON.parse(questionsJson) as Array<{ text?: string; answers?: Array<{ text?: string }> }>;
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

function buildClusterText(cluster: IncomingTalkCluster): string {
  return [cluster.title || '', ...parseQuestionsText(cluster.questionsJson)].filter(Boolean).join('. ');
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
  cluster: IncomingTalkCluster,
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
): boolean {
  const type = String(cluster.type || 'flow').toLowerCase() as 'flow' | 'survey' | 'tag' | 'route';
  if (Array.isArray(filters.allowedTalkTypes) && filters.allowedTalkTypes.length > 0) {
    if (!filters.allowedTalkTypes.includes(type)) return false;
  }

  if (filters.sentAfter) {
    const sentAt = new Date(cluster.updatedAt || 0).getTime();
    const minTime = new Date(filters.sentAfter).getTime();
    if (!Number.isNaN(sentAt) && !Number.isNaN(minTime) && sentAt < minTime) return false;
  }

  if (
    currentLocation &&
    cluster.authorLocation &&
    (typeof filters.minDistanceMiles === 'number' || typeof filters.maxDistanceMiles === 'number')
  ) {
    const distance = haversineMiles(currentLocation, cluster.authorLocation);
    if (typeof filters.minDistanceMiles === 'number' && distance < filters.minDistanceMiles) return false;
    if (typeof filters.maxDistanceMiles === 'number' && distance > filters.maxDistanceMiles) return false;
  }

  const clusterText = buildClusterText(cluster);
  if (filters.allowedLanguages.length > 0) {
    const knownLanguage = String(cluster.language || '').trim().toLowerCase();
    if (knownLanguage) {
      if (!filters.allowedLanguages.map((lang) => lang.toLowerCase()).includes(knownLanguage)) return false;
    } else if (
      !ContentFilter.applyFilters(
        clusterText,
        {
          language: true,
          grammar: false,
          dirtyWords: false,
          location: { enabled: false, maxDistance: 0 },
          age: { enabled: false, minAge: 0, maxAge: 0 },
        },
        filters.allowedLanguages,
      ).passed
    ) {
      return false;
    }
  }

  if (filters.requireGoodGrammar) {
    const result = ContentFilter.applyFilters(
      clusterText,
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
      clusterText,
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
  clusters: IncomingTalkCluster[],
  filters: TalkIntakeFilters,
  currentLocation?: GPSCoordinate,
): { visible: IncomingTalkCluster[]; hiddenCount: number } {
  const visible = clusters.filter((cluster) => talkPassesIntakeFilters(cluster, filters, currentLocation));
  return {
    visible,
    hiddenCount: Math.max(0, clusters.length - visible.length),
  };
}
