import { computeTalkIdFromTalkData } from '../../shared/cid';
import type { UiLanguage } from './ui-translations';

export type ChatbotTemplate = {
  answers: any[];
  talkData: any;
};

export function getCopyTalkAutoSave(): boolean {
  const value = localStorage.getItem('copyTalkAutoSave');
  return value === null || value === 'true';
}

export function setCopyTalkAutoSave(enabled: boolean): void {
  localStorage.setItem('copyTalkAutoSave', String(enabled));
}

export function getChatbotEnabled(): boolean {
  const value = localStorage.getItem('chatbotEnabled');
  return value === null || value === 'true';
}

export function setChatbotEnabled(enabled: boolean): void {
  localStorage.setItem('chatbotEnabled', String(enabled));
}

export function getUiLanguagePreference(defaultLanguage: UiLanguage = 'en'): UiLanguage {
  const stored = String(localStorage.getItem('iinpublic_ui_language') || '').toLowerCase();
  if (stored === 'en' || stored === 'zh') return stored;
  localStorage.setItem('iinpublic_ui_language', defaultLanguage);
  return defaultLanguage;
}

export function setUiLanguagePreference(language: UiLanguage): void {
  localStorage.setItem('iinpublic_ui_language', language);
}

export function getDefaultTalkLanguagePreference(defaultLanguage: UiLanguage = 'en'): UiLanguage {
  const stored = String(localStorage.getItem('iinpublic_default_talk_language') || '').toLowerCase();
  return stored === 'en' || stored === 'zh' ? stored : defaultLanguage;
}

export function setDefaultTalkLanguagePreference(language: UiLanguage): void {
  localStorage.setItem('iinpublic_default_talk_language', language);
}

/**
 * docs/TODO.md §V — when a content edit mints a new talk, the predecessor is deleted by
 * default; advanced users can flip this to keep it (disabled) instead. Default false
 * (delete) matches Bernard's 2026-08-01 decision.
 */
export function getKeepOldTalkOnEdit(): boolean {
  return localStorage.getItem('keepOldTalkOnEdit') === 'true';
}

export function setKeepOldTalkOnEdit(enabled: boolean): void {
  localStorage.setItem('keepOldTalkOnEdit', String(enabled));
}

export function getChatbotTemplate(talkId: string): ChatbotTemplate | null {
  try {
    const raw = localStorage.getItem('chatbotTemplates');
    if (!raw) return null;
    const templates = JSON.parse(raw) as Record<string, ChatbotTemplate>;
    return templates[talkId] || null;
  } catch {
    return null;
  }
}

export function saveChatbotTemplate(talkId: string, data: ChatbotTemplate): void {
  try {
    const raw = localStorage.getItem('chatbotTemplates');
    const templates: Record<string, ChatbotTemplate> = raw ? JSON.parse(raw) : {};
    templates[talkId] = data;
    const contentId = computeTalkIdFromTalkData(data.talkData);
    if (contentId && contentId !== talkId) {
      templates[contentId] = data;
    }
    localStorage.setItem('chatbotTemplates', JSON.stringify(templates));
  } catch (error) {
    console.warn('Failed to save chatbot template:', error);
  }
}
