import { TalkValidator } from '../../shared/talk-engine';
import {
  getStarterPracticeContacts,
  isStarterContactEligible,
  removeStarterPracticeContact,
  starterIncomingTalkClusters,
} from '../../web/ui/starter-talk-seeds';

describe('starter practice contacts', () => {
  beforeEach(() => localStorage.clear());

  it('enrolls a new user with one removable contact per Talk type', () => {
    const contacts = getStarterPracticeContacts('new-user', 'en', true);

    expect(contacts.map((contact) => contact.talkType)).toEqual(['tag', 'flow', 'survey', 'route']);
    expect(contacts.find((contact) => contact.talkType === 'tag')?.talks).toHaveLength(4);
    expect(contacts.flatMap((contact) => contact.talks)).toHaveLength(7);
    contacts.flatMap((contact) => contact.talks)
      .forEach((talk) => expect(() => TalkValidator.validateTalk(talk)).not.toThrow());
  });

  it('does not enroll an existing user unless this device already enrolled them', () => {
    expect(isStarterContactEligible({}, {}, [])).toBe(true);
    expect(isStarterContactEligible({ existing: {} as any }, {}, [])).toBe(false);
    expect(getStarterPracticeContacts('existing-user', 'en', false)).toEqual([]);

    expect(getStarterPracticeContacts('new-user', 'en', true)).toHaveLength(4);
    expect(getStarterPracticeContacts('new-user', 'en', false)).toHaveLength(4);
  });

  it('removes a contact and all of the Talks it sent', () => {
    const initial = getStarterPracticeContacts('new-user', 'en', true);
    removeStarterPracticeContact('new-user', 'tag-guide');
    const remaining = getStarterPracticeContacts('new-user', 'en', false);
    const clusters = starterIncomingTalkClusters(remaining);

    expect(initial).toHaveLength(4);
    expect(remaining.map((contact) => contact.id)).not.toContain('tag-guide');
    expect(clusters.every((cluster) => cluster.type !== 'tag')).toBe(true);
    expect(clusters.every((cluster) => cluster.latestTalk?.starterContactId)).toBe(true);
  });

  it('localizes contact names and Talk content', () => {
    const contacts = getStarterPracticeContacts('new-user', 'zh', true);
    expect(contacts[0].name).toBe('标签向导');
    expect(contacts[0].talks[0].title).toBe('周末徒步');
  });
});
