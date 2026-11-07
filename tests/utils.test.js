/**
 * Unit tests for utility functions
 */

const {
  formatTime,
  formatTimeGap,
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
  raceDuration,
  calcStandingGap,
  calcGapToGroupAhead,
  advancePlaybackTime,
  resolveWatchedRider,
  buildWatchOptions,
  shortRiderName,
  buildRiderStatsText,
  formatOrdinal,
  nearestRiderGaps,
  buildGroupStrip,
  assignDotLanes,
  DEFAULT_SPEED_KMH,
  SEEK_STEP_SECONDS,
  SEEK_SHIFT_STEP_SECONDS,
  FRAME_STEP_SECONDS,
  FRAME_SHIFT_STEP_SECONDS,
} = require('../src/utils');

describe('formatTime', () => {
  test('formats 0 seconds', () => {
    expect(formatTime(0)).toBe('0:00');
  });

  test('formats seconds less than a minute', () => {
    expect(formatTime(30)).toBe('0:30');
    expect(formatTime(5)).toBe('0:05');
    expect(formatTime(59)).toBe('0:59');
  });

  test('formats minutes and seconds', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(125)).toBe('2:05');
  });

  test('formats longer durations', () => {
    expect(formatTime(3600)).toBe('60:00');
    expect(formatTime(3661)).toBe('61:01');
  });

  test('handles decimal seconds', () => {
    expect(formatTime(90.7)).toBe('1:30');
  });
});

describe('formatTimeGap', () => {
  test('returns dash for zero or negative', () => {
    expect(formatTimeGap(0)).toBe('-');
    expect(formatTimeGap(-5)).toBe('-');
  });

  test('formats seconds only', () => {
    expect(formatTimeGap(5)).toBe('+5s');
    expect(formatTimeGap(30)).toBe('+30s');
    expect(formatTimeGap(59)).toBe('+59s');
  });

  test('formats minutes and seconds', () => {
    expect(formatTimeGap(60)).toBe('+1:00');
    expect(formatTimeGap(90)).toBe('+1:30');
    expect(formatTimeGap(125)).toBe('+2:05');
  });
});

describe('timeToIndex', () => {
  test('with default sample interval of 1', () => {
    expect(timeToIndex(0)).toBe(0);
    expect(timeToIndex(10)).toBe(10);
    expect(timeToIndex(100)).toBe(100);
  });

  test('with sample interval of 5', () => {
    expect(timeToIndex(0, 5)).toBe(0);
    expect(timeToIndex(10, 5)).toBe(2);
    expect(timeToIndex(27, 5)).toBe(5);
  });

  test('handles decimal time', () => {
    expect(timeToIndex(10.9, 1)).toBe(10);
    expect(timeToIndex(10.9, 5)).toBe(2);
  });
});

describe('extractZwiftId', () => {
  test('extracts from ?z= format', () => {
    expect(extractZwiftId('https://zwiftpower.com/profile.php?z=123456')).toBe('123456');
  });

  test('extracts from &z= format', () => {
    expect(extractZwiftId('https://zwiftpower.com/profile.php?foo=bar&z=789012')).toBe('789012');
  });

  test('extracts from /profile/ format', () => {
    expect(extractZwiftId('https://zwiftpower.com/profile/123456')).toBe('123456');
  });

  test('extracts from zwift_id= format', () => {
    expect(extractZwiftId('https://example.com/api?zwift_id=999888')).toBe('999888');
  });

  test('returns null for invalid URLs', () => {
    expect(extractZwiftId('')).toBe(null);
    expect(extractZwiftId(null)).toBe(null);
    expect(extractZwiftId('https://example.com')).toBe(null);
    expect(extractZwiftId('https://zwiftpower.com/events.php')).toBe(null);
  });
});

