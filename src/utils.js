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
      name: idx === 0 ? 'Lead Group' : `Group ${idx + 1}`,
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

/**
 * Highlight matching text in a name string
 * @param {string} name - Full name
 * @param {string} searchTerm - Search term to highlight
 * @returns {string} Name with HTML highlighting
 */
function highlightMatch(name, searchTerm) {
  if (!name || !searchTerm || !searchTerm.trim()) return name;

  const searchLower = searchTerm.toLowerCase().trim();
  const idx = name.toLowerCase().indexOf(searchLower);

  if (idx < 0) return name;

  return name.slice(0, idx) +
    '<mark style="background:#58a6ff33;color:#58a6ff;">' +
    name.slice(idx, idx + searchTerm.length) +
    '</mark>' +
    name.slice(idx + searchTerm.length);
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
    highlightMatch,
    isValidCategory,
    parseCategoryFromHash,
    parseCategoryFromUrl,
    formatCategoryName,
    parsePosition,
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
  };
}
