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
  SECONDS_PER_MINUTE,
  DEFAULT_SPEED_KMH,
  GROUP_GAP_THRESHOLD_SECONDS,
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
    expect(highlightMatch(null, 'test')).toBe(null);
    expect(highlightMatch(undefined, 'test')).toBe(undefined);
  });
});
