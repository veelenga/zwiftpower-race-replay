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
  selectRidersToSync,
  isValidPosition,
  lerp,
  clamp,
  calcGroupAveragePower,
  calcGroupAverageHR,
  filterRidersByName,
  highlightMatch,
  escapeHtml,
  isValidEventId,
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
  parseJsonOrUndefined,
  debounce,
  throttle,
  sampleChartWindow,
  resolveShortcut,
  stepSpeed,
  resolveCourseKm,
  buildCurveLookup,
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
  resolveWatchedRider,
  buildWatchOptions,
  shortRiderName,
  riderMarkerRole,
  isSameSyncedRace,
  buildRiderStatsText,
  DEFAULT_SPEED_KMH,
  SEEK_STEP_SECONDS,
  SEEK_SHIFT_STEP_SECONDS,
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
    // Need much bigger gap to exceed GROUP_GAP_THRESHOLD_SECONDS (5s)
    // At MIN_SPEED_KMH (10 km/h), 5s gap = ~0.014 km
    // So gaps need to be larger than that
    const standings = [
      { position: 1, currentDistance: 10.0, currentPower: 300, distance: [] },
      { position: 2, currentDistance: 9.99, currentPower: 280, distance: [] },
      { position: 3, currentDistance: 9.5, currentPower: 270, distance: [] }, // ~180s gap at 10 km/h
    ];
    const groups = detectGroups(standings, 60, 1);
    expect(groups.length).toBe(2);
    expect(groups[0].riders.length).toBe(2);
    expect(groups[1].riders.length).toBe(1);
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

describe('isValidPosition', () => {
  test('returns true for valid positions', () => {
    expect(isValidPosition(1)).toBe(true);
    expect(isValidPosition(100)).toBe(true);
    expect(isValidPosition(200)).toBe(true);
  });

  test('returns falsy for invalid positions', () => {
    expect(isValidPosition(0)).toBeFalsy();
    expect(isValidPosition(-1)).toBeFalsy();
    expect(isValidPosition(201)).toBeFalsy();
    expect(isValidPosition(null)).toBeFalsy();
    expect(isValidPosition(undefined)).toBeFalsy();
  });
});

