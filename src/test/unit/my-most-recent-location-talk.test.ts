import { myMostRecentLocationTalk } from '../../web/ui/answer-preference-resolution';
import type { MyTalkMap } from '../../web/ui/my-talks-storage';

const userId = 'local';

function locationQuestion(text = 'Where?') {
  return { id: 'q_loc', text, builtIn: { kind: 'location' as const } };
}

function pairTagQuestion(myTag: string, acceptsTag: string) {
  return {
    id: 'q_0',
    text: myTag,
    reciprocalTagContext: true,
    answers: [{ id: 'a_0', text: acceptsTag }],
  };
}

describe('myMostRecentLocationTalk (§BB)', () => {
  it('returns undefined when no title is supplied', () => {
    expect(myMostRecentLocationTalk({}, userId, 'buy', undefined)).toBeUndefined();
  });

  it('returns undefined when no created talk shares the title', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Different Title',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [locationQuestion()],
          authorLocation: { latitude: 1, longitude: 1 },
          locationRadiusMiles: 10,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toBeUndefined();
  });

  it('ignores a matching-title talk that never declares a location builtIn question', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [{ id: 'q_0', text: 'Ordinary question', answers: [] }],
          authorLocation: { latitude: 1, longitude: 1 },
          locationRadiusMiles: 10,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toBeUndefined();
  });

  it('ignores a non-"created" entry (e.g. something I merely answered)', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'answered',
        fullTalk: {
          authorId: 'someone-else',
          questions: [locationQuestion()],
          authorLocation: { latitude: 1, longitude: 1 },
          locationRadiusMiles: 10,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toBeUndefined();
  });

  it('finds my own matching-title, matching-scope talk and returns its location+radius', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [locationQuestion()],
          authorLocation: { latitude: 37.77, longitude: -122.42 },
          locationRadiusMiles: 10,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toEqual({
      authorLocation: { latitude: 37.77, longitude: -122.42 },
      locationRadiusMiles: 10,
    });
  });

  it('does not match a talk of the same title but a DIFFERENT declared tag scope', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Notebook Deal',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [pairTagQuestion('sell', 'buy'), locationQuestion()],
          authorLocation: { latitude: 1, longitude: 1 },
          locationRadiusMiles: 10,
        },
      },
    };
    // Looking for my own 'buy'-scoped talk — this one is scoped 'sell'.
    expect(myMostRecentLocationTalk(myTalks, userId, 'buy', 'Notebook Deal')).toBeUndefined();
  });

  it('matches a talk of the same title AND the same declared tag scope', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Notebook Deal',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [pairTagQuestion('buy', 'sell'), locationQuestion()],
          authorLocation: { latitude: 2, longitude: 2 },
          locationRadiusMiles: 25,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, 'buy', 'Notebook Deal')).toEqual({
      authorLocation: { latitude: 2, longitude: 2 },
      locationRadiusMiles: 25,
    });
  });

  it('picks the MOST RECENT of several qualifying talks', () => {
    const myTalks: MyTalkMap = {
      older: {
        talkId: 'older',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-01T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [locationQuestion()],
          authorLocation: { latitude: 1, longitude: 1 },
          locationRadiusMiles: 5,
        },
      },
      newer: {
        talkId: 'newer',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: {
          authorId: userId,
          questions: [locationQuestion()],
          authorLocation: { latitude: 9, longitude: 9 },
          locationRadiusMiles: 50,
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toEqual({
      authorLocation: { latitude: 9, longitude: 9 },
      locationRadiusMiles: 50,
    });
  });

  it('falls back to the entry\'s own locationRadiusMiles when fullTalk lacks it', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        locationRadiusMiles: 15,
        fullTalk: {
          authorId: userId,
          questions: [locationQuestion()],
          authorLocation: { latitude: 3, longitude: 3 },
        },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toEqual({
      authorLocation: { latitude: 3, longitude: 3 },
      locationRadiusMiles: 15,
    });
  });

  it('ignores a qualifying talk missing authorLocation or radius entirely', () => {
    const myTalks: MyTalkMap = {
      t1: {
        talkId: 't1',
        title: 'Meetup',
        type: 'flow',
        timestamp: '2026-08-26T00:00:00.000Z',
        role: 'created',
        fullTalk: { authorId: userId, questions: [locationQuestion()] },
      },
    };
    expect(myMostRecentLocationTalk(myTalks, userId, undefined, 'Meetup')).toBeUndefined();
  });
});
