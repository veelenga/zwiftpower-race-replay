/**
 * Shared utility functions for ZwiftPower Race Replay
 * Pure functions that can be easily tested
 */

// Constants
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MAX_POSITION = 200;

/**
 * Format seconds into mm:ss string
 * @param {number} seconds - Total seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
  const mins = Math.floor(seconds / SECONDS_PER_MINUTE);
  const secs = Math.floor(seconds % SECONDS_PER_MINUTE);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format time gap as a human-readable string
 * @param {number} seconds - Gap in seconds
 * @returns {string} Formatted gap string
 */
function formatTimeGap(seconds) {
  if (seconds <= 0) return '-';
  return `+${formatGapDuration(seconds)}`;
}

function formatGapDuration(seconds) {
  if (seconds < SECONDS_PER_MINUTE) return `${seconds}s`;
  const mins = Math.floor(seconds / SECONDS_PER_MINUTE);
  const secs = seconds % SECONDS_PER_MINUTE;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format relative time from ISO date string
 * @param {string} isoString - ISO date string
 * @returns {string} Relative time string (e.g., "5m ago", "2h ago")
 */
function formatRelativeTime(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (MS_PER_SECOND * SECONDS_PER_MINUTE));
  const diffHours = Math.floor(diffMins / SECONDS_PER_MINUTE);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < SECONDS_PER_MINUTE) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Extract Zwift ID from a profile URL
 * Supports multiple URL formats used by ZwiftPower
 * @param {string} href - Profile URL
 * @returns {string|null} Zwift ID or null
 */
function extractZwiftId(href) {
  if (!href) return null;

  // Format: ?z=123456 or &z=123456
  let match = href.match(/[?&]z=(\d+)/);
  if (match) return match[1];

  // Format: /profile/123456
  match = href.match(/\/profile\/(\d+)/);
  if (match) return match[1];

  // Format: zwift_id=123456
  match = href.match(/zwift_id=(\d+)/);
  if (match) return match[1];

  return null;
}

/**
 * Select riders to sync (top N + current user, with current user first)
 * @param {Array} allRiders - All riders sorted by position
 * @param {number} maxRiders - Maximum riders to sync
 * @returns {Array} Riders to sync, with current user first if present
 */
function selectRidersToSync(allRiders, maxRiders) {
  const currentUser = allRiders.find(r => r.isCurrentUser);
  const topRiders = allRiders.slice(0, maxRiders);

  // Add current user if not already in top riders
  if (currentUser && !topRiders.some(r => r.zwiftId === currentUser.zwiftId)) {
    topRiders.push(currentUser);
  }

  // Reorder to put current user first
  if (currentUser) {
    const reordered = topRiders.filter(r => r.zwiftId === currentUser.zwiftId);
    reordered.push(...topRiders.filter(r => r.zwiftId !== currentUser.zwiftId));
    return reordered;
  }

  return topRiders;
}

/**
 * Clamp a value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const EVENT_ID_PATTERN = /^\d+(_[A-Z0-9]+)?$/;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

function isValidEventId(value) {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value);
}

const CATEGORY_PATTERN = /^([A-E]|ALL)$/i;
const HASH_CATEGORY_PATTERN = /[#_]([A-E])$/i;
const URL_CATEGORY_PATTERN = /[?&]cat(?:egory)?=([A-E])/i;

/**
 * Check if a value is a valid race category
 * @param {string} value - Value to check
 * @returns {boolean} Whether value is a valid category (A-E or ALL)
 */
function isValidCategory(value) {
  return value && CATEGORY_PATTERN.test(value);
}

/**
 * Parse category from URL hash
 * @param {string} hash - URL hash (e.g., "#_A" or "#B")
 * @returns {string|null} Category letter in uppercase or null
 */