describe('lerp', () => {
  test('interpolates between values', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(0, 10, 1)).toBe(10);
  });

  test('works with negative values', () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
    expect(lerp(10, -10, 0.5)).toBe(0);
  });

  test('extrapolates beyond 0-1 range', () => {
    expect(lerp(0, 10, 2)).toBe(20);
    expect(lerp(0, 10, -1)).toBe(-10);
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

describe('calcGroupAveragePower', () => {
  test('returns empty array for empty or null input', () => {
    expect(calcGroupAveragePower([])).toEqual([]);
    expect(calcGroupAveragePower(null)).toEqual([]);
  });

  test('calculates average power at each time index', () => {
    const riders = [
      { power: [100, 200, 300] },
      { power: [200, 300, 400] },
    ];
    expect(calcGroupAveragePower(riders)).toEqual([150, 250, 350]);
  });

  test('handles different length power arrays', () => {
    const riders = [
      { power: [100, 200] },
      { power: [200, 300, 400] },
    ];
    // At index 2, first rider has no data (0), second has 400
    expect(calcGroupAveragePower(riders)).toEqual([150, 250, 200]);
  });

  test('handles missing power arrays', () => {
    const riders = [
      { power: [100, 200] },
      { name: 'No power data' },
    ];
    expect(calcGroupAveragePower(riders)).toEqual([50, 100]);
  });
});

describe('calcGroupAverageHR', () => {
  test('returns 0 for empty or null input', () => {
    expect(calcGroupAverageHR([], 0)).toBe(0);
    expect(calcGroupAverageHR(null, 0)).toBe(0);
  });

  test('calculates average heart rate at specific index', () => {
    const riders = [
      { heartRate: [140, 150, 160] },
      { heartRate: [160, 170, 180] },
    ];
    expect(calcGroupAverageHR(riders, 0)).toBe(150);
    expect(calcGroupAverageHR(riders, 1)).toBe(160);
    expect(calcGroupAverageHR(riders, 2)).toBe(170);
  });

  test('filters out zero values', () => {
    const riders = [
      { heartRate: [0, 150, 160] },
      { heartRate: [160, 170, 0] },
    ];
    // At index 0, only second rider has valid HR
    expect(calcGroupAverageHR(riders, 0)).toBe(160);
    // At index 2, only first rider has valid HR
    expect(calcGroupAverageHR(riders, 2)).toBe(160);
  });

  test('returns 0 when no valid HR data', () => {
    const riders = [
      { heartRate: [0, 0, 0] },
      { heartRate: [0, 0, 0] },
    ];
    expect(calcGroupAverageHR(riders, 0)).toBe(0);
  });

  test('handles missing heartRate arrays', () => {
    const riders = [
      { heartRate: [140, 150] },
      { name: 'No HR data' },
    ];
    expect(calcGroupAverageHR(riders, 0)).toBe(140);
  });
});

describe('filterRidersByName', () => {
  const riders = [
    { name: 'John Smith' },
    { name: 'Jane Doe' },
    { name: 'Bob Johnson' },
  ];

  test('returns all riders for empty search', () => {
    expect(filterRidersByName(riders, '')).toEqual(riders);
    expect(filterRidersByName(riders, null)).toEqual(riders);
    expect(filterRidersByName(riders, '   ')).toEqual(riders);
  });

  test('filters by partial name match', () => {
    const result = filterRidersByName(riders, 'john');
    expect(result.length).toBe(2);
    expect(result.map(r => r.name)).toEqual(['John Smith', 'Bob Johnson']);
  });

  test('is case insensitive', () => {
    expect(filterRidersByName(riders, 'JANE').length).toBe(1);
    expect(filterRidersByName(riders, 'jane').length).toBe(1);
    expect(filterRidersByName(riders, 'JaNe').length).toBe(1);
  });

  test('returns empty array for no matches', () => {
    expect(filterRidersByName(riders, 'xyz')).toEqual([]);
  });

  test('handles null/undefined riders array', () => {
    expect(filterRidersByName(null, 'john')).toEqual([]);
    expect(filterRidersByName(undefined, 'john')).toEqual([]);
  });
});

describe('highlightMatch', () => {
  test('returns original name for empty search', () => {
    expect(highlightMatch('John Smith', '')).toBe('John Smith');
    expect(highlightMatch('John Smith', null)).toBe('John Smith');
    expect(highlightMatch('John Smith', '   ')).toBe('John Smith');
  });

  test('wraps match in mark tags', () => {
    const result = highlightMatch('John Smith', 'Smith');
    expect(result).toContain('<mark');
    expect(result).toContain('Smith');
    expect(result).toContain('</mark>');
  });

  test('is case insensitive but preserves original case', () => {
    const result = highlightMatch('John Smith', 'smith');
    expect(result).toContain('Smith'); // Original case preserved
    expect(result).toContain('John ');
  });

  test('highlights first occurrence', () => {
    const result = highlightMatch('John John', 'John');
    // Should highlight first John, not second
    expect(result.indexOf('<mark')).toBe(0);
  });

  test('returns original if no match', () => {
    expect(highlightMatch('John Smith', 'xyz')).toBe('John Smith');
  });

  test('handles null/undefined name', () => {
    expect(highlightMatch(null, 'test')).toBe('');
    expect(highlightMatch(undefined, 'test')).toBe('');
  });

  test('produces exact markup around the match', () => {
    expect(highlightMatch('John Smith', 'smi')).toBe(
      'John <mark style="background:#58a6ff33;color:#58a6ff;">Smi</mark>th'
    );
  });

  test('uses trimmed search length for the highlighted slice', () => {
    expect(highlightMatch('John Smith', ' smi ')).toBe(
      'John <mark style="background:#58a6ff33;color:#58a6ff;">Smi</mark>th'
    );
  });

  test('escapes name without a search term', () => {
    expect(highlightMatch('<b>Bob</b>', '')).toBe('&lt;b&gt;Bob&lt;/b&gt;');
  });

  test('escapes name when there is no match', () => {
    expect(highlightMatch('<img src=x onerror=alert(1)>', 'zzz')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    );
  });

  test('escapes text around and inside the mark', () => {
    expect(highlightMatch('<i>Tom & "Jerry"</i>', '& "j')).toBe(
      '&lt;i&gt;Tom <mark style="background:#58a6ff33;color:#58a6ff;">&amp; &quot;J</mark>erry&quot;&lt;/i&gt;'
    );
  });

  test('matches on raw text rather than escaped entities', () => {
    expect(highlightMatch('A&B', 'amp')).toBe('A&amp;B');
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

describe('findClosestIndex', () => {
  test('returns -1 for empty array', () => {
    expect(findClosestIndex([], 5)).toBe(-1);
    expect(findClosestIndex(null, 5)).toBe(-1);
    expect(findClosestIndex(undefined, 5)).toBe(-1);
  });

  test('returns 0 for single element array', () => {
    expect(findClosestIndex([10], 5)).toBe(0);
    expect(findClosestIndex([10], 15)).toBe(0);
  });

  test('finds exact match', () => {
    expect(findClosestIndex([1, 2, 3, 4, 5], 3)).toBe(2);
    expect(findClosestIndex([0, 10, 20, 30], 20)).toBe(2);
  });

  test('finds closest when target is between values', () => {
    expect(findClosestIndex([0, 10, 20, 30], 12)).toBe(1); // closer to 10
    expect(findClosestIndex([0, 10, 20, 30], 18)).toBe(2); // closer to 20
    expect(findClosestIndex([0, 10, 20, 30], 15)).toBe(1); // equidistant, prefer lower
  });

  test('handles target below range', () => {
    expect(findClosestIndex([10, 20, 30], 5)).toBe(0);
    expect(findClosestIndex([10, 20, 30], -100)).toBe(0);
  });

  test('handles target above range', () => {
    expect(findClosestIndex([10, 20, 30], 35)).toBe(2);
    expect(findClosestIndex([10, 20, 30], 1000)).toBe(2);
  });

  test('works with decimal values', () => {
    expect(findClosestIndex([0.5, 1.5, 2.5, 3.5], 2.0)).toBe(1); // closer to 1.5
    expect(findClosestIndex([0.5, 1.5, 2.5, 3.5], 2.3)).toBe(2); // closer to 2.5
  });
});

describe('getValueAtDistance', () => {
  test('returns 0 for empty arrays', () => {
    expect(getValueAtDistance([], [], 5)).toBe(0);
    expect(getValueAtDistance(null, [1, 2, 3], 5)).toBe(0);
    expect(getValueAtDistance([1, 2, 3], null, 5)).toBe(0);
  });

  test('returns value at exact distance', () => {
    const distances = [0, 10, 20, 30];
    const elevations = [100, 150, 200, 180];
    expect(getValueAtDistance(distances, elevations, 10)).toBe(150);
    expect(getValueAtDistance(distances, elevations, 20)).toBe(200);
  });

  test('returns value at closest distance', () => {
    const distances = [0, 10, 20, 30];
    const elevations = [100, 150, 200, 180];
    expect(getValueAtDistance(distances, elevations, 12)).toBe(150); // closer to 10
    expect(getValueAtDistance(distances, elevations, 18)).toBe(200); // closer to 20
  });

  test('handles target outside range', () => {
    const distances = [10, 20, 30];
    const elevations = [100, 200, 300];
    expect(getValueAtDistance(distances, elevations, 5)).toBe(100);  // below range
    expect(getValueAtDistance(distances, elevations, 50)).toBe(300); // above range
  });

  test('returns 0 for falsy values in data array', () => {
    const distances = [0, 10, 20];
    const elevations = [100, 0, 200];
    expect(getValueAtDistance(distances, elevations, 10)).toBe(0);
  });

  test('simulates real elevation lookup scenario', () => {
    // Simulating a rider going faster downhill (more distance per sample)
    const distances = [0, 0.5, 1.0, 1.8, 2.8, 4.0, 5.5]; // irregular spacing
    const elevations = [100, 120, 150, 140, 110, 80, 60]; // elevation profile

    // At distance 1.5km: |1.5-1.0|=0.5, |1.5-1.8|=0.3, so 1.8km (idx 3) is closer
    expect(getValueAtDistance(distances, elevations, 1.5)).toBe(140);

    // At distance 3.0km: |3.0-2.8|=0.2, |3.0-4.0|=1.0, so 2.8km (idx 4) is closer
    expect(getValueAtDistance(distances, elevations, 3.0)).toBe(110);
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

describe('parseJsonOrUndefined', () => {
  test('parses valid JSON and returns undefined otherwise', () => {
    expect(parseJsonOrUndefined('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonOrUndefined('not json')).toBeUndefined();
    expect(parseJsonOrUndefined(null)).toBeNull();
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

describe('sampleChartWindow', () => {
  const rider = {
    power: [100, 110, 120, 130, 140, 150],
    heartRate: [90, 0, 120, 130, 140, 150],
  };

  test('samples power, heart rate and time labels from the window start to the current time', () => {
    const { labels, series } = sampleChartWindow([rider], 4, { windowSeconds: 10, stepSeconds: 2 });

    expect(labels).toEqual(['0:00', '0:02', '0:04']);
    expect(series).toEqual([{ power: [100, 120, 140], heartRate: [90, 120, 140] }]);
  });

  test('starts the window at time minus window size', () => {
    const { labels, series } = sampleChartWindow([rider], 5, { windowSeconds: 2, stepSeconds: 1 });

    expect(labels).toEqual(['0:03', '0:04', '0:05']);
    expect(series[0].power).toEqual([130, 140, 150]);
  });

  test('maps time to data index using the sample interval', () => {
    const { labels, series } = sampleChartWindow([rider], 10, { windowSeconds: 10, stepSeconds: 5, sampleInterval: 5 });

    expect(labels).toEqual(['0:00', '0:05', '0:10']);
    expect(series[0].power).toEqual([100, 110, 120]);
  });

  test('uses zero for missing power and null for missing heart rate', () => {
    const { series } = sampleChartWindow([rider, {}], 1, { windowSeconds: 10, stepSeconds: 1 });

    expect(series[0].heartRate).toEqual([90, null]);
    expect(series[1]).toEqual({ power: [0, 0], heartRate: [null, null] });
  });

  test('returns one series per rider', () => {
    const { series } = sampleChartWindow([rider, rider, rider], 0, { windowSeconds: 10, stepSeconds: 1 });

    expect(series).toHaveLength(3);
  });

  test('returns empty data without riders', () => {
    const { labels, series } = sampleChartWindow([], 2, { windowSeconds: 10, stepSeconds: 1 });

    expect(labels).toEqual(['0:00', '0:01', '0:02']);
    expect(series).toEqual([]);
  });

  test('returns empty data for a non positive step', () => {
    expect(sampleChartWindow([rider], 5, { windowSeconds: 10, stepSeconds: 0 })).toEqual({
      labels: [],
      series: [{ power: [], heartRate: [] }],
    });
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

  test('up and down arrows change speed', () => {
    expect(press('ArrowUp')).toEqual({ type: 'changeSpeed', step: 1 });
    expect(press('ArrowDown')).toEqual({ type: 'changeSpeed', step: -1 });
  });

  test('digits jump to a tenth of the race', () => {
    expect(press('0')).toEqual({ type: 'seekFraction', fraction: 0 });
    expect(press('5')).toEqual({ type: 'seekFraction', fraction: 0.5 });
    expect(press('9')).toEqual({ type: 'seekFraction', fraction: 0.9 });
  });

  test('maps r, slash and question mark', () => {
    expect(press('r')).toEqual({ type: 'resetZoom' });
    expect(press('R', { shiftKey: true })).toEqual({ type: 'resetZoom' });
    expect(press('/')).toEqual({ type: 'focusSearch' });
    expect(press('?', { shiftKey: true })).toEqual({ type: 'toggleHelp' });
  });

  test('returns null for keys without a shortcut', () => {
    expect(press('a')).toBeNull();
    expect(press('Enter')).toBeNull();
    expect(press('Tab')).toBeNull();
  });

  test('ignores keys pressed with ctrl, meta or alt', () => {
    expect(press('r', { metaKey: true })).toBeNull();
    expect(press('r', { ctrlKey: true })).toBeNull();
    expect(press('1', { altKey: true })).toBeNull();
  });

  test('ignores shortcuts while typing in text inputs, selects, text areas and editable content', () => {
    expect(press(' ', { target: { tagName: 'INPUT', type: 'text' } })).toBeNull();
    expect(press('r', { target: { tagName: 'INPUT', type: 'search' } })).toBeNull();
    expect(press('ArrowDown', { target: { tagName: 'SELECT' } })).toBeNull();
    expect(press('1', { target: { tagName: 'TEXTAREA' } })).toBeNull();
    expect(press('/', { target: { tagName: 'DIV', isContentEditable: true } })).toBeNull();
  });

  test('keeps shortcuts on non text inputs such as the scrubber', () => {
    expect(press(' ', { target: { tagName: 'INPUT', type: 'range' } })).toEqual({ type: 'togglePlay' });
    expect(press('ArrowRight', { target: { tagName: 'INPUT', type: 'range' } })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
  });

  test('escape works everywhere, including while typing', () => {
    expect(press('Escape')).toEqual({ type: 'escape' });
    expect(press('Escape', { target: { tagName: 'INPUT', type: 'text' } })).toEqual({ type: 'escape' });
    expect(press('Escape', { target: { tagName: 'SELECT' } })).toEqual({ type: 'escape' });
  });

  test('leaves space to focused buttons and links so they keep native activation', () => {
    expect(press(' ', { target: { tagName: 'BUTTON' } })).toBeNull();
    expect(press(' ', { target: { tagName: 'A' } })).toBeNull();
    expect(press('ArrowRight', { target: { tagName: 'BUTTON' } })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
  });

  test('allows key repeat only for seeking and speed changes', () => {
    expect(press('ArrowRight', { repeat: true })).toEqual({ type: 'seekBy', seconds: SEEK_STEP_SECONDS });
    expect(press('ArrowUp', { repeat: true })).toEqual({ type: 'changeSpeed', step: 1 });
    expect(press(' ', { repeat: true })).toBeNull();
    expect(press('r', { repeat: true })).toBeNull();
  });

  test('works without a target', () => {
    expect(resolveShortcut({ key: ' ' })).toEqual({ type: 'togglePlay' });
  });
});

describe('stepSpeed', () => {
  const speeds = [1, 5, 10, 30];

  test('moves to the next or previous speed', () => {
    expect(stepSpeed(speeds, 10, 1)).toBe(30);
    expect(stepSpeed(speeds, 10, -1)).toBe(5);
  });

  test('stays at the ends of the list', () => {
    expect(stepSpeed(speeds, 30, 1)).toBe(30);
    expect(stepSpeed(speeds, 1, -1)).toBe(1);
  });

  test('keeps the current speed when it is not in the list', () => {
    expect(stepSpeed(speeds, 2, 1)).toBe(2);
  });
});

describe('resolveCourseKm', () => {
  test('prefers the course length from the profile', () => {
    expect(resolveCourseKm(28.5, [{ totalDistance: 30 }])).toBe(28.5);
  });

  test('falls back to the longest rider distance', () => {
    const riders = [{ totalDistance: 27.9 }, { distance: [0, 10, 28.4] }, { totalDistance: 28.1 }];
    expect(resolveCourseKm(null, riders)).toBe(28.4);
  });

  test('returns 0 without profile course length or riders', () => {
    expect(resolveCourseKm(null, [])).toBe(0);
    expect(resolveCourseKm(undefined, undefined)).toBe(0);
  });
});

describe('buildCurveLookup', () => {
  test('returns the y of the nearest sampled x', () => {
    const curveY = buildCurveLookup([0, 10, 20, 30], [100, 80, 60, 90]);
    expect(curveY(0)).toBe(100);
    expect(curveY(12)).toBe(80);
    expect(curveY(16)).toBe(60);
    expect(curveY(29)).toBe(90);
  });

  test('clamps to the curve ends', () => {
    const curveY = buildCurveLookup([10, 20], [50, 40]);
    expect(curveY(-5)).toBe(50);
    expect(curveY(100)).toBe(40);
  });

  test('sorts samples that are not in x order', () => {
    const curveY = buildCurveLookup([20, 0, 10], [60, 100, 80]);
    expect(curveY(1)).toBe(100);
    expect(curveY(19)).toBe(60);
  });

  test('skips invalid samples and returns null without valid ones', () => {
    expect(buildCurveLookup([0, NaN, 20], [5, 6, 7])(9)).toBe(5);
    expect(buildCurveLookup([], [])).toBeNull();
    expect(buildCurveLookup([NaN], [1])).toBeNull();
  });
});

describe('parseProfileGeometry', () => {
  const profile = {
    xMin: -0.28536,
    xMax: 28.82136,
    plotLeft: 50,
    plotWidth: 1540,
    plotTop: 0,
    plotHeight: 116,
    courseKm: 28.536,
  };

  test('reads the axis range, plot box and course length', () => {
    expect(parseProfileGeometry(profile)).toEqual({
      xMin: -0.28536,
      xMax: 28.82136,
      plotLeft: 50,
      plotWidth: 1540,
      plotTop: 0,
      plotHeight: 116,
      courseKm: 28.536,
    });
  });

  test('keeps the axis when the course length is missing', () => {
    expect(parseProfileGeometry({ ...profile, courseKm: undefined })).toMatchObject({ xMin: -0.28536, courseKm: null });
  });

  test('drops unknown fields', () => {
    expect(parseProfileGeometry({ ...profile, extra: 1 })).not.toHaveProperty('extra');
  });

  test('returns null when fields are missing or invalid', () => {
    expect(parseProfileGeometry({})).toBeNull();
    expect(parseProfileGeometry(undefined)).toBeNull();
    expect(parseProfileGeometry(null)).toBeNull();
    expect(parseProfileGeometry({ ...profile, plotLeft: undefined })).toBeNull();
    expect(parseProfileGeometry({ ...profile, xMin: '0' })).toBeNull();
    expect(parseProfileGeometry({ ...profile, xMax: -1 })).toBeNull();
    expect(parseProfileGeometry({ ...profile, plotWidth: 0 })).toBeNull();
  });
});

describe('mapDistanceToAxisX', () => {
  const unzoomed = { xMin: -0.28536, xMax: 28.82136, plotLeft: 50, plotWidth: 1540 };
  const zoomed = { xMin: 8, xMax: 14, plotLeft: 50, plotWidth: 1540 };

  test('maps the course start inside the axis padding when unzoomed', () => {
    expect(mapDistanceToAxisX(0, unzoomed)).toBeCloseTo(65.1, 1);
    expect(mapDistanceToAxisX(28.536, unzoomed)).toBeCloseTo(1574.9, 1);
  });

  test('maps the visible range onto the full plot when zoomed', () => {
    expect(mapDistanceToAxisX(8, zoomed)).toBe(50);
    expect(mapDistanceToAxisX(11, zoomed)).toBe(820);
    expect(mapDistanceToAxisX(14, zoomed)).toBe(1590);
  });

  test('stays at the plot start for an empty range', () => {
    expect(mapDistanceToAxisX(5, { xMin: 0, xMax: 0, plotLeft: 65, plotWidth: 1510 })).toBe(65);
  });

  test('extrapolates outside the visible range', () => {
    expect(mapDistanceToAxisX(5, zoomed)).toBeLessThan(50);
    expect(mapDistanceToAxisX(20, zoomed)).toBeGreaterThan(1590);
  });
});

describe('classifyAxisDistance', () => {
  const axis = { xMin: 8, xMax: 14 };

  test('splits distances into behind, visible and ahead', () => {
    expect(classifyAxisDistance(7.9, axis)).toBe('behind');
    expect(classifyAxisDistance(8, axis)).toBe('visible');
    expect(classifyAxisDistance(14, axis)).toBe('visible');
    expect(classifyAxisDistance(14.1, axis)).toBe('ahead');
  });
});

describe('transformPlotBox', () => {
  const box = { plotLeft: 50, plotTop: 0, plotWidth: 1540, plotHeight: 116 };

  test('keeps the box with an identity matrix', () => {
    expect(transformPlotBox(box, { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 })).toEqual(box);
  });

  test('applies offset and scale', () => {
    expect(transformPlotBox(box, { a: 0.5, b: 0, c: 0, d: 2, e: 10, f: 5 }))
      .toEqual({ plotLeft: 35, plotTop: 5, plotWidth: 770, plotHeight: 232 });
  });
});

describe('alignNearEdges', () => {
  test('aligns to the start or end near the edges', () => {
    expect(alignNearEdges(70, 65, 1575, 80)).toBe('start');
    expect(alignNearEdges(1560, 65, 1575, 80)).toBe('end');
    expect(alignNearEdges(800, 65, 1575, 80)).toBe('middle');
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
    expect(calcGapToGroupAhead(groups, you, 60)).toBe(Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600));
  });

  test('returns 0 in the lead group or without a watched rider', () => {
    expect(calcGapToGroupAhead([{ riders: [lead, you], hasYou: true }], you, 60)).toBe(0);
    expect(calcGapToGroupAhead(groups, undefined, 60)).toBe(0);
    expect(calcGapToGroupAhead([], you, 60)).toBe(0);
  });

  test('uses finish times once both riders finished', () => {
    const finishedTail = { ...tail, finished: true, finishTime: 3600 };
    const finishedYou = { ...you, finished: true, finishTime: 3609 };
    const finishedGroups = [{ riders: [finishedTail], hasYou: false }, { riders: [finishedYou], hasYou: true }];
    expect(calcGapToGroupAhead(finishedGroups, finishedYou, 3700)).toBe(9);
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

describe('calcRaceDuration', () => {
  test('returns the longest rider time', () => {
    expect(calcRaceDuration([{ distance: [0, 1, 2] }, { distance: [0, 1, 2, 3, 4] }])).toBe(4);
    expect(calcRaceDuration([{ distance: [0, 1, 2] }], 5)).toBe(10);
  });

  test('returns 0 without samples', () => {
    expect(calcRaceDuration([])).toBe(0);
    expect(calcRaceDuration([{ distance: [] }, {}])).toBe(0);
  });
});

describe('findWatchedRider', () => {
  test('prefers the current user', () => {
    const riders = [{ position: 1 }, { position: 7, isCurrentUser: true }];
    expect(findWatchedRider(riders).position).toBe(7);
  });

  test('falls back to the best placed rider', () => {
    expect(findWatchedRider([{ position: 4 }, { position: 2 }, { position: 9 }]).position).toBe(2);
  });

  test('returns null without riders', () => {
    expect(findWatchedRider([])).toBeNull();
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

  test('falls back to the default when nothing is selected', () => {
    expect(resolveWatchedRider(riders, null).zwiftId).toBe('17');
  });

  test('falls back to the default when the selected rider is gone', () => {
    expect(resolveWatchedRider(riders, '99').zwiftId).toBe('17');
    expect(resolveWatchedRider([{ position: 4, zwiftId: '14' }, { position: 2, zwiftId: '12' }], '99').zwiftId).toBe('12');
  });

  test('returns null without riders', () => {
    expect(resolveWatchedRider([], '11')).toBeNull();
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
      { value: '11', label: '#1 Anna Lee' },
      { value: '13', label: '#3 Martin Rank' },
      { value: '17', label: '#7 Vitalii E (you)' },
    ]);
  });

  test('does not reorder the input', () => {
    const riders = [{ position: 2, zwiftId: '12', name: 'B' }, { position: 1, zwiftId: '11', name: 'A' }];
    buildWatchOptions(riders);
    expect(riders.map(r => r.zwiftId)).toEqual(['12', '11']);
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

describe('riderMarkerRole', () => {
  const context = { watchedId: '15', leaderId: '11', groupIds: new Set(['14', '15', '16']) };

  test('marks the watched rider first, then the leader, then the group', () => {
    expect(riderMarkerRole('15', context)).toBe('you');
    expect(riderMarkerRole('11', context)).toBe('leader');
    expect(riderMarkerRole('14', context)).toBe('group');
    expect(riderMarkerRole('19', context)).toBe('muted');
  });

  test('keeps the watched rider style when leading', () => {
    expect(riderMarkerRole('11', { ...context, watchedId: '11' })).toBe('you');
  });
});

describe('isSameSyncedRace', () => {
  const race = { riders: [{}, {}], syncedAt: '2026-11-04T10:00:00Z' };

  test('matches races with the same rider count and sync time', () => {
    expect(isSameSyncedRace(race, { riders: [{}, {}], syncedAt: race.syncedAt })).toBe(true);
    expect(isSameSyncedRace(undefined, null)).toBe(true);
  });

  test('detects added riders, a new sync or a removed race', () => {
    expect(isSameSyncedRace(race, { riders: [{}, {}, {}], syncedAt: race.syncedAt })).toBe(false);
    expect(isSameSyncedRace(race, { riders: [{}, {}], syncedAt: '2026-11-04T10:01:00Z' })).toBe(false);
    expect(isSameSyncedRace(race, undefined)).toBe(false);
  });
});

describe('buildRiderStatsText', () => {
  test('builds the full stats line', () => {
    expect(buildRiderStatsText({ rank: 12, power: 287, leaderPower: 310, gapToLeader: 14, gapToGroup: 3 }))
      .toBe('#12 · 287 W · leader 310 W · +14s to leader · +3s to group');
  });

  test('formats gaps over a minute', () => {
    expect(buildRiderStatsText({ rank: 20, power: 250, gapToLeader: 75 })).toBe('#20 · 250 W · +1:15 to leader');
  });

  test('hides gaps that do not apply', () => {
    expect(buildRiderStatsText({ rank: 1, power: 310, leaderPower: 310, gapToLeader: 0, gapToGroup: 0 }))
      .toBe('#1 · 310 W · leader 310 W');
    expect(buildRiderStatsText({ rank: 3, power: 0 })).toBe('#3 · 0 W');
  });

  test('returns an empty line without data', () => {
    expect(buildRiderStatsText({})).toBe('');
  });

  test('adds the gap to the watched rider', () => {
    expect(buildRiderStatsText({ rank: 5, power: 280, gapToLeader: 14, watchedGap: { seconds: 3, ahead: true, name: 'Martin' } }))
      .toBe('#5 · 280 W · +14s to leader · 3s ahead of Martin');
    expect(buildRiderStatsText({ rank: 9, power: 250, watchedGap: { seconds: 65, ahead: false, name: 'Martin' } }))
      .toBe('#9 · 250 W · 1:05 behind Martin');
  });

  test('hides a zero gap to the watched rider', () => {
    expect(buildRiderStatsText({ rank: 5, power: 280, watchedGap: { seconds: 0, ahead: true, name: 'Martin' } }))
      .toBe('#5 · 280 W');
  });
});