describe('calcSpeed', () => {
  test('returns default speed when no distance data', () => {
    expect(calcSpeed({}, 10)).toBe(DEFAULT_SPEED_KMH);
  });

  test('returns minimum speed when distance array is empty', () => {
    // Empty array means 0-0=0 distance, so min speed
    expect(calcSpeed({ distance: [] }, 10)).toBe(10); // MIN_SPEED_KMH
  });

  test('returns default speed for time less than 3 seconds', () => {
    expect(calcSpeed({ distance: [0, 1, 2] }, 2)).toBe(DEFAULT_SPEED_KMH);
  });

  test('calculates speed from distance data', () => {
    // 1 km between idx 9 and 10 in 1 second = 3600 km/h
    const rider = { distance: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
    const speed = calcSpeed(rider, 10);
    expect(speed).toBe(3600);
  });

  test('enforces minimum speed', () => {
    // 0 km/s = 0 km/h, but enforced to MIN_SPEED_KMH
    const rider = { distance: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const speed = calcSpeed(rider, 10);
    expect(speed).toBe(10); // MIN_SPEED_KMH
  });
});

describe('calcTimeGapFromDistance', () => {
  test('calculates gap based on trailing rider speed', () => {
    // With empty distance array, calcSpeed returns MIN_SPEED_KMH (10 km/h)
    // At 10 km/h, 1 km = 360 seconds (1 hour / 10 * 1 km = 0.1 hours = 360 seconds)
    const rider = { distance: [] };
    const gap = calcTimeGapFromDistance(1, rider, 10);
    expect(gap).toBe(360);
  });

  test('calculates gap with actual rider speed', () => {
    // Rider moving at 36 km/h (10 m/s)
    const rider = { distance: [0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1] };
    const gap = calcTimeGapFromDistance(1, rider, 10);
    // At 36 km/h, 1 km = 100 seconds
    expect(gap).toBe(100);
  });

  test('returns 0 for no distance gap', () => {
    const rider = { distance: [] };
    const gap = calcTimeGapFromDistance(0, rider, 10);
    expect(gap).toBe(0);
  });
});

describe('detectGroups', () => {
  test('returns empty array for empty standings', () => {
    expect(detectGroups([], 60, 1)).toEqual([]);
  });

  test('groups all riders together when gaps are small', () => {
    const standings = [
      { position: 1, currentDistance: 10.0, currentPower: 300 },
      { position: 2, currentDistance: 9.99, currentPower: 280 },
      { position: 3, currentDistance: 9.98, currentPower: 290 },
    ];
    const groups = detectGroups(standings, 60, 1);
    expect(groups.length).toBe(1);
    expect(groups[0].riders.length).toBe(3);
    expect(groups[0].name).toBe('Lead group');
  });

  test('separates riders into groups based on gap', () => {
    const standings = [
      { position: 1, currentDistance: 10.0, currentPower: 300, distance: [] },
      { position: 2, currentDistance: 9.995, currentPower: 280, distance: [] },
      { position: 3, currentDistance: 9.5, currentPower: 270, distance: [] },
    ];
    const groups = detectGroups(standings, 60, 1);
    expect(groups.length).toBe(2);
    expect(groups[0].riders.length).toBe(2);
    expect(groups[1].riders.length).toBe(1);
  });

  test('splits a long line of riders even when each gap is small', () => {
    const standings = Array.from({ length: 12 }, (_, i) => ({
      position: i + 1,
      currentDistance: 10 - i * 0.03,
      currentPower: 300,
    }));
    const groups = detectGroups(standings, 60, 1);
    expect(groups.length).toBe(2);
    expect(groups[0].riders.length).toBe(8);
    expect(groups[1].riders.length).toBe(4);
  });

  test('keeps a rider in the group until the gap clearly opens', () => {
    const standingsAt = km => [
      { position: 1, currentDistance: 10.0, currentPower: 300 },
      { position: 2, currentDistance: 10.0 - km, currentPower: 280 },
    ];
    const fourSeconds = (4 / 3600) * DEFAULT_SPEED_KMH;
    const sixSeconds = (6 / 3600) * DEFAULT_SPEED_KMH;
    const together = trackGroups(standingsAt(0.01), 60, 1);
    expect(together.groups.length).toBe(1);
    expect(trackGroups(standingsAt(fourSeconds), 60, 1, { linked: together.linked }).groups.length).toBe(1);
    expect(trackGroups(standingsAt(fourSeconds), 60, 1).groups.length).toBe(2);
    const apart = trackGroups(standingsAt(sixSeconds), 60, 1, { linked: together.linked });
    expect(apart.groups.length).toBe(2);
    expect(trackGroups(standingsAt(fourSeconds), 60, 1, { linked: apart.linked }).groups.length).toBe(2);
  });

  test('marks group containing watched rider', () => {
    const standings = [
      { position: 1, currentDistance: 10.0, currentPower: 300 },
      { position: 2, currentDistance: 5.0, currentPower: 280 },
    ];
    const groups = detectGroups(standings, 60, 2);
    expect(groups[0].hasYou).toBe(false);
    expect(groups[1].hasYou).toBe(true);
  });

  test('calculates average power for group', () => {
    const standings = [
      { position: 1, currentDistance: 10.0, currentPower: 300 },
      { position: 2, currentDistance: 9.99, currentPower: 200 },
    ];
    const groups = detectGroups(standings, 60, 1);
    expect(groups[0].avgPower).toBe(250);
  });
});

describe('selectRidersToSync', () => {
  test('selects top N riders', () => {
    const riders = [
      { position: 1, zwiftId: 'a' },
      { position: 2, zwiftId: 'b' },
      { position: 3, zwiftId: 'c' },
    ];
    const selected = selectRidersToSync(riders, 2);
    expect(selected.length).toBe(2);
    expect(selected.map(r => r.position)).toEqual([1, 2]);
  });

  test('includes current user even if not in top N', () => {
    const riders = [
      { position: 1, zwiftId: 'a' },
      { position: 2, zwiftId: 'b' },
      { position: 3, zwiftId: 'c', isCurrentUser: true },
    ];
    const selected = selectRidersToSync(riders, 2);
    expect(selected.length).toBe(3);
    expect(selected.some(r => r.isCurrentUser)).toBe(true);
  });

  test('puts current user first in the list', () => {
    const riders = [
      { position: 1, zwiftId: 'a' },
      { position: 2, zwiftId: 'b' },
      { position: 3, zwiftId: 'c', isCurrentUser: true },
    ];
    const selected = selectRidersToSync(riders, 3);
    expect(selected[0].isCurrentUser).toBe(true);
    expect(selected[0].position).toBe(3);
  });

  test('does not duplicate current user if already in top N', () => {
    const riders = [
      { position: 1, zwiftId: 'a', isCurrentUser: true },
      { position: 2, zwiftId: 'b' },
      { position: 3, zwiftId: 'c' },
    ];
    const selected = selectRidersToSync(riders, 2);
    expect(selected.length).toBe(2);
    expect(selected[0].isCurrentUser).toBe(true); // Current user should be first
  });
});

describe('clamp', () => {
  test('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  test('clamps to min when below range', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  test('clamps to max when above range', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('escapeHtml', () => {
  test('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>Tom & Jerry</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;Tom &amp; Jerry&lt;/a&gt;'
    );
  });

  test('leaves safe text unchanged', () => {
    expect(escapeHtml('John Smith #12 (You)')).toBe('John Smith #12 (You)');
  });

  test('escapes ampersands of existing entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
  });

  test('returns empty string for null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('stringifies non-string values', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(false)).toBe('false');
  });
});

describe('isValidEventId', () => {
  test('accepts numeric event ids', () => {
    expect(isValidEventId('1234567')).toBe(true);
  });

  test('accepts event ids with a category suffix', () => {
    expect(isValidEventId('1234567_A')).toBe(true);
    expect(isValidEventId('1234567_ALL')).toBe(true);
  });

  test('rejects ids with markup or url characters', () => {
    expect(isValidEventId('123"><script>')).toBe(false);
    expect(isValidEventId('123&foo=bar')).toBe(false);
    expect(isValidEventId('123_a')).toBe(false);
    expect(isValidEventId('123_')).toBe(false);
    expect(isValidEventId('abc')).toBe(false);
  });

  test('rejects empty and non-string values', () => {
    expect(isValidEventId('')).toBe(false);
    expect(isValidEventId(null)).toBe(false);
    expect(isValidEventId(undefined)).toBe(false);
    expect(isValidEventId(123)).toBe(false);
  });
});

