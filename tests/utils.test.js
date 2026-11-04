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
  debounce,
  throttle,
  DEFAULT_SPEED_KMH,
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
    expect(groups[0].name).toBe('Lead Group');
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
