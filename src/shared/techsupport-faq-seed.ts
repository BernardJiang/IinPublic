import { buildSupportFaqEntry, type SupportFaqEntry } from './techsupport-faq';

/**
 * Starter TechSupport Q&A (docs/TODO.md K5, extending the K2 compiled-content pattern to the
 * FAQ bundle). `techsupport-faq.ts`'s bundle otherwise starts *empty* and only grows once a real
 * user asks TechSupport a question and a human answers it — a genuinely new user has nothing to
 * fall back on until that happens once, and there is nowhere in the app to just browse what
 * TechSupport already knows without asking.
 *
 * This module authors a small curated set of the most common questions, in TechSupport's own
 * voice, covering the same ground as the first-run walkthrough (`onboarding-walkthrough.ts`) —
 * deliberately the SAME source of truth two different UI surfaces read from, rather than
 * duplicating the explanations three times over:
 *
 *   - `scripts/sign-techsupport-faq-seed.js` signs this content once with the TechSupport DM key
 *     and commits the result as `techsupport-faq-seed.signed.json` — a real, independently
 *     verifiable `SignedFaqBundle` a client can trust WITHOUT the TechSupport device ever having
 *     come online (same "compiled once, verified before use" trick the K2 greeting uses, applied
 *     to the FAQ bundle shape instead of a single template string). `handleSupportQuestion` in
 *     app.ts checks the live, organically-grown bundle first and falls back to this seed only on
 *     a miss, so a real (possibly edited) human answer for the same question always wins.
 *   - Settings → Help renders this exact same content as a browsable, always-available FAQ list
 *     (`techsupport-faq-help-view.ts`) — no DM, no exact-string luck required, works offline.
 *
 * **Exact normalized match only**, same caveat as `techsupport-faq.ts`: this is not a search
 * index. The phrasing below is chosen to be the single most natural way to ask each question;
 * Settings → Help sidesteps the phrasing problem entirely by letting the user browse instead of
 * type.
 */

export interface SupportFaqSeedItem {
  question: string;
  answer: string;
}