describe('isValidCategory', () => {
  test('returns true for valid categories A-E', () => {
    expect(isValidCategory('A')).toBe(true);
    expect(isValidCategory('B')).toBe(true);
    expect(isValidCategory('C')).toBe(true);
    expect(isValidCategory('D')).toBe(true);
    expect(isValidCategory('E')).toBe(true);
  });

  test('returns true for ALL category', () => {
    expect(isValidCategory('ALL')).toBe(true);
    expect(isValidCategory('all')).toBe(true);
    expect(isValidCategory('All')).toBe(true);
  });

  test('is case insensitive', () => {
    expect(isValidCategory('a')).toBe(true);
    expect(isValidCategory('b')).toBe(true);
  });

  test('returns false for invalid categories', () => {
    expect(isValidCategory('F')).toBe(false);
    expect(isValidCategory('Z')).toBe(false);
    expect(isValidCategory('WATTS')).toBe(false);
    expect(isValidCategory('123')).toBe(false);
    expect(isValidCategory('')).toBeFalsy();
    expect(isValidCategory(null)).toBeFalsy();
    expect(isValidCategory(undefined)).toBeFalsy();
  });
});

describe('parseCategoryFromHash', () => {
  test('parses #A format', () => {
    expect(parseCategoryFromHash('#A')).toBe('A');
    expect(parseCategoryFromHash('#B')).toBe('B');
  });

  test('parses #_A format', () => {
    expect(parseCategoryFromHash('#_A')).toBe('A');
    expect(parseCategoryFromHash('#_E')).toBe('E');
  });

  test('is case insensitive and returns uppercase', () => {
    expect(parseCategoryFromHash('#a')).toBe('A');
    expect(parseCategoryFromHash('#_b')).toBe('B');
  });

  test('returns null for invalid hash', () => {
    expect(parseCategoryFromHash('')).toBe(null);
    expect(parseCategoryFromHash(null)).toBe(null);
    expect(parseCategoryFromHash('#ALL')).toBe(null);
    expect(parseCategoryFromHash('#123')).toBe(null);
    expect(parseCategoryFromHash('#')).toBe(null);
  });
});

describe('parseCategoryFromUrl', () => {
  test('parses ?cat=A format', () => {
    expect(parseCategoryFromUrl('?cat=A')).toBe('A');
    expect(parseCategoryFromUrl('?cat=B')).toBe('B');
  });

  test('parses ?category=A format', () => {
    expect(parseCategoryFromUrl('?category=A')).toBe('A');
    expect(parseCategoryFromUrl('?category=E')).toBe('E');
  });

  test('parses with other query params', () => {
    expect(parseCategoryFromUrl('?foo=bar&cat=C')).toBe('C');
    expect(parseCategoryFromUrl('?category=D&other=value')).toBe('D');
  });

  test('is case insensitive and returns uppercase', () => {
    expect(parseCategoryFromUrl('?cat=a')).toBe('A');
    expect(parseCategoryFromUrl('?category=b')).toBe('B');
  });

  test('returns null for invalid search', () => {
    expect(parseCategoryFromUrl('')).toBe(null);
    expect(parseCategoryFromUrl(null)).toBe(null);
    expect(parseCategoryFromUrl('?foo=bar')).toBe(null);
    expect(parseCategoryFromUrl('?cat=F')).toBe(null);
    expect(parseCategoryFromUrl('?category=Z')).toBe(null);
  });
});

describe('formatCategoryName', () => {
  test('formats A-E categories', () => {
    expect(formatCategoryName('A')).toBe('Category A');
    expect(formatCategoryName('B')).toBe('Category B');
    expect(formatCategoryName('E')).toBe('Category E');
  });

  test('formats ALL as All', () => {
    expect(formatCategoryName('ALL')).toBe('All');
  });

  test('returns null for null/undefined', () => {
    expect(formatCategoryName(null)).toBe(null);
    expect(formatCategoryName(undefined)).toBe(null);
    expect(formatCategoryName('')).toBe(null);
  });
});

describe('parsePosition', () => {
  test('parses valid positions', () => {
    expect(parsePosition('1')).toBe(1);
    expect(parsePosition('50')).toBe(50);
    expect(parsePosition('200')).toBe(200);
  });

  test('trims whitespace', () => {
    expect(parsePosition('  5  ')).toBe(5);
    expect(parsePosition('\t10\n')).toBe(10);
  });

  test('returns null for zero', () => {
    expect(parsePosition('0')).toBe(null);
  });

  test('returns null for positions exceeding max', () => {
    expect(parsePosition('201')).toBe(null);
    expect(parsePosition('500')).toBe(null);
  });

  test('respects custom maxPosition', () => {
    expect(parsePosition('50', 100)).toBe(50);
    expect(parsePosition('150', 100)).toBe(null);
  });

  test('returns null for non-numeric strings', () => {
    expect(parsePosition('abc')).toBe(null);
    expect(parsePosition('12a')).toBe(null);
    expect(parsePosition('1.5')).toBe(null);
    expect(parsePosition('-1')).toBe(null);
  });

  test('returns null for empty/null/undefined', () => {
    expect(parsePosition('')).toBe(null);
    expect(parsePosition(null)).toBe(null);
    expect(parsePosition(undefined)).toBe(null);
  });
});

describe('isSyncStatusForEvent', () => {
  test('matches status with the same event ID', () => {
    expect(isSyncStatusForEvent({ status: 'syncing', eventId: '123' }, '123')).toBe(true);
  });

  test('rejects status for another event', () => {
    expect(isSyncStatusForEvent({ status: 'syncing', eventId: '456' }, '123')).toBe(false);
  });

  test('rejects missing status or event ID', () => {
    expect(isSyncStatusForEvent(null, '123')).toBe(false);
    expect(isSyncStatusForEvent(undefined, '123')).toBe(false);
    expect(isSyncStatusForEvent({ status: 'syncing' }, null)).toBe(false);
    expect(isSyncStatusForEvent({ status: 'syncing' }, undefined)).toBe(false);
  });
});

