const SAMPLE_SECONDS = 1;
const SECONDS_PER_HOUR = 3600;
const DEFAULT_SPEED_KMH = 40;
const MIN_SPEED_KMH = 10;
const SPEED_WINDOW_SAMPLES = 5;
const SPEED_WARMUP_SECONDS = 3;

const GROUP_JOIN_SECONDS = 3;
const GROUP_LEAVE_SECONDS = 5;
const GROUP_SPAN_JOIN_SECONDS = 20;
const GROUP_SPAN_LEAVE_SECONDS = 25;
const STRIP_GROUPS_WITHOUT_YOU = 4;

const MIN_CALIBRATION_RIDERS = 3;
const CLOCK_OFFSET_MAX_SECONDS = 180;
const CLOCK_OFFSET_STEP_SECONDS = 0.5;
const STOP_SEARCH_FRACTION = 0.8;
const STOP_PEDALLING_WATTS = 50;
const STOP_QUIET_WATTS = 30;
const STOP_QUIET_SAMPLES = 5;
const SHIFT_DEFAULT_MAX_KM = 1;
const SHIFT_COARSE_KM = 0.05;
const SHIFT_FINE_KM = 0.01;
const ELEVATION_SAMPLE_STRIDE = 5;
const MIN_ELEVATION_PAIRS = 50;
const MIN_ELEVATION_CORRELATION = 0.9;
const MAX_ELEVATION_RIDERS = 5;
const FINISH_SNAP_KM = 0.15;

function sampleIndex(time) {
  return Math.floor(time / SAMPLE_SECONDS);
}

function seriesEnd(rider) {
  return Math.max((rider.distance?.length || 0) - 1, 0) * SAMPLE_SECONDS;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function shortRiderName(name) {
  return String(name ?? '').trim().split(/\s+/)[0];
}

function riderSpeedAt(rider, time) {
  const samples = rider.distance;
  if (!samples?.length || time < SPEED_WARMUP_SECONDS) return DEFAULT_SPEED_KMH;
  const index = Math.min(sampleIndex(time), samples.length - 1);
  const from = Math.max(0, index - SPEED_WINDOW_SAMPLES);
  const seconds = Math.max(index - from, 1) * SAMPLE_SECONDS;
  const kmh = (((samples[index] || 0) - (samples[from] || 0)) / seconds) * SECONDS_PER_HOUR;
  return Math.max(kmh, MIN_SPEED_KMH);
}

function riderDistanceAt(rider, time) {
  const samples = rider.distance || [];
  const last = samples.length - 1;
  if (last < 0) return 0;
  const position = time / SAMPLE_SECONDS;
  const index = Math.floor(position);
  if (index < 0) return samples[0];
  if (index < last) return samples[index] + (samples[index + 1] - samples[index]) * (position - index);
  const kmPerSecond = riderSpeedAt(rider, last * SAMPLE_SECONDS) / SECONDS_PER_HOUR;
  return samples[last] + kmPerSecond * (time - last * SAMPLE_SECONDS);
}

function timeToReach(rider, km, fromTime, fromKm = riderDistanceAt(rider, fromTime)) {
  const samples = rider.distance || [];
  const last = samples.length - 1;
  const start = Math.min(Math.max(sampleIndex(fromTime), 0), last);
  if (fromKm >= km) return 0;
  if (last < 0 || samples[last] < km) return ((km - fromKm) / riderSpeedAt(rider, fromTime)) * SECONDS_PER_HOUR;
  let low = start;
  let high = last;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (samples[mid] >= km) high = mid;
    else low = mid + 1;
  }
  const before = samples[low - 1];
  const fraction = samples[low] > before ? (km - before) / (samples[low] - before) : 1;
  return Math.max(0, (low - 1 + fraction) * SAMPLE_SECONDS - fromTime);
}

function riderFinishTime(rider) {
  return rider.finishTime > 0 ? rider.finishTime : seriesEnd(rider);
}

function riderStandingAt(rider, time) {
  const samples = rider.distance || [];
  const last = samples.length - 1;
  const index = Math.min(sampleIndex(time), last);
  const finishTime = riderFinishTime(rider);
  const finished = time >= finishTime;
  return {
    rider,
    position: rider.position,
    distance: samples,
    currentDistance: finished ? rider.finishDistance ?? samples[last] ?? 0 : samples[index] || 0,
    currentPower: finished ? 0 : rider.power?.[index] || 0,
    finished,
    finishTime,
  };
}

