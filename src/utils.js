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
const CLOCK_OFFSET_MAX_SECONDS = 180;
const CLOCK_OFFSET_STEP_SECONDS = 0.5;
const STOP_SEARCH_FRACTION = 0.8;
const STOP_PEDALLING_WATTS = 50;
const STOP_QUIET_WATTS = 30;
const STOP_QUIET_SAMPLES = 5;
const DISTANCE_SHIFT_DEFAULT_MAX_KM = 1;
const DISTANCE_SHIFT_COARSE_KM = 0.05;
const DISTANCE_SHIFT_FINE_KM = 0.01;
const ELEVATION_SAMPLE_STRIDE = 5;
const MIN_ELEVATION_PAIRS = 50;
const MIN_ELEVATION_CORRELATION = 0.9;
const MAX_ELEVATION_RIDERS = 5;
const MIN_CALIBRATION_RIDERS = 3;
const GROUP_GAP_THRESHOLD_SECONDS = 3;
const GROUP_GAP_RELEASE_SECONDS = 5;
const GROUP_MAX_SPAN_SECONDS = 20;
const GROUP_MAX_SPAN_RELEASE_SECONDS = 25;
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
function standingId(standing) {
  return standing.rider?.zwiftId ?? standing.position;
}

function trackGroups(standings, time, watchingPosition, { sampleInterval = 1, linked = new Set() } = {}) {
  const nextLinked = new Set();
  if (standings.length === 0) return { groups: [], linked: nextLinked };

  const groups = [];
  let currentGroup = [standings[0]];

  for (let i = 1; i < standings.length; i++) {
    const prevRider = standings[i - 1];
    const rider = standings[i];
    const pair = `${standingId(prevRider)}|${standingId(rider)}`;
    const wasLinked = linked.has(pair);
    const timeGap = calcStandingGap(prevRider, rider, time, sampleInterval);
    const span = calcStandingGap(currentGroup[0], rider, time, sampleInterval);
    const maxGap = wasLinked ? GROUP_GAP_RELEASE_SECONDS : GROUP_GAP_THRESHOLD_SECONDS;
    const maxSpan = wasLinked ? GROUP_MAX_SPAN_RELEASE_SECONDS : GROUP_MAX_SPAN_SECONDS;

    if (timeGap <= maxGap && span <= maxSpan) {
      currentGroup.push(rider);
      nextLinked.add(pair);
    } else {
      groups.push(currentGroup);
      currentGroup = [rider];
    }
  }

  groups.push(currentGroup);

  return { groups: describeGroups(groups, standings[0], time, watchingPosition, sampleInterval), linked: nextLinked };
}

function detectGroups(standings, time, watchingPosition, sampleInterval = 1) {
  return trackGroups(standings, time, watchingPosition, { sampleInterval }).groups;
}