describe('isSyncStatusStale', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  const maxAgeMs = 2 * 60 * 1000;
  const updatedAgo = ms => new Date(now - ms).toISOString();

  test('keeps a recently updated status', () => {
    expect(isSyncStatusStale({ status: 'syncing', updatedAt: updatedAgo(30000) }, now, maxAgeMs)).toBe(false);
    expect(isSyncStatusStale({ status: 'starting', updatedAt: updatedAgo(maxAgeMs) }, now, maxAgeMs)).toBe(false);
    expect(isSyncStatusStale({ status: 'error', updatedAt: updatedAgo(30000) }, now, maxAgeMs)).toBe(false);
  });

  test('flags an active status older than max age', () => {
    expect(isSyncStatusStale({ status: 'syncing', updatedAt: updatedAgo(maxAgeMs + 1) }, now, maxAgeMs)).toBe(true);
    expect(isSyncStatusStale({ status: 'starting', updatedAt: updatedAgo(10 * 60 * 1000) }, now, maxAgeMs)).toBe(true);
  });

  test('flags a finished status older than max age', () => {
    const updatedAt = updatedAgo(60 * 60 * 1000);
    expect(isSyncStatusStale({ status: 'error', updatedAt }, now, maxAgeMs)).toBe(true);
    expect(isSyncStatusStale({ status: 'complete', updatedAt }, now, maxAgeMs)).toBe(true);
    expect(isSyncStatusStale({ status: 'cancelled', updatedAt }, now, maxAgeMs)).toBe(true);
  });

  test('flags a status without a valid timestamp', () => {
    expect(isSyncStatusStale({ status: 'syncing' }, now, maxAgeMs)).toBe(true);
    expect(isSyncStatusStale({ status: 'starting', updatedAt: 'not a date' }, now, maxAgeMs)).toBe(true);
    expect(isSyncStatusStale({ status: 'error' }, now, maxAgeMs)).toBe(true);
  });

  test('handles missing status', () => {
    expect(isSyncStatusStale(null, now, maxAgeMs)).toBe(false);
    expect(isSyncStatusStale(undefined, now, maxAgeMs)).toBe(false);
  });
});

describe('buildRaceKey', () => {
  test('joins event ID and category', () => {
    expect(buildRaceKey('123', 'A')).toBe('123_A');
    expect(buildRaceKey('123', 'ALL')).toBe('123_ALL');
  });

  test('uses the event ID alone without a category', () => {
    expect(buildRaceKey('123', null)).toBe('123');
    expect(buildRaceKey('123', undefined)).toBe('123');
  });
});

describe('summarizeSyncedRaces', () => {
  test('keeps rider count and sync progress per race', () => {
    const syncedRaces = {
      '123_A': { riders: [{}, {}, {}], syncInProgress: false, eventName: 'Race' },
      '123_B': { riders: [{}], syncInProgress: true },
    };

    expect(summarizeSyncedRaces(syncedRaces)).toEqual({
      '123_A': { riderCount: 3, syncInProgress: false },
      '123_B': { riderCount: 1, syncInProgress: true },
    });
  });

  test('handles races without riders', () => {
    expect(summarizeSyncedRaces({ 123: {} })).toEqual({ 123: { riderCount: 0, syncInProgress: false } });
    expect(summarizeSyncedRaces({ 123: null })).toEqual({ 123: { riderCount: 0, syncInProgress: false } });
  });

  test('returns an empty object without races', () => {
    expect(summarizeSyncedRaces(undefined)).toEqual({});
    expect(summarizeSyncedRaces(null)).toEqual({});
    expect(summarizeSyncedRaces({})).toEqual({});
  });
});

