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
        "A Talk is a single question, or a set of questions, with the predefined answers you care about — written in plain language, no programming needed. When you find yourself asking or answering the same question often enough, create a Talk so your chatbot can repeat the answer for you. Use the Talk editor to build one from scratch, or copy and edit an existing Talk.",
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
        "TechSupport is IinPublic's built-in help account — every chatroom includes it. Ask a question here: if it's one we've answered before you'll get an instant reply, otherwise it's queued for our support team to answer.",
    },
    {
      question: 'Can I send or receive money through IinPublic?',
      answer:
        'No. IinPublic never supports payments, money transfers, or any other financial transaction. Anything that looks like a payment card number, bank account number, or similar financial detail is automatically blocked before it can be sent — never use this app to exchange money.',
    },
    {
      question: 'How are large photos, videos, and files shared?',
      answer:
        'A talk or conversation can include larger attachments beyond text. These are sent over IPFS, a peer-to-peer file network, directly to the people you share them with — the same peer-to-peer design as the rest of IinPublic. We do not collect or store copies of these files.',
    },
    {
      question: 'Is IinPublic open source?',
      answer:
        'Yes. The full source code is public under the MIT license at github.com/BernardJiang/IinPublic, so anyone can verify how the app actually handles data.',
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
      answer: '话题是一个问题，或一组问题，附带你在意的预设答案——用日常语言写成，不需要编程。当你发现自己经常问、或经常回答同一个问题时，就可以创建一个话题，让你的聊天机器人替你重复作答。你可以用话题编辑器从头创建，也可以复制并编辑已有的话题。',
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
      answer: 'TechSupport 是 IinPublic 内置的帮助账号，每个聊天室都包含它。在这里提问：如果是我们回答过的问题会立即得到答复，否则会排队等待我们的支持团队人工回复。',
    },
    {
      question: '可以通过 IinPublic 转账或收款吗？',
      answer: '不可以。IinPublic 从不支持支付、转账或任何形式的资金往来。任何看起来像银行卡号、账户号码等金融信息的内容，在发送前都会被自动拦截——请不要用这个应用交换金钱。',
    },
    {
      question: '较大的照片、视频和文件是怎么分享的？',
      answer: '话题或对话中可以附带文字之外的较大附件。这些内容通过 IPFS（一种点对点文件网络）直接发送给你分享的对象——采用和 IinPublic 其他部分相同的点对点设计。我们不会收集或保存这些文件的副本。',
    },
    {
      question: 'IinPublic 是开源的吗？',
      answer: '是的。完整源代码以 MIT 许可证公开在 github.com/BernardJiang/IinPublic，任何人都可以验证应用实际是如何处理数据的。',
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
