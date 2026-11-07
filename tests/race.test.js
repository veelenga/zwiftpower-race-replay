const {
  riderSpeedAt,
  riderDistanceAt,
  timeToReach,
  computeRaceStandings,
  gapBetween,
  raceDuration,
  trackGroups,
  detectGroups,
  gapToGroupAhead,
  nearestRiderGaps,
  buildGroupStrip,
  shortRiderName,
  calibrateRace,
  estimateClockOffset,
  estimateDistanceShift,
  normalizeRiders,
  DEFAULT_SPEED_KMH,
} = require('../src/race');

describe('riderSpeedAt', () => {
  test('assumes the default speed without data or in the first seconds', () => {
    expect(riderSpeedAt({}, 10)).toBe(DEFAULT_SPEED_KMH);
    expect(riderSpeedAt({ distance: [] }, 10)).toBe(DEFAULT_SPEED_KMH);
    expect(riderSpeedAt({ distance: [0, 1, 2] }, 2)).toBe(DEFAULT_SPEED_KMH);
  });

  test('reads speed from the distance series', () => {
    expect(riderSpeedAt({ distance: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, 10)).toBe(3600);
  });

  test('averages over the last few samples to smooth coarse distance steps', () => {
    const rider = { distance: [0, 0.01, 0.03, 0.04, 0.06, 0.07, 0.09, 0.10, 0.12, 0.13, 0.15] };
    expect(riderSpeedAt(rider, 10)).toBeCloseTo(((0.15 - 0.07) / 5) * 3600, 5);
    expect(riderSpeedAt(rider, 9)).toBeCloseTo(((0.13 - 0.06) / 5) * 3600, 5);
  });

  test('never drops below the minimum speed', () => {
    expect(riderSpeedAt({ distance: new Array(11).fill(0) }, 10)).toBe(10);
  });
});

describe('riderDistanceAt', () => {
  const rider = { distance: [0, 0.01, 0.02, 0.03, 0.04, 0.05] };

  test('interpolates between samples and extrapolates past the end at the recent speed', () => {
    expect(riderDistanceAt(rider, 2.5)).toBeCloseTo(0.025, 6);
    expect(riderDistanceAt(rider, 7)).toBeCloseTo(0.07, 6);
    expect(riderDistanceAt(rider, -1)).toBe(0);
    expect(riderDistanceAt({}, 3)).toBe(0);
  });
});

describe('timeToReach', () => {
  const rider = { distance: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4] };

  test('reads the time from the series, interpolating between samples', () => {
    expect(timeToReach(rider, 0.2, 2)).toBe(2);
    expect(timeToReach(rider, 0.19, 2)).toBeCloseTo(1.8, 6);
    expect(timeToReach(rider, 0.1, 2)).toBe(0);
  });

  test('falls back to the current speed when the series never gets there', () => {
    expect(timeToReach(rider, 9, 4)).toBeCloseTo(((9 - 0.2) / 180) * 3600, 6);
  });
});

describe('gapBetween', () => {
  const ahead = { distance: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] };
  const behind = { distance: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4] };

  test('is the time until the trailing rider reaches the leader\'s spot', () => {
    expect(gapBetween(ahead, behind, 2)).toBe(2);
    expect(gapBetween(ahead, behind, 4)).toBe(4);
    expect(gapBetween({ currentDistance: 0.19 }, behind, 2)).toBe(2);
  });

  test('is zero when the trailing rider is level or ahead', () => {
    expect(gapBetween(behind, ahead, 2)).toBe(0);
  });

  test('uses the default speed for riders without a series', () => {
    const standingAhead = { currentDistance: 10.1 };
    const standingBehind = { currentDistance: 10 };
    expect(gapBetween(standingAhead, standingBehind, 10)).toBe(Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600));
  });

  test('is the official time difference once both riders finished', () => {
    expect(gapBetween({ finished: true, finishTime: 3600 }, { finished: true, finishTime: 3614.4 }, 4000)).toBe(14);
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
      { position: 1, currentDistance: 10.0, currentPower: 300 },
      { position: 2, currentDistance: 9.995, currentPower: 280 },
      { position: 3, currentDistance: 9.5, currentPower: 270 },
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
    expect(trackGroups(standingsAt(fourSeconds), 60, 1, together.linked).groups.length).toBe(1);
    expect(trackGroups(standingsAt(fourSeconds), 60, 1).groups.length).toBe(2);
    const apart = trackGroups(standingsAt(sixSeconds), 60, 1, together.linked);
    expect(apart.groups.length).toBe(2);
    expect(trackGroups(standingsAt(fourSeconds), 60, 1, apart.linked).groups.length).toBe(2);
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
    expect(gapBetween(standings[0], standings[1], 20)).toBe(0);
  });
});

describe('normalizeRiders', () => {
  const rider = { zwiftId: 'a', finishTime: 5, distance: [0.1, 1.1, 2.1, 3.1, 4.1], power: [200, 200, 200, 200, 0], heartRate: [120, 121, 122, 123, 124], elevation: [1, 2, 3, 4, 5] };

  test('pads the series onto the official clock, shifts distance and scales it onto the measured line', () => {
    const [moved] = normalizeRiders([rider], { offset: 2, shift: 0.1, finishKm: 3.3, finishRawKm: 3.1 });
    expect(moved.distance.map(km => +km.toFixed(2))).toEqual([-2.2, -1.1, 0, 1.1, 2.2, 3.3, 4.4]);
    expect(moved.power).toEqual([200, 200, 200, 200, 200, 200, 0]);
    expect(moved.heartRate).toEqual([120, 120, 120, 121, 122, 123, 124]);
    expect(moved.elevation).toEqual([1, 1, 1, 2, 3, 4, 5]);
    expect(moved).toMatchObject({ finishTime: 5, finishDistance: 3.3 });
    expect(rider.distance[0]).toBe(0.1);
  });

  test('rolls the lead-in back at the default speed when the series is too short to measure one', () => {
    const [plain] = normalizeRiders([{ distance: [0.1, 1.1] }], { offset: 1, shift: 0.1, finishKm: 3.3, finishRawKm: 3.1 });
    expect(plain.distance[0]).toBeCloseTo(-DEFAULT_SPEED_KMH / 3600, 6);
    expect(plain.distance.slice(1).map(km => +km.toFixed(6))).toEqual([0, 1]);
    expect(plain.finishTime).toBeUndefined();
    expect(plain.finishDistance).toBeUndefined();
  });
});