describe('buildReplayControlState', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  const maxAgeMs = 2 * 60 * 1000;
  const raceKey = '123_A';
  const freshStatus = fields => ({
    eventId: '123',
    raceKey,
    updatedAt: new Date(now - 1000).toISOString(),
    ...fields,
  });
  const build = (overrides = {}) => buildReplayControlState({
    syncStatus: null,
    raceSummary: undefined,
    raceKey,
    now,
    maxAgeMs,
    ...overrides,
  });

  test('offers a sync when the race is not synced', () => {
    expect(build()).toEqual({
      kind: 'idle',
      buttonLabel: 'Replay race',
      progress: null,
      link: null,
      statusText: '',
      isError: false,
    });
  });

  test('offers the replay and a re-sync when the race is synced', () => {
    expect(build({ raceSummary: { riderCount: 46, syncInProgress: false } })).toEqual({
      kind: 'synced',
      buttonLabel: 'Watch replay',
      progress: null,
      link: 'resync',
      statusText: '46 riders synced',
      isError: false,
    });
  });

  test('shows a notice for the synced race in place of the summary', () => {
    const raceSummary = { riderCount: 46, syncInProgress: false };
    const notice = { raceKey, text: 'Course profile not found on this page' };

    expect(build({ raceSummary, notice })).toEqual({
      kind: 'synced',
      buttonLabel: 'Watch replay',
      progress: null,
      link: 'resync',
      statusText: 'Course profile not found on this page',
      isError: true,
    });
  });

  test('ignores a notice of another category or while syncing', () => {
    const raceSummary = { riderCount: 46, syncInProgress: false };
    const notice = { raceKey: '123_B', text: 'Course profile not found on this page' };
    const syncStatus = freshStatus({ status: 'starting' });

    expect(build({ raceSummary, notice }).statusText).toBe('46 riders synced');
    expect(build({ raceSummary, syncStatus, notice: { ...notice, raceKey } }).statusText).toBe('Preparing riders');
  });

  test('marks a synced race whose sync did not finish', () => {
    const state = build({ raceSummary: { riderCount: 12, syncInProgress: true } });
    expect(state.kind).toBe('synced');
    expect(state.statusText).toBe('12 riders synced, sync incomplete');
  });

  test('shows a starting sync as syncing with empty progress', () => {
    expect(build({ syncStatus: freshStatus({ status: 'starting' }) })).toEqual({
      kind: 'syncing',
      buttonLabel: 'Syncing',
      progress: 0,
      link: 'cancel',
      statusText: 'Preparing riders',
      isError: false,
    });
  });

  test('shows sync progress with the current rider', () => {
    const syncStatus = freshStatus({
      status: 'syncing',
      current: 12,
      total: 46,
      riderName: 'Jane Doe',
      riderPosition: 7,
    });

    expect(build({ syncStatus, raceSummary: { riderCount: 11, syncInProgress: true } })).toEqual({
      kind: 'syncing',
      buttonLabel: 'Syncing 12/46',
      progress: 26,
      link: 'cancel',
      statusText: '#7 Jane Doe',
      isError: false,
    });
  });

  test('keeps progress within bounds', () => {
    expect(build({ syncStatus: freshStatus({ status: 'syncing', current: 3, total: 0 }) }).progress).toBe(0);
    expect(build({ syncStatus: freshStatus({ status: 'syncing', current: 9, total: 4 }) }).progress).toBe(100);
    expect(build({ syncStatus: freshStatus({ status: 'syncing', current: 4, total: 4 }) }).statusText).toBe('');
  });

  test('offers a retry with the error text after a failed sync', () => {
    const syncStatus = freshStatus({ status: 'error', error: 'Log in to ZwiftPower and try again.' });

    expect(build({ syncStatus, raceSummary: { riderCount: 5, syncInProgress: false } })).toEqual({
      kind: 'error',
      buttonLabel: 'Retry',
      progress: null,
      link: null,
      statusText: 'Log in to ZwiftPower and try again.',
      isError: true,
    });
  });

  test('falls back to a generic error text', () => {
    expect(build({ syncStatus: freshStatus({ status: 'error' }) }).statusText).toBe('Sync failed');
  });

  test('uses the synced race once a sync completes or is cancelled', () => {
    const raceSummary = { riderCount: 46, syncInProgress: false };
    expect(build({ syncStatus: freshStatus({ status: 'complete' }), raceSummary }).kind).toBe('synced');
    expect(build({ syncStatus: freshStatus({ status: 'cancelled' }), raceSummary }).kind).toBe('synced');
    expect(build({ syncStatus: freshStatus({ status: 'cancelled' }) }).kind).toBe('idle');
  });

  test('ignores a sync of another category', () => {
    const syncStatus = freshStatus({ status: 'syncing', current: 1, total: 10, raceKey: '123_B' });
    expect(build({ syncStatus }).kind).toBe('idle');
    expect(build({ syncStatus, raceSummary: { riderCount: 3, syncInProgress: false } }).kind).toBe('synced');
  });

  test('ignores a stale sync status', () => {
    const updatedAt = new Date(now - maxAgeMs - 1).toISOString();
    expect(build({ syncStatus: freshStatus({ status: 'syncing', current: 1, total: 10, updatedAt }) }).kind).toBe('idle');
    expect(build({ syncStatus: freshStatus({ status: 'error', error: 'Boom', updatedAt }) }).kind).toBe('idle');
  });
});

describe('classifyAnalysisResponse', () => {
  const apiUrl = 'https://zwiftpower.com/api3.php?do=analysis&zwift_id=1&zwift_event_id=2';
  const analysisJson = JSON.stringify({ xData: [0, 0.1, 0.2], x2Data: [0, 1, 2] });
  const loginPage = '<!DOCTYPE html><html><head><title>Login</title></head><body></body></html>';
  const classify = fields => classifyAnalysisResponse({ status: 200, url: apiUrl, ...fields });

  test('accepts JSON with distance data', () => {
    expect(classify({ contentType: 'application/json', bodyText: analysisJson })).toBe('ok');
  });

  test('accepts JSON served with an HTML content type', () => {
    expect(classify({ contentType: 'text/html; charset=UTF-8', bodyText: analysisJson })).toBe('ok');
  });

  test('flags unauthorized and forbidden statuses as auth', () => {
    expect(classify({ status: 401 })).toBe('auth');
    expect(classify({ status: 403 })).toBe('auth');
  });

  test('flags a redirect to a login page as auth', () => {
    expect(classify({ url: 'https://zwiftpower.com/ucp.php?mode=login', bodyText: loginPage })).toBe('auth');
    expect(classify({ url: 'https://secure.zwift.com/auth/realms/zwift/protocol/openid-connect/auth' })).toBe('auth');
  });

  test('flags an HTML document body as auth', () => {
    expect(classify({ contentType: 'text/html', bodyText: loginPage })).toBe('auth');
    expect(classify({ contentType: '', bodyText: `\n  ${loginPage}` })).toBe('auth');
    expect(classify({ contentType: 'text/html', bodyText: '<div>Please log in</div>' })).toBe('auth');
  });

  test('flags 429 as rate limited', () => {
    expect(classify({ status: 429 })).toBe('rate-limited');
  });

  test('flags 5xx statuses as server errors', () => {
    expect(classify({ status: 500 })).toBe('server-error');
    expect(classify({ status: 503 })).toBe('server-error');
  });

  test('treats an empty body as empty', () => {
    expect(classify({ bodyText: '' })).toBe('empty');
    expect(classify({ bodyText: '   \n' })).toBe('empty');
    expect(classifyAnalysisResponse({ status: 200 })).toBe('empty');
  });

  test('treats JSON without distance data as empty', () => {
    expect(classify({ bodyText: '{}' })).toBe('empty');
    expect(classify({ bodyText: '{"xData":[]}' })).toBe('empty');
    expect(classify({ bodyText: 'null' })).toBe('empty');
    expect(classify({ bodyText: '{"xData":"1,2"}' })).toBe('empty');
  });

  test('treats a non JSON, non HTML body as invalid', () => {
    expect(classify({ contentType: 'text/plain', bodyText: 'Something went wrong' })).toBe('invalid');
    expect(classify({ contentType: 'text/html', bodyText: 'Something went wrong' })).toBe('invalid');
  });

  test('treats other non success statuses as invalid', () => {
    expect(classify({ status: 404 })).toBe('invalid');
    expect(classify({ status: 0 })).toBe('invalid');
  });
});

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('runs once with the latest arguments after the delay', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 300);

    debounced('a');
    jest.advanceTimersByTime(200);
    debounced('b');
    jest.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  test('runs again for calls after the delay has passed', () => {
    const fn = jest.fn();
    const debounced = debounce(fn, 300);

    debounced(1);
    jest.advanceTimersByTime(300);
    debounced(2);
    jest.advanceTimersByTime(300);

    expect(fn.mock.calls).toEqual([[1], [2]]);
  });
});