export const TECHSUPPORT_FAQ_SEED_TEMPLATES = {
  en: [
    {
      question: 'What is IinPublic?',
      answer:
        'IinPublic lets you talk to hundreds of people about hundreds of topics at once. You ask a question (a Talk), other people answer it, and the app surfaces the people whose answers are compatible with yours.',
    },
    {
      question: 'How do I find people nearby?',
      answer:
        'Open Chatrooms and join a room by location or topic. Chatrooms help you discover who is around — the actual conversation still happens one-to-one, in Contacts.',
    },
    {
      question: 'What is a Talk?',
      answer:
        "A Talk is a question you write in plain language, with the possible answers you're willing to accept. No programming needed. Create one once in the Talks tab, then reuse or share it.",
    },
    {
      question: 'How do matches work?',
      answer:
        "When you and someone else both answer the same Talk in a compatible way, that's a match. Matches show up in Contacts, where you can start a real conversation.",
    },
    {
      question: 'Where do my past answers go?',
      answer:
        'Every question you have answered lives in the Me tab. You can review or change any of your past answers there at any time.',
    },
    {
      question: 'Is my data private?',
      answer:
        'Your identity and private data (blocks, contacts, filters) are encrypted under your own device keys — the server cannot read them. You decide how much of your reputation and answers to show.',
    },
    {
      question: 'How do I block someone?',
      answer:
        "Open that person's detail view (from Contacts or a chatroom member list) and use Block. Once blocked, they can no longer reach you, and you keep the same control over who reaches you as everyone else.",
    },
    {
      question: 'How do I replay the app tour?',
      answer: 'Go to Settings → Help & Tour and tap "Replay Tour" to see the introduction again.',
    },
    {
      question: 'How do I change the app language?',
      answer: 'Go to Settings → Appearance to change the display language and color scheme.',
    },
    {
      question: 'Why do I need to verify my age?',
      answer:
        "Some rooms and Talks are age-gated. Verifying raises your account's trust level so those aren't filtered out for you; it does not share your exact age or birthdate with anyone.",
    },
    {
      question: 'What is TechSupport?',
      answer:
        "TechSupport is IinPublic's built-in help account — every chatroom includes it. Ask a question here: if it's one we've answered before you'll get an instant reply, otherwise it's queued for a person to answer.",
    },
  ],
  zh: [
    {
      question: '什么是 IinPublic？',
      answer:
        'IinPublic 让你同时和成百上千的人聊成百上千个话题。你提出一个问题（话题），其他人回答它，应用会把回答和你相合的人展现给你。',
    },
    {
      question: '怎么找到附近的人？',
      answer: '打开"聊天室"，按地点或话题加入一个房间。聊天室帮你发现附近有谁——真正的对话仍然发生在"联系人"里，一对一进行。',
    },
    {
      question: '什么是话题？',
      answer: '话题是你用日常语言写的一个问题，附带你愿意接受的可能答案，不需要编程。在"话题"标签页创建一次，之后可以复用或分享。',
    },
    {
      question: '匹配是怎么形成的？',
      answer: '当你和另一个人对同一个话题给出相合的回答时，就形成了匹配。匹配会出现在"联系人"里，你可以在那里开始真正的对话。',
    },
    {
      question: '我以前的回答保存在哪里？',
      answer: '你回答过的每一个问题都保存在"我"标签页，你可以随时查看或修改。',
    },
    {
      question: '我的数据是私密的吗？',
      answer: '你的身份和私密数据（屏蔽名单、联系人、过滤器）都在你自己的设备密钥下加密——服务器无法读取。你自己决定展示多少声誉和回答。',
    },
    {
      question: '怎么屏蔽某人？',
      answer: '打开对方的详情页（从"联系人"或聊天室成员列表进入），使用"屏蔽"。屏蔽后对方无法再联系你，你和其他人一样拥有同等的控制权。',
    },
    {
      question: '怎么重新播放导览？',
      answer: '进入"设置 → 帮助与导览"，点击"重新播放导览"即可再次查看介绍。',
    },
    {
      question: '怎么修改应用语言？',
      answer: '进入"设置 → 外观"可以修改显示语言和配色方案。',
    },
    {
      question: '为什么需要年龄验证？',
      answer: '部分房间和话题设有年龄限制。完成验证会提升你账号的信任等级，这些内容就不会被过滤掉；验证过程不会把你的具体年龄或出生日期分享给任何人。',
    },
    {
      question: '什么是 TechSupport？',
      answer: 'TechSupport 是 IinPublic 内置的帮助账号，每个聊天室都包含它。在这里提问：如果是我们回答过的问题会立即得到答复，否则会排队等待人工回复。',
    },
  ],
} as const;

export type FaqSeedLocale = keyof typeof TECHSUPPORT_FAQ_SEED_TEMPLATES;

export function isFaqSeedLocale(value: unknown): value is FaqSeedLocale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TECHSUPPORT_FAQ_SEED_TEMPLATES, value);
}

/** Every locale's seed items flattened into one list — the shape `signFaqBundle` wants. Both
 * locales' questions live in the SAME bundle (the bundle itself carries no locale field; each
 * entry is looked up by its own normalized question text, so an English asker and a Chinese
 * asker simply hit different entries in the same list). */
export function buildSeedFaqEntries(answeredAt: string): SupportFaqEntry[] {
  const entries: SupportFaqEntry[] = [];
  for (const items of Object.values(TECHSUPPORT_FAQ_SEED_TEMPLATES)) {
    for (const item of items as readonly SupportFaqSeedItem[]) {
      const entry = buildSupportFaqEntry({ question: item.question, answer: item.answer, answeredAt });
      if (entry) entries.push(entry);
    }
  }
  return entries;
}
