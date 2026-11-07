/**
 * Shared utility functions for ZwiftPower Race Replay
 * Pure functions that can be easily tested
 */

// Constants
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const MS_PER_SECOND = 1000;
const DEFAULT_SPEED_KMH = 40;
const MIN_SPEED_KMH = 10;
const GROUP_GAP_THRESHOLD_SECONDS = 5;
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
 * Convert real time (seconds) to data array index
 * @param {number} time - Time in seconds
 * @param {number} sampleInterval - Sample interval (default 1)
 * @returns {number} Array index
 */
function timeToIndex(time, sampleInterval = 1) {
  return Math.floor(time / sampleInterval);
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
 * Calculate speed in km/h from distance data
 * @param {Object} rider - Rider object with distance array
 * @param {number} time - Current time in seconds
 * @param {number} sampleInterval - Sample interval (default 1)
 * @returns {number} Speed in km/h
 */
function calcSpeed(rider, time, sampleInterval = 1) {
  const MIN_TIME_FOR_SPEED = 3;
  if (!rider.distance || time < MIN_TIME_FOR_SPEED) return DEFAULT_SPEED_KMH;

  const idx = timeToIndex(time, sampleInterval);
  const prevIdx = Math.max(0, idx - 1);
  const d1 = rider.distance[prevIdx] || 0;
  const d2 = rider.distance[idx] || d1;
  const speedKmPerSec = (d2 - d1) / sampleInterval;
  const speedKmh = speedKmPerSec * SECONDS_PER_HOUR;

  return Math.max(speedKmh, MIN_SPEED_KMH);
}

/**
 * Calculate time gap from distance in km
 * @param {number} distanceKm - Distance gap in km
 * @param {Object} trailingRider - Rider behind (for speed calc)
 * @param {number} time - Current time
 * @param {number} sampleInterval - Sample interval
 * @returns {number} Time gap in seconds
 */
function calcTimeGapFromDistance(distanceKm, trailingRider, time, sampleInterval = 1) {
  const speedKmh = calcSpeed(trailingRider, time, sampleInterval);
  const timeHours = distanceKm / speedKmh;
  return Math.round(timeHours * SECONDS_PER_HOUR);
}

/**
 * Calculate time gap between two riders
 * @param {Object} riderA - Lead rider
 * @param {Object} riderB - Trailing rider
 * @param {number} time - Current time
 * @param {number} sampleInterval - Sample interval
 * @returns {number} Time gap in seconds
 */
function calcTimeGap(riderA, riderB, time, sampleInterval = 1) {
  if (time === 0) return 0;
  const distA = riderA.currentDistance ?? riderA.distance?.[timeToIndex(time, sampleInterval)] ?? 0;
  const distB = riderB.currentDistance ?? riderB.distance?.[timeToIndex(time, sampleInterval)] ?? 0;
  const distanceKm = distA - distB;
  return calcTimeGapFromDistance(distanceKm, riderB, time, sampleInterval);
}

/**
 * Detect groups of riders based on time gaps
 * @param {Array} standings - Sorted array of riders by distance (descending)
 * @param {number} time - Current time
 * @param {number} watchingPosition - Position of the rider being watched
 * @param {number} sampleInterval - Sample interval
 * @returns {Array} Array of group objects
 */
function detectGroups(standings, time, watchingPosition, sampleInterval = 1) {
  if (standings.length === 0) return [];

  const groups = [];
  let currentGroup = [standings[0]];

  for (let i = 1; i < standings.length; i++) {
    const prevRider = standings[i - 1];
    const rider = standings[i];
    const distanceGapKm = prevRider.currentDistance - rider.currentDistance;
    const timeGap = calcTimeGapFromDistance(distanceGapKm, rider, time, sampleInterval);

    if (timeGap <= GROUP_GAP_THRESHOLD_SECONDS) {
      currentGroup.push(rider);
    } else {
      groups.push(currentGroup);
      currentGroup = [rider];
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  const leader = standings[0];

  return groups.map((groupRiders, idx) => {
    const avgPower = Math.round(
      groupRiders.reduce((sum, r) => sum + r.currentPower, 0) / groupRiders.length
    );
    const timeGapToLeader = idx === 0 ? 0 : calcTimeGap(leader, groupRiders[0], time, sampleInterval);
    const hasYou = groupRiders.some(r => r.position === watchingPosition);

    return {
      idx,
      riders: groupRiders,
      avgPower,
      timeGapToLeader,
      hasYou,
      name: idx === 0 ? 'Lead group' : `Group ${idx + 1}`,
    };
  });
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

function riderStandingAt(rider, time, sampleInterval) {
  const samples = rider.distance || [];
  const lastIndex = samples.length - 1;
  const index = Math.min(timeToIndex(time, sampleInterval), lastIndex);
  const finished = index === lastIndex;
  return {
    rider,
    position: rider.position,
    distance: samples,
    currentDistance: samples[index] || 0,
    currentPower: finished ? 0 : rider.power?.[index] || 0,
    finished,
    finishTime: Math.max(lastIndex, 0) * sampleInterval,
  };
}

function compareStandings(a, b) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  return a.finished ? a.finishTime - b.finishTime : b.currentDistance - a.currentDistance;
}

function computeRaceStandings(riders, time, sampleInterval = 1) {
  return riders.map(rider => riderStandingAt(rider, time, sampleInterval)).sort(compareStandings);
}

function calcStandingGap(ahead, behind, time, sampleInterval = 1) {
  if (ahead.finished && behind.finished) return Math.round(behind.finishTime - ahead.finishTime);
  return calcTimeGap(ahead, behind, time, sampleInterval);
}

function calcGapToGroupAhead(groups, groupIndex, watching, time, sampleInterval = 1) {
  if (!watching || groupIndex <= 0) return 0;

  const groupAhead = groups[groupIndex - 1];
  return calcStandingGap(groupAhead.riders[groupAhead.riders.length - 1], watching, time, sampleInterval);
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

function shortRiderName(name) {
  return String(name ?? '').trim().split(/\s+/)[0];
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

function riderGap(ahead, behind, named, time, sampleInterval) {
  return { name: shortRiderName(named.rider.name), seconds: calcStandingGap(ahead, behind, time, sampleInterval) };
}

function nearestRiderGaps(standings, youIndex, time, sampleInterval = 1) {
  const you = standings[youIndex];
  if (!you) return {};
  const ahead = standings[youIndex - 1];
  const behind = standings[youIndex + 1];
  return {
    ahead: ahead && riderGap(ahead, you, ahead, time, sampleInterval),
    behind: behind && riderGap(you, behind, behind, time, sampleInterval),
  };
}

function groupGapAhead(groups, index, time, sampleInterval) {
  if (index === 0) return 0;
  const ahead = groups[index - 1].riders;
  return calcStandingGap(ahead[ahead.length - 1], groups[index].riders[0], time, sampleInterval);
}

function stripGroupIndexes(total, yourGroupIndex) {
  const wanted = yourGroupIndex < 0 ? [0, 1, 2, 3] : [0, yourGroupIndex - 1, yourGroupIndex, yourGroupIndex + 1];
  return new Set(wanted.filter(index => index >= 0 && index < total));
}

function groupChipLabel(group, isYou) {
  const [first] = group.riders;
  const who = group.riders.length === 1 ? shortRiderName(first.rider.name) : `${group.name} · ${group.riders.length} riders`;
  return `${who}${isYou ? ' (you)' : ''} · ${group.avgPower} W`;
}

function foldedChip(folded) {
  const riders = folded.reduce((sum, group) => sum + group.riders.length, 0);
  const label = riders === folded.length ? `+${riders} solo` : `+${folded.length} groups · ${riders} riders`;
  return { type: 'fold', label, gap: folded[0].gap };
}

function assignDotLanes(xs, spacing, maxLanes) {
  const order = xs.map((x, index) => index).sort((a, b) => xs[b] - xs[a]);
  const laneEdge = [];
  const lanes = new Array(xs.length).fill(0);
  order.forEach(index => {
    const x = xs[index];
    let lane = laneEdge.findIndex(edge => edge - x >= spacing);
    if (lane < 0 && laneEdge.length < maxLanes) lane = laneEdge.length;
    if (lane < 0) lane = laneEdge.indexOf(Math.max(...laneEdge));
    laneEdge[lane] = x;
    lanes[index] = lane;
  });
  return lanes;
}

function buildGroupStrip(groups, yourGroupIndex, time, sampleInterval = 1) {
  const visible = stripGroupIndexes(groups.length, yourGroupIndex);
  const items = [];
  let folded = [];
  const flush = () => {
    if (folded.length > 0) items.push(foldedChip(folded));
    folded = [];
  };
  groups.forEach((group, index) => {
    const gap = groupGapAhead(groups, index, time, sampleInterval);
    if (!visible.has(index)) {
      folded.push({ ...group, gap });
      return;
    }
    flush();
    const isYou = index === yourGroupIndex;
    items.push({ type: 'group', index, gap, isYou, label: groupChipLabel(group, isYou), zwiftId: group.riders[0].rider.zwiftId });
  });
  flush();
  return items;
}

// Export for testing and module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatTime,
    formatTimeGap,
    formatRelativeTime,
    timeToIndex,
    extractZwiftId,
    calcSpeed,
    calcTimeGapFromDistance,
    detectGroups,
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
    computeRaceStandings,
    calcStandingGap,
    calcGapToGroupAhead,
    advancePlaybackTime,
    resolveWatchedRider,
    buildWatchOptions,
    shortRiderName,
    buildRiderStatsText,
    buildRiderStatsParts,
    formatOrdinal,
    nearestRiderGaps,
    buildGroupStrip,
    assignDotLanes,
    formatGapDuration,
    DEFAULT_SPEED_KMH,
    MAX_POSITION,
    PLAYBACK_SPEEDS,
    SEEK_STEP_SECONDS,
    SEEK_SHIFT_STEP_SECONDS,
    FRAME_STEP_SECONDS,
    FRAME_SHIFT_STEP_SECONDS,
    STEP_BUTTONS,
  };
}