function compareStandings(a, b) {
  if (a.finished !== b.finished) return a.finished ? -1 : 1;
  return a.finished ? a.finishTime - b.finishTime : b.currentDistance - a.currentDistance;
}

function computeRaceStandings(riders, time) {
  return riders.map(rider => riderStandingAt(rider, time)).sort(compareStandings);
}

function gapBetween(ahead, behind, time) {
  if (ahead.finished && behind.finished) return Math.round(behind.finishTime - ahead.finishTime);
  const aheadKm = ahead.currentDistance ?? riderDistanceAt(ahead, time);
  const behindKm = behind.currentDistance ?? riderDistanceAt(behind, time);
  if (aheadKm <= behindKm) return 0;
  return Math.round(timeToReach(behind, aheadKm, time, behindKm));
}

function raceDuration(riders) {
  return Math.max(0, ...riders.map(rider => Math.max(riderFinishTime(rider), seriesEnd(rider))));
}

function standingId(standing) {
  return standing.rider?.zwiftId ?? standing.position;
}

function describeGroups(groups, leader, time, watchingPosition) {
  return groups.map((riders, idx) => ({
    idx,
    riders,
    avgPower: Math.round(riders.reduce((sum, standing) => sum + standing.currentPower, 0) / riders.length),
    timeGapToLeader: idx === 0 ? 0 : gapBetween(leader, riders[0], time),
    hasYou: riders.some(standing => standing.position === watchingPosition),
    name: idx === 0 ? 'Lead group' : `Group ${idx + 1}`,
  }));
}

function trackGroups(standings, time, watchingPosition, linked = new Set()) {
  const nextLinked = new Set();
  if (standings.length === 0) return { groups: [], linked: nextLinked };
  const groups = [];
  let current = [standings[0]];
  for (let i = 1; i < standings.length; i++) {
    const previous = standings[i - 1];
    const standing = standings[i];
    const pair = `${standingId(previous)}|${standingId(standing)}`;
    const wasLinked = linked.has(pair);
    const gap = gapBetween(previous, standing, time);
    const span = gapBetween(current[0], standing, time);
    const maxGap = wasLinked ? GROUP_LEAVE_SECONDS : GROUP_JOIN_SECONDS;
    const maxSpan = wasLinked ? GROUP_SPAN_LEAVE_SECONDS : GROUP_SPAN_JOIN_SECONDS;
    if (gap <= maxGap && span <= maxSpan) {
      current.push(standing);
      nextLinked.add(pair);
    } else {
      groups.push(current);
      current = [standing];
    }
  }
  groups.push(current);
  return { groups: describeGroups(groups, standings[0], time, watchingPosition), linked: nextLinked };
}

function detectGroups(standings, time, watchingPosition) {
  return trackGroups(standings, time, watchingPosition).groups;
}

function gapToGroupAhead(groups, groupIndex, watching, time) {
  if (!watching || groupIndex <= 0) return 0;
  const ahead = groups[groupIndex - 1].riders;
  return gapBetween(ahead[ahead.length - 1], watching, time);
}

function namedGap(ahead, behind, named, time) {
  return { name: shortRiderName(named.rider.name), seconds: gapBetween(ahead, behind, time) };
}

function nearestRiderGaps(standings, youIndex, time) {
  const you = standings[youIndex];
  if (!you) return {};
  const ahead = standings[youIndex - 1];
  const behind = standings[youIndex + 1];
  return {
    ahead: ahead && namedGap(ahead, you, ahead, time),
    behind: behind && namedGap(you, behind, behind, time),
  };
}

