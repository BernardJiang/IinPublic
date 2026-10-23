import type { Reputation } from './types';

/** Starter thresholds approved for the first reputation-gated custom-room release. */
export const ROOM_CREATE_MIN_FRIEND_MARKS = 12;
export const ROOM_CREATE_MAX_BLOCKS_EXCLUSIVE = 3;

export type RoomCreationCredit = {
  friendMarks: number;
  blockCount: number;
  requiredFriendMarks: number;
  maximumAllowedBlocks: number;
  enoughFriendMarks: boolean;
  blockCountAllowed: boolean;
  eligible: boolean;
};

/**
 * Custom-room credit is deliberately narrow: it is made only from statistics supplied by other
 * identities. Contacts created automatically after a Talk exchange do not count. A person must
 * explicitly mark the account as a Friend, and fewer than three distinct people may block it.
 */
export function roomCreationCredit(
  reputation: Pick<Reputation, 'friendsCount' | 'blockCount'> | null | undefined,
  friendMarks = Number(reputation?.friendsCount || 0),
  thresholds: { minFriendMarks?: number; maxBlocksExclusive?: number } = {},
): RoomCreationCredit {
  const requiredFriendMarks = Math.max(0, Math.floor(
    Number(thresholds.minFriendMarks ?? ROOM_CREATE_MIN_FRIEND_MARKS) || 0,
  ));
  const maxBlocksExclusive = Math.max(0, Math.floor(
    Number(thresholds.maxBlocksExclusive ?? ROOM_CREATE_MAX_BLOCKS_EXCLUSIVE) || 0,
  ));
  const normalizedFriendMarks = Math.max(0, Math.floor(Number(friendMarks) || 0));
  const blockCount = Math.max(0, Math.floor(Number(reputation?.blockCount) || 0));
  const enoughFriendMarks = normalizedFriendMarks >= requiredFriendMarks;
  const blockCountAllowed = blockCount < maxBlocksExclusive;
  return {
    friendMarks: normalizedFriendMarks,
    blockCount,
    requiredFriendMarks,
    maximumAllowedBlocks: Math.max(0, maxBlocksExclusive - 1),
    enoughFriendMarks,
    blockCountAllowed,
    eligible: enoughFriendMarks && blockCountAllowed,
  };
}
