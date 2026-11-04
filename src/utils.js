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
  if (seconds < SECONDS_PER_MINUTE) return `+${seconds}s`;
  const mins = Math.floor(seconds / SECONDS_PER_MINUTE);
  const secs = seconds % SECONDS_PER_MINUTE;
  return `+${mins}:${String(secs).padStart(2, '0')}`;
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
 * Check if position is valid
 * @param {number} position - Position to validate
 * @returns {boolean} Whether position is valid
 */
function isValidPosition(position) {
  return position && position > 0 && position <= MAX_POSITION;
}

/**
 * Linear interpolation between two values
 * @param {number} start - Start value
 * @param {number} end - End value
 * @param {number} t - Interpolation factor (0-1)
 * @returns {number} Interpolated value
 */
function lerp(start, end, t) {
  return start + (end - start) * t;
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

/**
 * Calculate average power for a group of riders at each time index
 * @param {Array} riders - Array of rider objects with power arrays
 * @returns {Array} Array of average power values
 */
function calcGroupAveragePower(riders) {
  if (!riders || riders.length === 0) return [];

  const maxLen = Math.max(...riders.map(r => (r.power || []).length));
  const avgPower = [];

  for (let i = 0; i < maxLen; i++) {
    const sum = riders.reduce((acc, r) => acc + ((r.power || [])[i] || 0), 0);
    avgPower.push(Math.round(sum / riders.length));
  }

  return avgPower;
}

/**
 * Calculate average heart rate for a group of riders at a specific index
 * Filters out zero/invalid values before averaging
 * @param {Array} riders - Array of rider objects with heartRate arrays
 * @param {number} index - Time index to calculate average for
 * @returns {number} Average heart rate, or 0 if no valid data
 */
function calcGroupAverageHR(riders, index) {
  if (!riders || riders.length === 0) return 0;

  const hrValues = riders
    .map(r => (r.heartRate || [])[index])
    .filter(v => v && v > 0);

  if (hrValues.length === 0) return 0;
  return Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length);
}

/**
 * Filter riders by search term (case-insensitive)
 * @param {Array} riders - Array of rider objects with name property
 * @param {string} searchTerm - Search term
 * @returns {Array} Filtered riders
 */