describe('calibrateRace', () => {
  const lineRawKm = 10.08;
  const startKm = 0.08;
  const clockOffset = 30;
  const bump = km => Math.round(50 + 40 * Math.sin(km * 1.7) + 20 * Math.cos(km * 5.1));
  const makeRider = (kmPerSecond, { stopPower = false } = {}) => {
    const lineAt = (lineRawKm - startKm) / kmPerSecond;
    const length = Math.round(lineAt) + 20;
    const distance = Array.from({ length }, (_, i) => +(startKm + i * kmPerSecond).toFixed(4));
    const power = Array.from({ length }, (_, i) => (stopPower && i > Math.round(lineAt) ? 0 : 250));
    return { finishTime: lineAt + clockOffset, distance, power, elevation: distance.map(km => bump(km - startKm)) };
  };
  const riders = [0.010, 0.011, 0.012, 0.013, 0.014].map(speed => makeRider(speed));
  const course = { xs: Array.from({ length: 1001 }, (_, i) => i / 100), ys: Array.from({ length: 1001 }, (_, i) => 2 * bump(i / 100) + 7), lengthKm: 10 };

  test('reads the clock offset from where riders stop pedalling', () => {
    const stopping = [0.010, 0.011, 0.012].map(speed => makeRider(speed, { stopPower: true }));
    expect(estimateClockOffset(stopping)).toBeCloseTo(clockOffset - 1, 0);
  });

  test('falls back to the offset that puts every rider on the same line at their official time', () => {
    expect(estimateClockOffset(riders)).toBeCloseTo(clockOffset, 0);
    const { offset, shift, finishKm } = calibrateRace(riders, null);
    expect(offset).toBeCloseTo(clockOffset, 0);
    expect(shift).toBe(0);
    expect(finishKm).toBeCloseTo(lineRawKm, 2);
  });

  test('aligns the shape of rider elevation with the course profile, whatever its scale', () => {
    expect(estimateDistanceShift(riders, course)).toBeCloseTo(startKm, 2);
    const { shift, finishKm } = calibrateRace(riders, course);
    expect(shift).toBeCloseTo(startKm, 2);
    expect(finishKm).toBeCloseTo(lineRawKm - startKm, 2);
  });

  test('snaps the finish onto the profile end when the elevation fit lands close to it', () => {
    const slightlyShort = { ...course, lengthKm: 9.9 };
    expect(calibrateRace(riders, slightlyShort)).toMatchObject({ shift: expect.closeTo(0.18, 2), finishKm: expect.closeTo(9.9, 2) });
    const farOff = { ...course, lengthKm: 9.5 };
    expect(calibrateRace(riders, farOff)).toMatchObject({ shift: expect.closeTo(startKm, 2), finishKm: expect.closeTo(10, 2) });
  });

  test('anchors the finish to the profile end when the elevation does not match', () => {
    const flat = { xs: course.xs, ys: course.xs.map(() => 5), lengthKm: 10 };
    expect(estimateDistanceShift(riders, flat)).toBeNull();
    expect(calibrateRace(riders, flat).shift).toBeCloseTo(lineRawKm - 10, 2);
  });

  test('falls back to no offset with too few timed riders', () => {
    expect(estimateClockOffset([riders[0]])).toBe(0);
    expect(calibrateRace([], null)).toEqual({ offset: 0, shift: 0, finishKm: null, finishRawKm: null });
  });
});

describe('raceDuration', () => {
  test('runs until the last official finish or the end of the longest series', () => {
    expect(raceDuration([{ distance: [0, 1, 2], finishTime: 5 }, { distance: Array(8).fill(0) }])).toBe(7);
    expect(raceDuration([{ distance: [0, 1, 2], finishTime: 9 }])).toBe(9);
    expect(raceDuration([])).toBe(0);
  });
});

describe('gapToGroupAhead', () => {
  const lead = { position: 1, finished: false, currentDistance: 10.2 };
  const tail = { position: 2, finished: false, currentDistance: 10.1 };
  const you = { position: 3, finished: false, currentDistance: 10 };
  const groups = [
    { riders: [lead, tail], hasYou: false },
    { riders: [you], hasYou: true },
  ];

  test('measures the gap to the last rider of the group ahead', () => {
    expect(gapToGroupAhead(groups, 1, you, 60)).toBe(Math.round((0.1 / DEFAULT_SPEED_KMH) * 3600));
  });

  test('returns 0 in the lead group, without a group or without a watched rider', () => {
    expect(gapToGroupAhead([{ riders: [lead, you], hasYou: true }], 0, you, 60)).toBe(0);
    expect(gapToGroupAhead(groups, -1, you, 60)).toBe(0);
    expect(gapToGroupAhead(groups, 1, undefined, 60)).toBe(0);
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