function stripGroupIndexes(total, yourGroupIndex) {
  const wanted = yourGroupIndex < 0
    ? Array.from({ length: STRIP_GROUPS_WITHOUT_YOU }, (_, i) => i)
    : [0, yourGroupIndex - 1, yourGroupIndex, yourGroupIndex + 1];
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

function buildGroupStrip(groups, yourGroupIndex, time) {
  const visible = stripGroupIndexes(groups.length, yourGroupIndex);
  const items = [];
  let folded = [];
  const flush = () => {
    if (folded.length > 0) items.push(foldedChip(folded));
    folded = [];
  };
  groups.forEach((group, index) => {
    const gap = index === 0 ? 0 : gapToGroupAhead(groups, index, group.riders[0], time);
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

function offsetFromPedalStops(riders) {
  const offsets = riders
    .map(rider => ({ rider, stop: pedalStopIndex(rider.power) }))
    .filter(({ stop }) => stop > 0)
    .map(({ rider, stop }) => rider.finishTime - stop * SAMPLE_SECONDS)
    .filter(offset => offset >= 0 && offset <= CLOCK_OFFSET_MAX_SECONDS);
  return offsets.length >= MIN_CALIBRATION_RIDERS ? median(offsets) : null;
}

function finishSpread(riders, offset) {
  const kms = riders.map(rider => riderDistanceAt(rider, rider.finishTime - offset));
  const mid = median(kms);
  return median(kms.map(km => Math.abs(km - mid)));
}

function offsetFromFinishSpread(riders) {
  let best = { offset: 0, spread: Infinity };
  for (let offset = 0; offset <= CLOCK_OFFSET_MAX_SECONDS; offset += CLOCK_OFFSET_STEP_SECONDS) {
    const spread = finishSpread(riders, offset);
    if (spread < best.spread) best = { offset, spread };
  }
  return best.offset;
}

function estimateClockOffset(riders) {
  const timed = timedRiders(riders);
  if (timed.length < MIN_CALIBRATION_RIDERS) return 0;
  return offsetFromPedalStops(timed) ?? offsetFromFinishSpread(timed);
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
  const coarse = search(-SHIFT_COARSE_KM, maxShift, SHIFT_COARSE_KM);
  return search(coarse.shift - SHIFT_COARSE_KM, coarse.shift + SHIFT_COARSE_KM, SHIFT_FINE_KM);
}

function estimateDistanceShift(riders, course, maxShift = SHIFT_DEFAULT_MAX_KM) {
  const usable = riders.filter(rider => rider.elevation?.length > 0 && rider.elevation.length === rider.distance?.length);
  if (!(course?.xs?.length > 1) || usable.length === 0) return null;
  const fits = usable.slice(0, MAX_ELEVATION_RIDERS).map(rider => bestShiftFor(rider, course, maxShift));
  if (median(fits.map(fit => fit.score)) < MIN_ELEVATION_CORRELATION) return null;
  return median(fits.map(fit => fit.shift));
}

function calibrateRace(riders, course) {
  const offset = estimateClockOffset(riders);
  const timed = timedRiders(riders);
  const finishRawKm = timed.length > 0 ? median(timed.map(rider => riderDistanceAt(rider, rider.finishTime - offset))) : null;
  const courseKm = course?.lengthKm ?? null;
  const anchorShift = finishRawKm !== null && courseKm !== null ? finishRawKm - courseKm : 0;
  const fitted = estimateDistanceShift(riders, course, Math.max(SHIFT_DEFAULT_MAX_KM, anchorShift + 1));
  const nearProfileEnd = fitted !== null && courseKm !== null && Math.abs(fitted - anchorShift) <= FINISH_SNAP_KM;
  const shift = fitted === null || nearProfileEnd ? anchorShift : fitted;
  const finishKm = finishRawKm !== null ? finishRawKm - shift : courseKm;
  return { offset, shift, finishKm, finishRawKm };
}

function padSeries(series, count, fill) {
  return series ? new Array(count).fill(fill).concat(series) : series;
}

function leadInDistance(distance, count, rider) {
  const kmPerSecond = riderSpeedAt(rider, Math.min(SPEED_WINDOW_SAMPLES, distance.length - 1) * SAMPLE_SECONDS) / SECONDS_PER_HOUR;
  return Array.from({ length: count }, (_, i) => distance[0] - kmPerSecond * (count - i) * SAMPLE_SECONDS);
}

function normalizeRider(rider, { offset = 0, shift = 0, finishKm = null, finishRawKm = null }) {
  const timed = rider.finishTime > 0;
  const ownFinish = timed && finishRawKm !== null ? riderDistanceAt(rider, rider.finishTime - offset) - shift : null;
  const scale = ownFinish > 0 && finishKm > 0 ? finishKm / ownFinish : 1;
  const pad = Math.round(offset / SAMPLE_SECONDS);
  const distance = (rider.distance || []).map(km => (km - shift) * scale);
  return {
    ...rider,
    distance: distance.length > 0 ? leadInDistance(distance, pad, { distance }).concat(distance) : distance,
    power: padSeries(rider.power, pad, rider.power?.[0] ?? 0),
    heartRate: padSeries(rider.heartRate, pad, rider.heartRate?.[0] ?? 0),
    elevation: padSeries(rider.elevation, pad, rider.elevation?.[0] ?? 0),
    finishDistance: timed && finishKm !== null ? finishKm : undefined,
  };
}

function normalizeRiders(riders, calibration = {}) {
  return riders.map(rider => normalizeRider(rider, calibration));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    riderSpeedAt,
    riderDistanceAt,
    timeToReach,
    riderStandingAt,
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
  };
}
