#!/usr/bin/env node
/**
 * One-time mover: tests/e2e/*.spec.ts → tests/e2e/staged/<stage>/
 * Run from repo root: node scripts/migrate-e2e-to-staged.mjs
 */
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = process.cwd();

const moves = [
  // stage0 — only new bootstrap files (no moves)
  // stage1 — single user
  ['tests/e2e/01-login-single-user-headcount.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/01-login-single-user-headcount.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/00-statistics-dashboard.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/00-statistics-dashboard.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/00-ui-navigation-settings.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/05-talks-edit.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/05-talks-edit.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/18-travel-mode-single-room.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/18-travel-mode-single-room.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/25-mobile-viewport-navigation.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/25-mobile-viewport-navigation.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/27-location-auto-assignment.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/27-location-auto-assignment.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/17-chatroom-custom-business-api.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/17-chatroom-custom-business-api.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/06-survey-customer-satisfaction.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/06-survey-customer-satisfaction.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/07-survey-restaurants.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/07-survey-restaurants.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/08-route-job-seeking.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/08-route-job-seeking.md', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/10-stats-four-types.spec.ts', 'tests/e2e/staged/stage1-single-user/'],
  ['tests/e2e/talks-matching/10-stats-four-types.md', 'tests/e2e/staged/stage1-single-user/'],
  // stage2 — two users
  ['tests/e2e/01-login-two-users-headcount.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/01-login-two-users-headcount.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/04-profile-edit-stage-name.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/04-profile-edit-stage-name.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/07-tags-checkbox.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/07-tags-checkbox.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/08-super-user-copy-talk.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/08-super-user-copy-talk.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/09-messaging.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/09-messaging.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/10-message-unread-badge.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/10-message-unread-badge.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-abort-clear-all.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-abort-clear-all.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-boundary-match.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-boundary-match.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-deletion-mid-broadcast.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00-broadcast-deletion-mid-broadcast.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00e-chatroom-peer-detail.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00e-chatroom-peer-detail.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00j-messaging-edge-cases.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00j-messaging-edge-cases.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00h-chatroom-hierarchy-broadcast.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/00h-chatroom-hierarchy-broadcast.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/15a-blocking-unblock-resumes-talk-delivery.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/15a-blocking-unblock-resumes-talk-delivery.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/15b-blocking-stops-delivery-and-peer-visibility.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/15b-blocking-stops-delivery-and-peer-visibility.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21a-reputation-block-count.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21a-reputation-block-count.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21b-reputation-peer-star-rating.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21b-reputation-peer-star-rating.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21c-reputation-vouch-threshold.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/21c-reputation-vouch-threshold.md', 'tests/e2e/staged/stage2-two-user/'],
  ['tests/e2e/28-stage-zero-n2n.spec.ts', 'tests/e2e/staged/stage2-two-user/'],
  // stage3 — three users
  ['tests/e2e/02-multi-user-headcount.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/02-multi-user-headcount.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00f-ux-contacts-talks-answers.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00f-ux-contacts-talks-answers.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00g-age-gating.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00g-age-gating.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00i-survey-analytics-dashboard.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00i-survey-analytics-dashboard.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/06-contacts-tab.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/06-contacts-tab.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/14-contacts-relationship-credit.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/14-contacts-relationship-credit.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/00l-chatroom-talks-ui-regressions.spec.ts', 'tests/e2e/staged/stage3-three-user/'],

  ['tests/e2e/13-chatroom-scroll-and-broadcast-bar.spec.ts', 'tests/e2e/staged/stage5-multi-user/'],
  ['tests/e2e/13-chatroom-scroll-and-broadcast-bar.md', 'tests/e2e/staged/stage5-multi-user/'],
  ['tests/e2e/talks-matching/01-tennis-jerry-match.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/01-tennis-jerry-match.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/02-two-talks-status-answers.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/02-two-talks-status-answers.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/03-chatbot-bot-badge.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/03-chatbot-bot-badge.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/04-ignore-then-change-answer.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/04-ignore-then-change-answer.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/05-partial-auto-answers.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/05-partial-auto-answers.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/09-four-types-chatbot.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/09-four-types-chatbot.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/11-mismatch-no-match.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/11-mismatch-no-match.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/12-two-responders-partial-match.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/12-two-responders-partial-match.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/13-tag-reopen-mismatch-then-match.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/13-tag-reopen-mismatch-then-match.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/14-exact-chatbot-memory.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/talks-matching/14-exact-chatbot-memory.md', 'tests/e2e/staged/stage3-three-user/'],
  // stage4
  ['tests/e2e/03-capacity-eviction.spec.ts', 'tests/e2e/staged/stage4-four-user/'],
  ['tests/e2e/03-capacity-eviction.md', 'tests/e2e/staged/stage4-four-user/'],
  // stage5
  ['tests/e2e/00k-capacity-regional-spread.spec.ts', 'tests/e2e/staged/stage5-multi-user/'],
  ['tests/e2e/00d-super-user-20-broadcast.spec.ts', 'tests/e2e/staged/stage5-multi-user/'],
  ['tests/e2e/00d-super-user-20-broadcast.md', 'tests/e2e/staged/stage5-multi-user/'],
  ['tests/e2e/13-me-filters-credit.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/13-me-filters-credit.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/24-profile-privacy-visibility.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/24-profile-privacy-visibility.md', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/26-offline-reconnect-incoming-sync.spec.ts', 'tests/e2e/staged/stage3-three-user/'],
  ['tests/e2e/26-offline-reconnect-incoming-sync.md', 'tests/e2e/staged/stage3-three-user/'],
];

function fixImports(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  const depth = filePath.split('/staged/')[1].split('/').length - 1;
  const prefix = '../'.repeat(depth + 1);
  text = text.replace(/from '\.\/helpers\//g, `from '${prefix}helpers/`);
  text = text.replace(/from "\.\/helpers\//g, `from "${prefix}helpers/`);
  text = text.replace(/clearGunDatabases\(\)/g, 'maybeClearGunDatabases()');
  text = text.replace(/\bclearGunDatabases\b/g, 'maybeClearGunDatabases');
  fs.writeFileSync(filePath, text);
}

for (const [src, destDir] of moves) {
  const absSrc = path.join(root, src);
  if (!fs.existsSync(absSrc)) {
    console.warn('skip missing', src);
    continue;
  }
  fs.mkdirSync(path.join(root, destDir), { recursive: true });
  const dest = path.join(root, destDir, path.basename(src));
  execSync(`git mv "${absSrc}" "${dest}"`, { cwd: root, stdio: 'inherit' });
  if (src.endsWith('.spec.ts')) fixImports(dest);
}

console.log('Done. Add stage bootstrap specs and update playwright.config.');