describe('throttle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('runs the first call immediately', () => {
    const fn = jest.fn();
    throttle(fn, 100)('first');
    expect(fn).toHaveBeenCalledWith('first');
  });

  test('runs at most once per interval and ends with the latest arguments', () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    jest.advanceTimersByTime(50);
    throttled(3);
    expect(fn.mock.calls).toEqual([[1]]);

    jest.advanceTimersByTime(50);
    expect(fn.mock.calls).toEqual([[1], [3]]);

    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('runs immediately again once the interval has passed', () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    jest.advanceTimersByTime(150);
    throttled(2);

    expect(fn.mock.calls).toEqual([[1], [2]]);
  });

  test('flush runs a pending call right away and drops its timer', () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled(1);
    throttled(2);
    throttled.flush();
    expect(fn.mock.calls).toEqual([[1], [2]]);

    jest.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test('flush does nothing without a pending call', () => {
    const fn = jest.fn();
    const throttled = throttle(fn, 100);

    throttled.flush();
    expect(fn).not.toHaveBeenCalled();

    throttled(1);
    throttled.flush();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveShortcut', () => {
  const body = { tagName: 'BODY' };
  const press = (key, extra = {}) => resolveShortcut({ key, target: body, ...extra });

  test('space toggles play', () => {
    expect(press(' ')).toEqual({ type: 'togglePlay' });
  });

  test('arrows step through time and shift makes the step larger', () => {
    expect(press('ArrowLeft')).toEqual({ type: 'seekBy', seconds: -SEEK_STEP_SECONDS });
    expect(press('ArrowRight')).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
    expect(press('ArrowLeft', { shiftKey: true })).toEqual({ type: 'seekBy', seconds: -SEEK_SHIFT_STEP_SECONDS });
    expect(press('ArrowRight', { shiftKey: true })).toEqual({ type: 'seekBy', seconds: SEEK_SHIFT_STEP_SECONDS });
  });

  test('comma and period step one second, ten with shift, and pause playback', () => {
    expect(press(',')).toEqual({ type: 'stepBy', seconds: -FRAME_STEP_SECONDS });
    expect(press('.')).toEqual({ type: 'stepBy', seconds: FRAME_STEP_SECONDS });
    expect(press('<', { shiftKey: true })).toEqual({ type: 'stepBy', seconds: -FRAME_SHIFT_STEP_SECONDS });
    expect(press('>', { shiftKey: true })).toEqual({ type: 'stepBy', seconds: FRAME_SHIFT_STEP_SECONDS });
    expect(press('.', { repeat: true })).toEqual({ type: 'stepBy', seconds: FRAME_STEP_SECONDS });
  });

  test('returns null for keys without a shortcut', () => {
    expect(press('a')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('Tab')).toBeNull();
  });

  test('ignores keys pressed with ctrl, meta or alt', () => {
    expect(press(' ', { metaKey: true })).toBeNull();
    expect(press(' ', { ctrlKey: true })).toBeNull();
    expect(press('ArrowLeft', { altKey: true })).toBeNull();
  });

  test('ignores shortcuts while typing in text inputs, selects, text areas and editable content', () => {
    expect(press(' ', { target: { tagName: 'INPUT', type: 'text' } })).toBeNull();
    expect(press('ArrowLeft', { target: { tagName: 'INPUT', type: 'search' } })).toBeNull();
    expect(press('ArrowRight', { target: { tagName: 'SELECT' } })).toBeNull();
    expect(press(' ', { target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(press(' ', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
  });

  test('keeps shortcuts on non text inputs such as the scrubber', () => {
    expect(press(' ', { target: { tagName: 'INPUT', type: 'range' } })).toEqual({ type: 'togglePlay' });
    expect(press('ArrowRight', { target: { tagName: 'INPUT', type: 'range' } })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
  });

  test('leaves space to focused buttons and links so they keep native activation', () => {
    expect(press(' ', { target: { tagName: 'BUTTON' } })).toBeNull();
    expect(press(' ', { target: { tagName: 'A' } })).toBeNull();
    expect(press('ArrowRight', { target: { tagName: 'BUTTON' } })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
  });

  test('allows key repeat only for seeking', () => {
    expect(press('ArrowRight', { repeat: true })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
    expect(press(' ', { repeat: true })).toBeNull();
    expect(press('r', { repeat: true })).toBeNull();
  });

  test('works without a target', () => {
    expect(resolveShortcut({ key: ' ' })).toEqual({ type: 'togglePlay' });
  });
});

describe('computeRaceStandings', () => {
  const riders = [
    { position: 1, distance: [0, 1, 2, 3], power: [200, 300, 400, 500] },
    { position: 2, distance: [0, 1.5, 2.5, 3, 3], power: [250, 350, 450, 300, 0] },
    { position: 3, distance: [0, 0.5, 1, 1.5, 2, 2.5], power: [150, 160, 170, 180, 190, 200] },
  ];

  test('orders riders by distance and reads current power', () => {
    const standings = computeRaceStandings(riders, 1);
    expect(standings.map(s => s.position)).toEqual([2, 1, 3]);
    expect(standings[0]).toMatchObject({ currentDistance: 1.5, currentPower: 350, finished: false });
  });

  test('keeps finished riders at their last distance, ordered by finish time', () => {
    const standings = computeRaceStandings(riders, 4);
    expect(standings.map(s => s.position)).toEqual([1, 2, 3]);
    expect(standings[0]).toMatchObject({ currentDistance: 3, currentPower: 0, finished: true, finishTime: 3 });
    expect(standings[1]).toMatchObject({ finished: true, finishTime: 4 });
    expect(standings[2]).toMatchObject({ currentDistance: 2, finished: false });
  });

  test('scales time by the sample interval', () => {
    const standings = computeRaceStandings(riders, 2, 2);
    expect(standings.find(s => s.position === 3).currentDistance).toBe(0.5);
  });
});

describe('computeRaceStandings with official finish times', () => {
  const early = { position: 2, zwiftId: 'early', finishTime: 10.4, distance: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], power: Array(13).fill(300) };
  const winner = { position: 1, zwiftId: 'winner', finishTime: 10.2, distance: [0, 1, 2, 3, 4, 5, 6, 7, 8], power: Array(9).fill(300) };

  test('finishes a rider at the official time even when the series is shorter or longer', () => {
    const standings = computeRaceStandings([early, winner], 10.3);
    expect(standings.map(s => s.position)).toEqual([1, 2]);
    expect(standings[0]).toMatchObject({ finished: true, finishTime: 10.2, currentPower: 0 });
    expect(standings[1]).toMatchObject({ finished: false, currentDistance: 10 });
  });

  test('orders finished riders by official time and keeps the official gap', () => {
    const standings = computeRaceStandings([early, winner], 20);
    expect(standings.map(s => s.position)).toEqual([1, 2]);
    expect(calcStandingGap(standings[0], standings[1], 20)).toBe(0);
    expect(calcStandingGap({ finished: true, finishTime: 2353.4 }, { finished: true, finishTime: 2355.1 }, 2400)).toBe(2);
  });
});

describe('normalizeRiders', () => {
  const rider = { zwiftId: 'a', finishTime: 4, distance: [0.1, 1.1, 2.1, 3.1, 4.1, 5.1] };

  test('scales each rider so the official finish lands on the course length', () => {
    const [scaled] = normalizeRiders([rider], 2);
    expect(scaled.distance.map(km => +km.toFixed(3))).toEqual([0, 0.5, 1, 1.5, 2, 2.5]);
    expect(scaled.finishDistance).toBe(2);
    expect(rider.distance[0]).toBe(0.1);
  });

  test('extrapolates when the series stops before the official finish', () => {
    const short = { zwiftId: 'b', finishTime: 6, distance: [0, 1, 2, 3] };
    const [scaled] = normalizeRiders([short], 12);
    expect(scaled.distance).toEqual([0, 2, 4, 6]);
  });

  test('leaves riders alone without a finish time or a course length', () => {
    expect(normalizeRiders([{ distance: [0, 1] }], 2)[0]).toEqual({ distance: [0, 1] });
    expect(normalizeRiders([rider], null)[0]).toBe(rider);
  });
});

describe('raceDuration', () => {
  test('runs until the last official finish or the end of the longest series', () => {
    expect(raceDuration([{ distance: [0, 1, 2], finishTime: 5 }, { distance: Array(8).fill(0) }])).toBe(7);
    expect(raceDuration([{ distance: [0, 1, 2], finishTime: 9 }])).toBe(9);
    expect(raceDuration([])).toBe(0);
  });
});

describe('calcStandingGap', () => {
  test('uses finish times when both riders finished', () => {
    const ahead = { finished: true, finishTime: 3600 };
    const behind = { finished: true, finishTime: 3614.4 };
    expect(calcStandingGap(ahead, behind, 4000)).toBe(14);
  });

  test('estimates the gap from distance while racing', () => {
    const ahead = { finished: false, currentDistance: 10.1 };
    const behind = { finished: false, currentDistance: 10 };
    expect(calcStandingGap(ahead, behind, 10)).toBe(Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600));
  });
});

describe('calcGapToGroupAhead', () => {
  const lead = { position: 1, finished: false, currentDistance: 10.2 };
  const tail = { position: 2, finished: false, currentDistance: 10.1 };
  const you = { position: 3, finished: false, currentDistance: 10 };
  const groups = [
    { riders: [lead, tail], hasYou: false },
    { riders: [you], hasYou: true },
  ];

  test('measures the gap to the last rider of the group ahead', () => {
    expect(calcGapToGroupAhead(groups, 1, you, 60)).toBe(Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600));
  });

  test('returns 0 in the lead group, without a group or without a watched rider', () => {
    expect(calcGapToGroupAhead([{ riders: [lead, you], hasYou: true }], 0, you, 60)).toBe(0);
    expect(calcGapToGroupAhead(groups, -1, you, 60)).toBe(0);
    expect(calcGapToGroupAhead(groups, 1, undefined, 60)).toBe(0);
  });
});

describe('advancePlaybackTime', () => {
  test('advances by elapsed time scaled by speed', () => {
    expect(advancePlaybackTime(100, 500, 10, 3600)).toBe(105);
    expect(advancePlaybackTime(0, 1000, 1, 3600)).toBe(1);
  });

  test('stops at the end of the race', () => {
    expect(advancePlaybackTime(3599, 1000, 30, 3600)).toBe(3600);
  });
});

describe('resolveWatchedRider', () => {
  const riders = [
    { position: 1, zwiftId: '11' },
    { position: 7, zwiftId: '17', isCurrentUser: true },
    { position: 3, zwiftId: '13' },
  ];

  test('keeps the selected rider', () => {
    expect(resolveWatchedRider(riders, '13').zwiftId).toBe('13');
  });

  test('falls back to the current user, then the best placed rider', () => {
    expect(resolveWatchedRider(riders, '99').zwiftId).toBe('17');
    expect(resolveWatchedRider([{ position: 4, zwiftId: '14' }, { position: 2, zwiftId: '12' }]).zwiftId).toBe('12');
    expect(resolveWatchedRider([])).toBeNull();
  });
});

describe('buildWatchOptions', () => {
  test('lists riders by position and marks the current user', () => {
    const riders = [
      { position: 7, zwiftId: '17', name: 'Vitalii E', isCurrentUser: true },
      { position: 1, zwiftId: '11', name: 'Anna Lee' },
      { position: 3, zwiftId: '13', name: 'Martin Rank' },
    ];
    expect(buildWatchOptions(riders)).toEqual([
      { value: '11', position: 1, label: '#1 Anna Lee' },
      { value: '13', position: 3, label: '#3 Martin Rank' },
      { value: '17', position: 7, label: '#7 Vitalii E (you)' },
    ]);
  });
});

describe('shortRiderName', () => {
  test('returns the first word of the name', () => {
    expect(shortRiderName('Martin Rank')).toBe('Martin');
    expect(shortRiderName('  Anna   Lee ')).toBe('Anna');
    expect(shortRiderName('Solo')).toBe('Solo');
    expect(shortRiderName(undefined)).toBe('');
  });
});

describe('buildRiderStatsText', () => {
  const martin = { name: 'Martin' };

  test.each([
    [{ rank: 12, power: 287, gapToLeader: 14, gapToGroup: 3 }, '12th · 287 W · +14s to leader · +3s to group'],
    [{ rank: 20, power: 250, gapToLeader: 75 }, '20th · 250 W · +1:15 to leader'],
    [{ rank: 1, power: 310, gapToLeader: 0, gapToGroup: 0, behind: { name: 'Lee', seconds: 2 } }, '1st · 310 W · 2s ahead of Lee'],
    [{ rank: 2, power: 300, gapToLeader: 4, ahead: { name: 'Smith', seconds: 4 }, behind: { name: 'Lee', seconds: 0 } }, '2nd · 300 W · +4s to leader · 4s behind Smith'],
    [{ rank: 5, power: 280, gapToLeader: 14, watchedGap: { ...martin, seconds: 3, ahead: true } }, '5th · 280 W · +14s to leader · 3s ahead of Martin'],
    [{ rank: 9, power: 0, watchedGap: { ...martin, seconds: 65, ahead: false } }, '9th · 0 W · 1:05 behind Martin'],
    [{ rank: 5, power: 280, watchedGap: { ...martin, seconds: 0, ahead: true } }, '5th · 280 W'],
    [{}, ''],
  ])('builds %j', (stats, expected) => {
    expect(buildRiderStatsText(stats)).toBe(expected);
  });
});

describe('nearestRiderGaps', () => {
  const standing = (name, km) => ({ rider: { name, zwiftId: name }, finished: false, currentDistance: km });
  const standings = [standing('Ann Lead', 10.2), standing('Bob You', 10.1), standing('Cid Back', 10)];
  const nineSeconds = Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600);

  test('names the riders right in front of and behind the watched rider', () => {
    expect(nearestRiderGaps(standings, 1, 60)).toEqual({
      ahead: { name: 'Ann', seconds: nineSeconds },
      behind: { name: 'Cid', seconds: nineSeconds },
    });
  });

  test('leaves out the side that has nobody', () => {
    expect(nearestRiderGaps(standings, 0, 60).ahead).toBeUndefined();
    expect(nearestRiderGaps(standings, 2, 60).behind).toBeUndefined();
    expect(nearestRiderGaps(standings, -1, 60)).toEqual({});
  });
});

describe('buildGroupStrip', () => {
  const standing = (name, km) => ({ rider: { name, zwiftId: name.toLowerCase() }, finished: false, currentDistance: km });
  const group = (idx, avgPower, ...riders) => ({ idx, name: idx === 0 ? 'Lead group' : `Group ${idx + 1}`, avgPower, riders });
  const groups = [
    group(0, 372, standing('Ann', 20), standing('Bea', 19.99)),
    group(1, 340, standing('Cid', 19.5)),
    group(2, 368, standing('Dan', 19), standing('Eve', 18.99), standing('Fay', 18.98)),
    group(3, 300, standing('Gus', 18.5)),
    group(4, 290, standing('Hal', 18)),
    group(5, 280, standing('Ivy', 17.5)),
  ];
  const gap = km => Math.round((km / DEFAULT_SPEED_KMH) * 3600);

  test('shows the lead group, the groups around you and folds the rest', () => {
    expect(buildGroupStrip(groups, 2, 60)).toEqual([
      { type: 'group', index: 0, gap: 0, isYou: false, label: 'Lead group · 2 riders · 372 W', zwiftId: 'ann' },
      { type: 'group', index: 1, gap: gap(0.49), isYou: false, label: 'Cid · 340 W', zwiftId: 'cid' },
      { type: 'group', index: 2, gap: gap(0.5), isYou: true, label: 'Group 3 · 3 riders (you) · 368 W', zwiftId: 'dan' },
      { type: 'group', index: 3, gap: gap(0.48), isYou: false, label: 'Gus · 300 W', zwiftId: 'gus' },
      { type: 'fold', label: '+2 solo', gap: gap(0.5) },
    ]);
  });

  test('folds groups between the lead group and yours', () => {
    const items = buildGroupStrip(groups, 5, 60);
    expect(items.map(item => item.label)).toEqual([
      'Lead group · 2 riders · 372 W', '+3 groups · 5 riders', 'Hal · 290 W', 'Ivy (you) · 280 W',
    ]);
    expect(items[1].gap).toBe(gap(0.49));
  });

  test('shows the first four groups when nobody is watched', () => {
    expect(buildGroupStrip(groups, -1, 60).map(item => item.type)).toEqual(['group', 'group', 'group', 'group', 'fold']);
    expect(buildGroupStrip([], -1, 60)).toEqual([]);
  });
});

describe('assignDotLanes', () => {
  test('moves dots that would overlap to the next lane', () => {
    expect(assignDotLanes([100, 95, 50, 92, 40], 10, 3)).toEqual([0, 1, 0, 2, 0]);
  });

  test('reuses the lane with the most room once all lanes are taken', () => {
    expect(assignDotLanes([10, 9, 8, 7, 6], 5, 3)).toEqual([0, 1, 2, 0, 1]);
    expect(assignDotLanes([], 5, 3)).toEqual([]);
  });

  test('keeps pinned dots on the bottom lane and moves the others around them', () => {
    expect(assignDotLanes([100, 95, 92], 10, 3, [2])).toEqual([1, 2, 0]);
    expect(assignDotLanes([100, 95, 92], 10, 3, [1])).toEqual([1, 0, 2]);
  });
});

describe('formatOrdinal', () => {
  test.each([[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [111, '111th']])('%i -> %s', (rank, expected) => {
    expect(formatOrdinal(rank)).toBe(expected);
  });
});