function describeGroups(groups, leader, time, watchingPosition, sampleInterval) {
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

function seriesEndTime(rider, sampleInterval = 1) {
  return Math.max((rider.distance?.length || 0) - 1, 0) * sampleInterval;
}

function riderFinishTime(rider, sampleInterval = 1) {
  return rider.finishTime > 0 ? rider.finishTime : seriesEndTime(rider, sampleInterval);
}

function raceDuration(riders, sampleInterval = 1) {
  return Math.max(0, ...riders.map(rider => Math.max(riderFinishTime(rider, sampleInterval), seriesEndTime(rider, sampleInterval))));
}

function distanceAtTime(rider, time, sampleInterval = 1) {
  const samples = rider.distance || [];
  const lastIndex = samples.length - 1;
  const position = time / sampleInterval;
  const index = Math.floor(position);
  if (index < lastIndex) {
    const base = samples[index] || 0;
    return base + ((samples[index + 1] || base) - base) * (position - index);
  }
  const speedKmPerSecond = calcSpeed(rider, lastIndex * sampleInterval, sampleInterval) / SECONDS_PER_HOUR;
  return (samples[lastIndex] || 0) + speedKmPerSecond * (time - lastIndex * sampleInterval);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function timedRiders(riders) {
  return riders.filter(rider => rider.finishTime > 0 && rider.distance?.length > 1);
}

function pedalStopIndex(power = []) {
  for (let i = power.length - 1; i > power.length * STOP_SEARCH_FRACTION; i--) {
    if (power[i] <= STOP_PEDALLING_WATTS) continue;
    const after = power.slice(i + 1, i + 1 + STOP_QUIET_SAMPLES);
    return after.length === STOP_QUIET_SAMPLES && after.every(watts => watts < STOP_QUIET_WATTS) ? i + 1 : -1;
  }
  return -1;
}

function offsetFromPedalStops(riders, sampleInterval) {
  const offsets = riders
    .map(rider => ({ rider, stop: pedalStopIndex(rider.power) }))
    .filter(({ stop }) => stop > 0)
    .map(({ rider, stop }) => rider.finishTime - stop * sampleInterval)
    .filter(offset => offset >= 0 && offset <= CLOCK_OFFSET_MAX_SECONDS);
  return offsets.length >= MIN_CALIBRATION_RIDERS ? median(offsets) : null;
}

function finishSpread(riders, offset, sampleInterval) {
  const kms = riders.map(rider => distanceAtTime(rider, rider.finishTime - offset, sampleInterval));
  const mid = median(kms);
  return median(kms.map(km => Math.abs(km - mid)));
}

function offsetFromFinishSpread(riders, sampleInterval) {
  let best = { offset: 0, spread: Infinity };
  for (let offset = 0; offset <= CLOCK_OFFSET_MAX_SECONDS; offset += CLOCK_OFFSET_STEP_SECONDS) {
    const spread = finishSpread(riders, offset, sampleInterval);
    if (spread < best.spread) best = { offset, spread };
  }
  return best.offset;
}

function estimateClockOffset(riders, sampleInterval = 1) {
  const timed = timedRiders(riders);
  if (timed.length < MIN_CALIBRATION_RIDERS) return 0;
  return offsetFromPedalStops(timed, sampleInterval) ?? offsetFromFinishSpread(timed, sampleInterval);
}

function courseElevationAt({ xs, ys }, km) {
  let low = 0;
  let high = xs.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (xs[mid] < km) low = mid + 1;
    else high = mid;
  }
  return ys[low];
}

function elevationCorrelation(rider, course, shift) {
  const lastKm = course.xs[course.xs.length - 1];
  const pairs = [];
  for (let i = 0; i < rider.distance.length; i += ELEVATION_SAMPLE_STRIDE) {
    const km = rider.distance[i] - shift;
    if (km >= course.xs[0] && km <= lastKm) pairs.push([rider.elevation[i], courseElevationAt(course, km)]);
  }
  if (pairs.length < MIN_ELEVATION_PAIRS) return -1;
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  pairs.forEach(([a, b]) => {
    ab += (a - meanA) * (b - meanB);
    aa += (a - meanA) ** 2;
    bb += (b - meanB) ** 2;
  });
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : -1;
}

function bestShiftFor(rider, course, maxShift) {
  const search = (from, to, step) => {
    let best = { shift: from, score: -Infinity };
    for (let shift = from; shift <= to + 1e-9; shift += step) {
      const score = elevationCorrelation(rider, course, shift);
      if (score > best.score) best = { shift, score };
    }
    return best;
  };
  const coarse = search(-DISTANCE_SHIFT_COARSE_KM, maxShift, DISTANCE_SHIFT_COARSE_KM);
  return search(coarse.shift - DISTANCE_SHIFT_COARSE_KM, coarse.shift + DISTANCE_SHIFT_COARSE_KM, DISTANCE_SHIFT_FINE_KM);
}

function estimateDistanceShift(riders, course, maxShift = DISTANCE_SHIFT_DEFAULT_MAX_KM) {
  const usable = riders.filter(rider => rider.elevation?.length > 0 && rider.elevation.length === rider.distance?.length);
  if (!(course?.xs?.length > 1) || usable.length === 0) return null;
  const fits = usable.slice(0, MAX_ELEVATION_RIDERS).map(rider => bestShiftFor(rider, course, maxShift));
  if (median(fits.map(fit => fit.score)) < MIN_ELEVATION_CORRELATION) return null;
  return median(fits.map(fit => fit.shift));
}

function calibrateRace(riders, course, sampleInterval = 1) {
  const offset = estimateClockOffset(riders, sampleInterval);
  const timed = timedRiders(riders);
  const finishRawKm = timed.length > 0 ? median(timed.map(rider => distanceAtTime(rider, rider.finishTime - offset, sampleInterval))) : null;
  const courseKm = course?.lengthKm ?? null;
  const anchorShift = finishRawKm !== null && courseKm !== null ? finishRawKm - courseKm : 0;
  const maxShift = Math.max(DISTANCE_SHIFT_DEFAULT_MAX_KM, anchorShift + 1);
  const shift = estimateDistanceShift(riders, course, maxShift) ?? anchorShift;
  const finishKm = finishRawKm !== null ? finishRawKm - shift : courseKm;
  return { offset, shift, finishKm, finishRawKm };
}

function padSeries(series, count, fill) {
  return series ? new Array(count).fill(fill).concat(series) : series;
}

function normalizeRider(rider, { offset = 0, shift = 0, finishKm = null, finishRawKm = null }, sampleInterval) {
  const timed = rider.finishTime > 0;
  const ownFinish = timed && finishRawKm !== null ? distanceAtTime(rider, rider.finishTime - offset, sampleInterval) - shift : null;
  const scale = ownFinish > 0 && finishKm > 0 ? finishKm / ownFinish : 1;
  const pad = Math.round(offset / sampleInterval);
  const distance = (rider.distance || []).map(km => (km - shift) * scale);
  return {
    ...rider,
    distance: padSeries(distance, pad, distance[0] ?? 0),
    power: padSeries(rider.power, pad, 0),
    heartRate: padSeries(rider.heartRate, pad, rider.heartRate?.[0] ?? 0),
    elevation: padSeries(rider.elevation, pad, rider.elevation?.[0] ?? 0),
    finishDistance: timed && finishKm !== null ? finishKm : undefined,
  };
}

function normalizeRiders(riders, calibration = {}, sampleInterval = 1) {
  return riders.map(rider => normalizeRider(rider, calibration, sampleInterval));
}

function riderStandingAt(rider, time, sampleInterval) {
  const samples = rider.distance || [];
  const lastIndex = samples.length - 1;
  const index = Math.min(timeToIndex(time, sampleInterval), lastIndex);
  const finishTime = riderFinishTime(rider, sampleInterval);
  const finished = time >= finishTime;
  return {
    rider,
    position: rider.position,
    distance: samples,
    currentDistance: finished ? rider.finishDistance ?? samples[lastIndex] ?? 0 : samples[index] || 0,
    currentPower: finished ? 0 : rider.power?.[index] || 0,
    finished,
    finishTime,
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
    trackGroups,
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
    normalizeRiders,
    calibrateRace,
    estimateClockOffset,
    estimateDistanceShift,
    raceDuration,
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
