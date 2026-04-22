import { computeTalkIdFromTalkData } from '../../shared/talk-content-id';

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
  return localStorage.getItem('chatbotEnabled') === 'true';
}

export function setChatbotEnabled(enabled: boolean): void {
  localStorage.setItem('chatbotEnabled', String(enabled));
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