function filterRidersByName(riders, searchTerm) {
  if (!riders) return [];
  if (!searchTerm || !searchTerm.trim()) return riders;

  const searchLower = searchTerm.toLowerCase().trim();
  return riders.filter(r => r.name && r.name.toLowerCase().includes(searchLower));
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const HIGHLIGHT_MARK_OPEN = '<mark style="background:#58a6ff33;color:#58a6ff;">';
const EVENT_ID_PATTERN = /^\d+(_[A-Z0-9]+)?$/;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

function isValidEventId(value) {
  return typeof value === 'string' && EVENT_ID_PATTERN.test(value);
}

/**
 * Highlight matching text in a name string
 * @param {string} name - Full name
 * @param {string} searchTerm - Search term to highlight
 * @returns {string} HTML-escaped name with the first match wrapped in a mark tag
 */
function highlightMatch(name, searchTerm) {
  if (!name || !searchTerm || !searchTerm.trim()) return escapeHtml(name);

  const searchLower = searchTerm.toLowerCase().trim();
  const start = name.toLowerCase().indexOf(searchLower);

  if (start < 0) return escapeHtml(name);

  const end = start + searchLower.length;
  return escapeHtml(name.slice(0, start)) +
    HIGHLIGHT_MARK_OPEN +
    escapeHtml(name.slice(start, end)) +
    '</mark>' +
    escapeHtml(name.slice(end));
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

/**
 * Find the index of the closest value in a sorted array using binary search
 * @param {Array<number>} sortedArray - Sorted array of numbers (ascending)
 * @param {number} target - Target value to find closest match for
 * @returns {number} Index of the closest value, or -1 if array is empty
 */
function findClosestIndex(sortedArray, target) {
  if (!sortedArray || sortedArray.length === 0) return -1;
  if (sortedArray.length === 1) return 0;

  let left = 0;
  let right = sortedArray.length - 1;

  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (sortedArray[mid] < target) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  if (left === 0) return 0;
  if (left === sortedArray.length) return sortedArray.length - 1;

  const diffLeft = Math.abs(sortedArray[left] - target);
  const diffPrev = Math.abs(sortedArray[left - 1] - target);

  return diffPrev <= diffLeft ? left - 1 : left;
}

/**
 * Get a value from a data array at a specific distance position
 * Uses the distance array to find the correct index, then returns the corresponding data value
 * @param {Array<number>} distanceArray - Array of distance values (sorted ascending)
 * @param {Array<number>} dataArray - Array of data values (same length as distanceArray)
 * @param {number} targetDistance - Target distance to look up
 * @returns {number} Value from dataArray at the closest distance, or 0 if not found
 */
function getValueAtDistance(distanceArray, dataArray, targetDistance) {
  if (!distanceArray || !dataArray || distanceArray.length === 0) return 0;

  const idx = findClosestIndex(distanceArray, targetDistance);
  if (idx < 0 || idx >= dataArray.length) return 0;

  return dataArray[idx] || 0;
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

function buildReplayControlState({ syncStatus, raceSummary, raceKey, now, maxAgeMs }) {
  const isCurrentStatus = syncStatus?.raceKey === raceKey && !isSyncStatusStale(syncStatus, now, maxAgeMs);
  const buildSyncState = isCurrentStatus ? REPLAY_CONTROL_SYNC_STATES[syncStatus.status] : null;
  if (buildSyncState) return buildSyncState(syncStatus);

  if (raceSummary) {
    return {
      kind: 'synced',
      buttonLabel: 'Watch replay',
      progress: null,
      link: 'resync',
      statusText: describeSyncedRace(raceSummary),
      isError: false,
    };
  }

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

function sampleChartWindow(riders, time, { windowSeconds, stepSeconds, sampleInterval = 1 }) {
  const labels = [];
  const series = riders.map(() => ({ power: [], heartRate: [] }));
  if (!(stepSeconds > 0)) return { labels, series };

  for (let t = Math.max(0, time - windowSeconds); t <= time; t += stepSeconds) {
    const idx = timeToIndex(t, sampleInterval);
    labels.push(formatTime(t));
    riders.forEach((rider, i) => {
      series[i].power.push(rider.power?.[idx] || 0);
      series[i].heartRate.push(rider.heartRate?.[idx] || null);
    });
  }

  return { labels, series };
}

const SEEK_STEP_SECONDS = 5;
const SEEK_SHIFT_STEP_SECONDS = 30;
const REPEATABLE_SHORTCUTS = ['seekBy', 'changeSpeed'];
const TEXT_ENTRY_TAGS = ['SELECT', 'TEXTAREA'];
const NON_TEXT_INPUT_TYPES = ['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'];
const ACTIVATABLE_TAGS = ['BUTTON', 'A', 'SUMMARY'];
const DIGIT_KEY_PATTERN = /^[0-9]$/;

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
  if (DIGIT_KEY_PATTERN.test(key)) return { type: 'seekFraction', fraction: Number(key) / 10 };

  const seekStep = shiftKey ? SEEK_SHIFT_STEP_SECONDS : SEEK_STEP_SECONDS;
  switch (key) {
    case ' ': return { type: 'togglePlay' };
    case 'ArrowLeft': return { type: 'seekBy', seconds: -seekStep };
    case 'ArrowRight': return { type: 'seekBy', seconds: seekStep };
    case 'ArrowUp': return { type: 'changeSpeed', step: 1 };
    case 'ArrowDown': return { type: 'changeSpeed', step: -1 };
    case 'r':
    case 'R': return { type: 'resetZoom' };
    case '/': return { type: 'focusSearch' };
    case '?': return { type: 'toggleHelp' };
    default: return null;
  }
}

function resolveShortcut({ key, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false, repeat = false, target = null }) {
  if (key === 'Escape') return { type: 'escape' };
  if (ctrlKey || metaKey || altKey || isTextEntryTarget(target)) return null;
  if (key === ' ' && isActivatableTarget(target)) return null;

  const action = shortcutForKey(key, shiftKey);
  if (!action || (repeat && !REPEATABLE_SHORTCUTS.includes(action.type))) return null;
  return action;
}

function stepSpeed(speeds, current, step) {
  const index = speeds.indexOf(current);
  if (index < 0) return current;
  return speeds[clamp(index + step, 0, speeds.length - 1)];
}

const KM_PER_MILE = 1.609344;
const COURSE_DISTANCE_PATTERN = /Distance:\s*(\d+(?:\.\d+)?)\s*(km|mi)\b/i;
const STATS_SEPARATOR = ' · ';

function parseCourseDistanceKm(text) {
  const match = String(text ?? '').match(COURSE_DISTANCE_PATTERN);
  if (!match) return null;
  const value = Number(match[1]);
  if (!(value > 0)) return null;
  return match[2].toLowerCase() === 'mi' ? value * KM_PER_MILE : value;
}

function lastValue(values) {
  return values?.length ? values[values.length - 1] : 0;
}

function resolveCourseKm(pageCourseKm, riders) {
  if (pageCourseKm > 0) return pageCourseKm;
  return Math.max(0, ...(riders || []).map(rider => rider.totalDistance || lastValue(rider.distance)));
}

function distanceToProfileX(distanceKm, firstX, lastX, courseKm) {
  if (!(courseKm > 0)) return firstX;
  return lerp(firstX, lastX, clamp(distanceKm / courseKm, 0, 1));
}

const PROFILE_DATASET_KEYS = {
  xMin: 'zpXMin',
  xMax: 'zpXMax',
  plotLeft: 'zpPlotLeft',
  plotWidth: 'zpPlotWidth',
  plotTop: 'zpPlotTop',
  plotHeight: 'zpPlotHeight',
  courseKm: 'zpCourseKm',
};
const UPPERCASE_LETTER_PATTERN = /[A-Z]/g;

function profileDataAttributes() {
  return Object.values(PROFILE_DATASET_KEYS)
    .map(key => `data-${key.replace(UPPERCASE_LETTER_PATTERN, letter => `-${letter.toLowerCase()}`)}`);
}

function parseProfileGeometry(dataset) {
  const values = Object.fromEntries(
    Object.entries(PROFILE_DATASET_KEYS).map(([field, key]) => [field, Number.parseFloat(dataset?.[key])])
  );
  const { courseKm, ...axis } = values;
  const isValid = Object.values(axis).every(Number.isFinite) && axis.xMax > axis.xMin && axis.plotWidth > 0;
  return isValid ? { ...axis, courseKm: courseKm > 0 ? courseKm : null } : null;
}

function mapDistanceToAxisX(distanceKm, { xMin, xMax, plotLeft, plotWidth }) {
  return plotLeft + ((distanceKm - xMin) / (xMax - xMin)) * plotWidth;
}

function classifyAxisDistance(distanceKm, { xMin, xMax }) {
  if (distanceKm < xMin) return 'behind';
  return distanceKm > xMax ? 'ahead' : 'visible';
}

function transformPlotBox({ plotLeft, plotTop, plotWidth, plotHeight }, { a, b, c, d, e, f }) {
  const right = plotLeft + plotWidth;
  const bottom = plotTop + plotHeight;
  const left = a * plotLeft + c * plotTop + e;
  const top = b * plotLeft + d * plotTop + f;
  return {
    plotLeft: left,
    plotTop: top,
    plotWidth: a * right + c * bottom + e - left,
    plotHeight: b * right + d * bottom + f - top,
  };
}

function buildCurveLookup(xs, ys) {
  const order = Array.from(xs, (_, i) => i)
    .filter(i => Number.isFinite(xs[i]) && Number.isFinite(ys[i]))
    .sort((a, b) => xs[a] - xs[b]);
  if (order.length === 0) return null;

  const sortedXs = order.map(i => xs[i]);
  const sortedYs = order.map(i => ys[i]);
  return x => sortedYs[findClosestIndex(sortedXs, x)];
}

function alignNearEdges(x, minX, maxX, marginPx) {
  if (x - minX < marginPx) return 'start';
  if (maxX - x < marginPx) return 'end';
  return 'middle';
}

function riderStandingAt(rider, time, sampleInterval) {
  const samples = rider.distance || [];
  const lastIndex = samples.length - 1;
  const index = Math.min(timeToIndex(time, sampleInterval), lastIndex);
  const finished = index === lastIndex;
  return {
    ...rider,
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

function calcGapToGroupAhead(groups, watching, time, sampleInterval = 1) {
  const groupIndex = groups.findIndex(group => group.hasYou);
  if (!watching || groupIndex <= 0) return 0;

  const groupAhead = groups[groupIndex - 1];
  return calcStandingGap(groupAhead.riders[groupAhead.riders.length - 1], watching, time, sampleInterval);
}

function advancePlaybackTime(time, elapsedMs, speed, maxTime) {
  return clamp(time + (elapsedMs / MS_PER_SECOND) * speed, 0, maxTime);
}

function calcRaceDuration(riders, sampleInterval = 1) {
  return Math.max(0, ...riders.map(rider => Math.max((rider.distance?.length || 0) - 1, 0) * sampleInterval));
}

function findWatchedRider(riders) {
  return riders.find(rider => rider.isCurrentUser) ||
    riders.reduce((best, rider) => (!best || rider.position < best.position ? rider : best), null);
}

function riderMarkerRole(position, { watchingPosition, leaderPosition, groupPositions }) {
  if (position === watchingPosition) return 'you';
  if (position === leaderPosition) return 'leader';
  return groupPositions.has(position) ? 'group' : 'muted';
}

function formatGapTo(seconds, target) {
  return seconds > 0 ? `${formatTimeGap(seconds)} to ${target}` : null;
}

function buildRiderStatsText({ rank, power, leaderPower, gapToLeader, gapToGroup }) {
  return [
    rank > 0 ? `#${rank}` : null,
    Number.isFinite(power) ? `${power} W` : null,
    Number.isFinite(leaderPower) ? `leader ${leaderPower} W` : null,
    formatGapTo(gapToLeader, 'leader'),
    formatGapTo(gapToGroup, 'group'),
  ].filter(Boolean).join(STATS_SEPARATOR);
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
    calcTimeGap,
    detectGroups,
    selectRidersToSync,
    isValidPosition,
    lerp,
    clamp,
    calcGroupAveragePower,
    calcGroupAverageHR,
    filterRidersByName,
    escapeHtml,
    isValidEventId,
    highlightMatch,
    isValidCategory,
    parseCategoryFromHash,
    parseCategoryFromUrl,
    formatCategoryName,
    parsePosition,
    findClosestIndex,
    getValueAtDistance,
    isSyncStatusForEvent,
    isSyncStatusStale,
    buildRaceKey,
    summarizeSyncedRaces,
    buildReplayControlState,
    classifyAnalysisResponse,
    debounce,
    throttle,
    sampleChartWindow,
    resolveShortcut,
    stepSpeed,
    parseCourseDistanceKm,
    resolveCourseKm,
    distanceToProfileX,
    buildCurveLookup,
    profileDataAttributes,
    parseProfileGeometry,
    mapDistanceToAxisX,
    classifyAxisDistance,
    transformPlotBox,
    alignNearEdges,
    computeRaceStandings,
    calcStandingGap,
    calcGapToGroupAhead,
    advancePlaybackTime,
    calcRaceDuration,
    findWatchedRider,
    riderMarkerRole,
    buildRiderStatsText,
    // Constants
    SECONDS_PER_MINUTE,
    SECONDS_PER_HOUR,
    MS_PER_SECOND,
    DEFAULT_SPEED_KMH,
    MIN_SPEED_KMH,
    GROUP_GAP_THRESHOLD_SECONDS,
    MAX_POSITION,
    CATEGORY_PATTERN,
    HASH_CATEGORY_PATTERN,
    URL_CATEGORY_PATTERN,
    EVENT_ID_PATTERN,
    SEEK_STEP_SECONDS,
    SEEK_SHIFT_STEP_SECONDS,
    KM_PER_MILE,
  };
}