function parseCategoryFromHash(hash) {
  if (!hash) return null;
  const match = hash.match(HASH_CATEGORY_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Parse category from URL query string
 * @param {string} search - URL search string (e.g., "?cat=A" or "?category=B")
 * @returns {string|null} Category letter in uppercase or null
 */
function parseCategoryFromUrl(search) {
  if (!search) return null;
  const match = search.match(URL_CATEGORY_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Format category ID into display name
 * @param {string} categoryId - Category ID (A-E or ALL)
 * @returns {string|null} Display name (e.g., "Category A" or "All")
 */
function formatCategoryName(categoryId) {
  if (!categoryId) return null;
  return categoryId === 'ALL' ? 'All' : `Category ${categoryId}`;
}

/**
 * Parse position from text
 * Returns position if it's a valid number within range, null otherwise
 * @param {string} text - Text to parse
 * @param {number} maxPosition - Maximum valid position
 * @returns {number|null} Position number or null
 */
function parsePosition(text, maxPosition = MAX_POSITION) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const pos = parseInt(trimmed, 10);
  return pos > 0 && pos <= maxPosition ? pos : null;
}

function isSyncStatusForEvent(status, eventId) {
  return Boolean(status && eventId) && status.eventId === eventId;
}

function isSyncStatusStale(status, now, maxAgeMs) {
  if (!status) return false;
  const updatedAt = Date.parse(status.updatedAt);
  return Number.isNaN(updatedAt) || now - updatedAt > maxAgeMs;
}

function buildRaceKey(eventId, categoryId) {
  return categoryId ? `${eventId}_${categoryId}` : eventId;
}

function summarizeSyncedRaces(syncedRaces) {
  return Object.fromEntries(
    Object.entries(syncedRaces || {}).map(([raceKey, race]) => [raceKey, {
      riderCount: race?.riders?.length || 0,
      syncInProgress: Boolean(race?.syncInProgress),
    }])
  );
}

function calcSyncPercent(current, total) {
  return total > 0 ? clamp(Math.round((current / total) * 100), 0, 100) : 0;
}

function describeSyncedRace(raceSummary) {
  const synced = `${raceSummary.riderCount} riders synced`;
  return raceSummary.syncInProgress ? `${synced}, sync incomplete` : synced;
}

const REPLAY_CONTROL_SYNC_STATES = {
  starting: () => ({
    kind: 'syncing',
    buttonLabel: 'Syncing',
    progress: 0,
    link: 'cancel',
    statusText: 'Preparing riders',
    isError: false,
  }),
  syncing: status => ({
    kind: 'syncing',
    buttonLabel: `Syncing ${status.current}/${status.total}`,
    progress: calcSyncPercent(status.current, status.total),
    link: 'cancel',
    statusText: status.riderName ? `#${status.riderPosition} ${status.riderName}` : '',
    isError: false,
  }),
  error: status => ({
    kind: 'error',
    buttonLabel: 'Retry',
    progress: null,
    link: null,
    statusText: status.error || 'Sync failed',
    isError: true,
  }),
};

function buildSyncedControlState(raceSummary, noticeText) {
  return {
    kind: 'synced',
    buttonLabel: 'Watch replay',
    progress: null,
    link: 'resync',
    statusText: noticeText || describeSyncedRace(raceSummary),
    isError: Boolean(noticeText),
  };
}

function buildReplayControlState({ syncStatus, raceSummary, raceKey, now, maxAgeMs, notice = null }) {
  const isCurrentStatus = syncStatus?.raceKey === raceKey && !isSyncStatusStale(syncStatus, now, maxAgeMs);
  const buildSyncState = isCurrentStatus ? REPLAY_CONTROL_SYNC_STATES[syncStatus.status] : null;
  if (buildSyncState) return buildSyncState(syncStatus);

  if (raceSummary) return buildSyncedControlState(raceSummary, notice?.raceKey === raceKey ? notice.text : null);

  return { kind: 'idle', buttonLabel: 'Replay race', progress: null, link: null, statusText: '', isError: false };
}

const AUTH_STATUSES = [401, 403];
const RATE_LIMITED_STATUS = 429;
const SERVER_ERROR_STATUS = 500;
const LOGIN_URL_PATTERN = /login|\/auth\//i;
const HTML_CONTENT_TYPE_PATTERN = /\btext\/html\b/i;
const HTML_DOCUMENT_PATTERN = /<!doctype html|<html[\s>]/i;

function parseJsonOrUndefined(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isHtmlBody(contentType, bodyText) {
  return HTML_DOCUMENT_PATTERN.test(bodyText) ||
    (HTML_CONTENT_TYPE_PATTERN.test(contentType) && bodyText.trimStart().startsWith('<'));
}

function classifyAnalysisResponse({ status, contentType = '', bodyText = '', url = '' }) {
  if (AUTH_STATUSES.includes(status) || LOGIN_URL_PATTERN.test(url)) return 'auth';
  if (status === RATE_LIMITED_STATUS) return 'rate-limited';
  if (status >= SERVER_ERROR_STATUS) return 'server-error';
  if (status < 200 || status >= 300) return 'invalid';
  if (!bodyText.trim()) return 'empty';

  const data = parseJsonOrUndefined(bodyText);
  if (data === undefined) return isHtmlBody(contentType, bodyText) ? 'auth' : 'invalid';
  return Array.isArray(data?.xData) && data.xData.length > 0 ? 'ok' : 'empty';
}

function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

function throttle(fn, intervalMs) {
  let lastRunAt = -Infinity;
  let timer = null;
  let pendingArgs = null;

  const run = () => {
    clearTimeout(timer);
    timer = null;
    lastRunAt = Date.now();
    const args = pendingArgs;
    pendingArgs = null;
    fn(...args);
  };

  const throttled = (...args) => {
    pendingArgs = args;
    const waitMs = intervalMs - (Date.now() - lastRunAt);
    if (waitMs <= 0) run();
    else if (!timer) timer = setTimeout(run, waitMs);
  };

  throttled.flush = () => {
    if (pendingArgs) run();
  };

  return throttled;
}

const PLAYBACK_SPEEDS = [1, 5, 10, 30];
const SEEK_STEP_SECONDS = 5;
const SEEK_SHIFT_STEP_SECONDS = 30;
const FRAME_STEP_SECONDS = 1;
const FRAME_SHIFT_STEP_SECONDS = 10;
const STEP_BUTTONS = [-FRAME_SHIFT_STEP_SECONDS, -FRAME_STEP_SECONDS, FRAME_STEP_SECONDS, FRAME_SHIFT_STEP_SECONDS];
const TEXT_ENTRY_TAGS = ['SELECT', 'TEXTAREA'];
const NON_TEXT_INPUT_TYPES = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];
const ACTIVATABLE_TAGS = ['BUTTON', 'A', 'SUMMARY'];

function isTextEntryTarget(target) {
  if (!target) return false;
  if (TEXT_ENTRY_TAGS.includes(target.tagName)) return true;
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.includes(target.type);
  return target.isContentEditable === true;
}

function isActivatableTarget(target) {
  return Boolean(target) && ACTIVATABLE_TAGS.includes(target.tagName);
}

function shortcutForKey(key, shiftKey) {
  const seekStep = shiftKey ? SEEK_SHIFT_STEP_SECONDS : SEEK_STEP_SECONDS;
  const frameStep = shiftKey ? FRAME_SHIFT_STEP_SECONDS : FRAME_STEP_SECONDS;
  switch (key) {
    case ' ': return { type: 'togglePlay' };
    case 'ArrowLeft': return { type: 'seekBy', seconds: -seekStep };
    case 'ArrowRight': return { type: 'seekBy', seconds: seekStep };
    case ',': case '<': return { type: 'stepBy', seconds: -frameStep };
    case '.': case '>': return { type: 'stepBy', seconds: frameStep };
    default: return null;
  }
}

function resolveShortcut({ key, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false, repeat = false, target = null }) {
  if (ctrlKey || metaKey || altKey || isTextEntryTarget(target)) return null;
  if (key === ' ' && isActivatableTarget(target)) return null;

  const action = shortcutForKey(key, shiftKey);
  if (!action || (repeat && action.type === 'togglePlay')) return null;
  return action;
}

function advancePlaybackTime(time, elapsedMs, speed, maxTime) {
  return clamp(time + (elapsedMs / MS_PER_SECOND) * speed, 0, maxTime);
}

function resolveWatchedRider(riders, selectedId) {
  return riders.find(rider => rider.zwiftId === selectedId) ||
    riders.find(rider => rider.isCurrentUser) ||
    riders.reduce((best, rider) => (!best || rider.position < best.position ? rider : best), null);
}

function buildWatchOptions(riders) {
  return [...riders]
    .sort((a, b) => a.position - b.position)
    .map(rider => ({
      value: rider.zwiftId,
      position: rider.position,
      label: `#${rider.position} ${rider.name}${rider.isCurrentUser ? ' (you)' : ''}`,
    }));
}

function formatGapTo(seconds, target) {
  return seconds > 0 ? `${formatTimeGap(seconds)} to ${target}` : null;
}

function formatRiderGap(gap, relation) {
  return gap?.seconds > 0 ? `${formatGapDuration(gap.seconds)} ${relation} ${gap.name}` : null;
}

function formatOrdinal(rank) {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[rank % 10] ?? 'th';
  return `${rank}${suffix}`;
}

function buildRiderStatsParts({ rank, power, gapToLeader, gapToGroup, ahead, behind, watchedGap }) {
  return [
    rank > 0 ? formatOrdinal(rank) : null,
    Number.isFinite(power) ? `${power} W` : null,
    formatGapTo(gapToLeader, 'leader'),
    formatGapTo(gapToGroup, 'group'),
    formatRiderGap(ahead, 'behind'),
    formatRiderGap(behind, 'ahead of'),
    watchedGap ? formatRiderGap(watchedGap, watchedGap.ahead ? 'ahead of' : 'behind') : null,
  ].filter(Boolean);
}

function buildRiderStatsText(stats) {
  return buildRiderStatsParts(stats).join(' · ');
}

function laneRoom(laneXs, x) {
  return laneXs.reduce((room, placed) => Math.min(room, Math.abs(placed - x)), Infinity);
}

function assignDotLanes(xs, spacing, maxLanes, pinned = []) {
  const byX = (a, b) => xs[b] - xs[a];
  const pinnedSet = new Set(pinned);
  const order = [...pinned].sort(byX).concat(xs.map((x, index) => index).filter(index => !pinnedSet.has(index)).sort(byX));
  const laneXs = [];
  const lanes = new Array(xs.length).fill(0);
  order.forEach(index => {
    const x = xs[index];
    let lane = laneXs.findIndex(placed => laneRoom(placed, x) >= spacing);
    if (lane < 0 && laneXs.length < maxLanes) lane = laneXs.length;
    if (lane < 0) lane = laneXs.map(placed => laneRoom(placed, x)).reduce((best, room, i, rooms) => (room > rooms[best] ? i : best), 0);
    (laneXs[lane] ||= []).push(x);
    lanes[index] = lane;
  });
  return lanes;
}

// Export for testing and module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    formatTimeGap,
    formatRelativeTime,
    extractZwiftId,
    selectRidersToSync,
    clamp,
    escapeHtml,
    isValidEventId,
    isValidCategory,
    parseCategoryFromHash,
    parseCategoryFromUrl,
    formatCategoryName,
    parsePosition,
    isSyncStatusForEvent,
    isSyncStatusStale,
    buildRaceKey,
    summarizeSyncedRaces,
    buildReplayControlState,
    classifyAnalysisResponse,
    debounce,
    throttle,
    resolveShortcut,
    advancePlaybackTime,
    resolveWatchedRider,
    buildWatchOptions,
    buildRiderStatsText,
    buildRiderStatsParts,
    formatOrdinal,
    assignDotLanes,
    formatGapDuration,
    MAX_POSITION,
    PLAYBACK_SPEEDS,
    SEEK_STEP_SECONDS,
    SEEK_SHIFT_STEP_SECONDS,
    FRAME_STEP_SECONDS,
    FRAME_SHIFT_STEP_SECONDS,
    STEP_BUTTONS,
  };
}
