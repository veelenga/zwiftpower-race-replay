const INLINE_GRAPH_SELECTOR = '#segment_graph';
const INLINE_PLOT_SELECTOR = 'rect.highcharts-plot-background';
const INLINE_PATH_SELECTOR = '.highcharts-series-0 path.highcharts-graph';
const INLINE_SVG_NS = 'http://www.w3.org/2000/svg';
const INLINE_HOST_CLASS = 'zp-replay-host';
const INLINE_DOT_CLASS = 'zp-replay-dot';
const INLINE_DOT_RADII = { you: 6.5, leader: 5, group: 4.5, muted: 3.5 };
const INLINE_MAX_PATH_SAMPLES = 3000;
const INLINE_GEOMETRY_DELAY_MS = 100;
const INLINE_LABEL_OFFSET_PX = 11;
const INLINE_LABEL_EDGE_PX = 80;
const INLINE_TOOLTIP_EDGE_PX = 90;
const INLINE_TOOLTIP_FLIP_PX = 56;
const INLINE_TOOLTIP_GAP_PX = 10;
const INLINE_TOOLTIP_SHIFTS = { start: '0%', middle: '-50%', end: '-100%' };
const INLINE_SPEEDS = [1, 5, 10, 30];
const INLINE_DEFAULT_SPEED = 10;

const inlineReplay = {
  raceKey: null,
  loadId: 0,
  riders: [],
  watchingPosition: null,
  sampleInterval: 1,
  courseKm: 0,
  maxTime: 0,
  time: 0,
  speed: INLINE_DEFAULT_SPEED,
  playing: false,
  frameId: null,
  lastFrameAt: null,
  hoveredId: null,
  view: null,
};

const INLINE_SHORTCUTS = {
  togglePlay: () => toggleInlinePlayback(),
  seekBy: ({ seconds }) => seekInline(inlineReplay.time + seconds),
};

function createSvgElement(tagName, className) {
  const element = document.createElementNS(INLINE_SVG_NS, tagName);
  if (className) element.setAttribute('class', className);
  return element;
}

function createTextSlot(tagName, className) {
  const element = createControlElement(tagName, className);
  const text = document.createTextNode('');
  element.append(text);
  return { element, text };
}

function setSlotText(slot, value) {
  if (slot.text.data !== value) slot.text.data = value;
}

function findProfileTarget() {
  const graph = document.querySelector(INLINE_GRAPH_SELECTOR);
  const path = graph?.querySelector(INLINE_PATH_SELECTOR);
  return path ? { graph, path, plot: graph.querySelector(INLINE_PLOT_SELECTOR) } : null;
}

function readPageCourseKm(graph) {
  for (let node = graph.parentElement; node; node = node.parentElement) {
    const courseKm = parseCourseDistanceKm(node.textContent);
    if (courseKm) return courseKm;
  }
  return null;
}

function samplePath(path, length, matrix) {
  const count = clamp(Math.ceil(length), 2, INLINE_MAX_PATH_SAMPLES);
  const xs = new Array(count);
  const ys = new Array(count);
  for (let i = 0; i < count; i++) {
    const point = path.getPointAtLength((length * i) / (count - 1));
    xs[i] = matrix.a * point.x + matrix.c * point.y + matrix.e;
    ys[i] = matrix.b * point.x + matrix.d * point.y + matrix.f;
  }
  return { xs, ys };
}

function measureProfile({ layer, path }) {
  const layerMatrix = layer.getScreenCTM();
  const pathMatrix = path.getScreenCTM();
  const length = path.getTotalLength();
  if (!layerMatrix || !pathMatrix || !(length > 0)) return null;

  const { xs, ys } = samplePath(path, length, layerMatrix.inverse().multiply(pathMatrix));
  return { firstX: xs[0], lastX: xs[xs.length - 1], curveY: buildCurveLookup(xs, ys) };
}

function refreshInlineGeometry() {
  const { view } = inlineReplay;
  if (!view) return;
  view.geometry = measureProfile(view);
  renderInlineFrame();
}

function observeProfileSize(view) {
  const refreshSoon = debounce(refreshInlineGeometry, INLINE_GEOMETRY_DELAY_MS);
  const resizeObserver = new ResizeObserver(() => refreshSoon());
  resizeObserver.observe(view.graph);
  view.observers.push(resizeObserver);
  if (!view.plot) return;

  const plotObserver = new MutationObserver(() => refreshSoon());
  plotObserver.observe(view.plot, { attributes: true, attributeFilter: ['x', 'y', 'width', 'height'] });
  view.observers.push(plotObserver);
}

function dotIdFrom(target) {
  return target?.closest?.(`.${INLINE_DOT_CLASS}`)?.dataset.zwiftId ?? null;
}

function hoverInlineDot(zwiftId) {
  if (inlineReplay.hoveredId === zwiftId) return;
  inlineReplay.hoveredId = zwiftId;
  renderInlineFrame();
}

function handleInlineKeydown(event) {
  const action = resolveShortcut(event);
  const run = action && INLINE_SHORTCUTS[action.type];
  if (!run) return;
  event.preventDefault();
  run(action);
}

function createInlineLayer() {
  const layer = createSvgElement('svg', 'zp-replay-layer');
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Race replay riders');
  layer.addEventListener('keydown', handleInlineKeydown);
  layer.addEventListener('mouseover', event => hoverInlineDot(dotIdFrom(event.target)));
  layer.addEventListener('mouseout', event => hoverInlineDot(dotIdFrom(event.relatedTarget)));
  layer.addEventListener('focusin', event => hoverInlineDot(dotIdFrom(event.target)));
  layer.addEventListener('focusout', event => hoverInlineDot(dotIdFrom(event.relatedTarget)));
  return layer;
}

function createInlineTooltip() {
  const element = createControlElement('div', 'zp-replay-tooltip');
  const name = createTextSlot('div', 'zp-replay-tooltip-name');
  const stats = createTextSlot('div', 'zp-replay-tooltip-stats');
  element.append(name.element, stats.element);
  element.hidden = true;
  return { element, name, stats, transform: null };
}

function createInlineScrubber() {
  const scrubber = createControlElement('input', 'zp-replay-scrubber');
  scrubber.type = 'range';
  scrubber.min = '0';
  scrubber.step = '1';
  scrubber.value = '0';
  scrubber.setAttribute('aria-label', 'Race time');
  scrubber.addEventListener('input', () => seekInline(Number(scrubber.value)));
  return scrubber;
}

function createInlineSpeedButtons() {
  const element = createControlElement('div', 'zp-replay-speeds');
  const buttons = INLINE_SPEEDS.map(speed => {
    const button = createControlButton('zp-replay-speed', () => setInlineSpeed(speed));
    button.textContent = `${speed}x`;
    return button;
  });
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Playback speed');
  element.append(...buttons);
  return { element, buttons };
}

function createInlineBar() {
  const element = createControlElement('div', 'zp-replay-bar');
  const controls = createControlElement('div', 'zp-replay-bar-row');
  const details = createControlElement('div', 'zp-replay-bar-row');
  const play = createControlButton('zp-replay-play', toggleInlinePlayback);
  const time = createTextSlot('span', 'zp-replay-time');
  const scrubber = createInlineScrubber();
  const speeds = createInlineSpeedButtons();
  const stats = createTextSlot('span', 'zp-replay-stats');
  const open = createControlButton('zp-replay-link zp-replay-open', openFullInlineReplay);

  open.textContent = 'Open full replay';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Race replay');
  element.addEventListener('keydown', handleInlineKeydown);
  controls.append(play, time.element, scrubber, speeds.element);
  details.append(stats.element, open);
  element.append(controls, details);
  return { element, play, time, scrubber, speedButtons: speeds.buttons, stats };
}

function mountInlineView({ graph, path, plot }) {
  const view = {
    graph,
    path,
    plot,
    layer: createInlineLayer(),
    tooltip: createInlineTooltip(),
    bar: createInlineBar(),
    dots: new Map(),
    observers: [],
    geometry: null,
    pageCourseKm: readPageCourseKm(graph),
  };

  graph.classList.add(INLINE_HOST_CLASS);
  graph.append(view.layer, view.tooltip.element);
  graph.after(view.bar.element);
  view.geometry = measureProfile(view);
  observeProfileSize(view);
  inlineReplay.view = view;
}

function unmountInlineView() {
  const { view } = inlineReplay;
  if (!view) return;

  pauseInline();
  view.observers.forEach(observer => observer.disconnect());
  view.layer.remove();
  view.tooltip.element.remove();
  view.bar.element.remove();
  view.graph.classList.remove(INLINE_HOST_CLASS);
  inlineReplay.view = null;
}

function isInlineViewCurrent(target) {
  const { view } = inlineReplay;
  return Boolean(view && target) &&
    view.graph === target.graph &&
    view.path === target.path &&
    view.layer.isConnected &&
    view.bar.element.isConnected;
}

function ensureInlineView() {
  const target = inlineReplay.riders.length > 0 ? findProfileTarget() : null;
  if (!target) {
    unmountInlineView();
    return false;
  }
  if (!isInlineViewCurrent(target)) {
    unmountInlineView();
    mountInlineView(target);
  }
  return true;
}

function createRiderDot(rider) {
  const element = createSvgElement('g', INLINE_DOT_CLASS);
  const circle = createSvgElement('circle');
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', rider.name);
  element.dataset.zwiftId = rider.zwiftId;
  element.append(circle);
  return { element, circle, label: null, role: null, transform: null, anchor: null, x: 0, y: 0 };
}

function setDotLabel(dot, name) {
  if (!name) {
    dot.label?.remove();
    dot.label = null;
    return;
  }
  if (!dot.label) {
    dot.label = createSvgElement('text', 'zp-replay-dot-label');
    dot.label.setAttribute('y', String(-INLINE_LABEL_OFFSET_PX));
    dot.element.append(dot.label);
    dot.anchor = null;
  }
  if (dot.label.textContent !== name) dot.label.textContent = name;
}

function removeStaleDots(view, riderIds) {
  view.dots.forEach((dot, zwiftId) => {
    if (riderIds.has(zwiftId)) return;
    dot.element.remove();
    view.dots.delete(zwiftId);
  });
}

function addRiderDot(view, rider) {
  const dot = createRiderDot(rider);
  view.dots.set(rider.zwiftId, dot);
  view.layer.prepend(dot.element);
  return dot;
}

function raiseWatchedDot(view) {
  const watched = inlineReplay.riders.find(rider => rider.position === inlineReplay.watchingPosition);
  const element = watched && view.dots.get(watched.zwiftId).element;
  if (element && view.layer.lastElementChild !== element) view.layer.append(element);
}

function syncInlineDots(view) {
  const { riders, watchingPosition } = inlineReplay;
  removeStaleDots(view, new Set(riders.map(rider => rider.zwiftId)));

  riders.forEach(rider => {
    const dot = view.dots.get(rider.zwiftId) || addRiderDot(view, rider);
    const isWatched = rider.position === watchingPosition;
    dot.element.setAttribute('tabindex', isWatched ? '0' : '-1');
    setDotLabel(dot, isWatched ? rider.name : null);
  });
  raiseWatchedDot(view);
}

function computeInlineSnapshot() {
  const { riders, time, sampleInterval, watchingPosition } = inlineReplay;
  const standings = computeRaceStandings(riders, time, sampleInterval);
  const groups = detectGroups(standings, time, watchingPosition, sampleInterval);
  const yourGroup = groups.find(group => group.hasYou);
  return {
    standings,
    groups,
    leader: standings[0],
    you: standings.find(standing => standing.position === watchingPosition),
    roleContext: {
      watchingPosition,
      leaderPosition: standings[0]?.position,
      groupPositions: new Set(yourGroup ? yourGroup.riders.map(rider => rider.position) : []),
    },
  };
}

function standingX(standing, geometry) {
  const { courseKm } = inlineReplay;
  const distanceKm = standing.finished ? courseKm : standing.currentDistance;
  return distanceToProfileX(distanceKm, geometry.firstX, geometry.lastX, courseKm);
}

function applyDotRole(dot, role) {
  if (dot.role === role) return;
  dot.role = role;
  dot.element.setAttribute('class', `${INLINE_DOT_CLASS} ${INLINE_DOT_CLASS}-${role}`);
  dot.circle.setAttribute('r', String(INLINE_DOT_RADII[role]));
}

function applyLabelAnchor(dot, geometry) {
  const anchor = alignNearEdges(dot.x, geometry.firstX, geometry.lastX, INLINE_LABEL_EDGE_PX);
  if (dot.anchor === anchor) return;
  dot.anchor = anchor;
  dot.label.setAttribute('text-anchor', anchor);
}

function applyDotPosition(dot, x, y, geometry) {
  const transform = `translate(${x.toFixed(1)} ${y.toFixed(1)})`;
  Object.assign(dot, { x, y });
  if (dot.transform !== transform) {
    dot.transform = transform;
    dot.element.setAttribute('transform', transform);
  }
  if (dot.label) applyLabelAnchor(dot, geometry);
}

function renderInlineDots(view, snapshot) {
  const { geometry } = view;
  if (!geometry?.curveY) return;

  snapshot.standings.forEach(standing => {
    const dot = view.dots.get(standing.zwiftId);
    if (!dot) return;
    const x = standingX(standing, geometry);
    applyDotRole(dot, riderMarkerRole(standing.position, snapshot.roleContext));
    applyDotPosition(dot, x, geometry.curveY(x), geometry);
  });
}

function tooltipTransform(dot, geometry) {
  const align = alignNearEdges(dot.x, geometry.firstX, geometry.lastX, INLINE_TOOLTIP_EDGE_PX);
  const shiftY = dot.y < INLINE_TOOLTIP_FLIP_PX
    ? `${INLINE_TOOLTIP_GAP_PX}px`
    : `calc(-100% - ${INLINE_TOOLTIP_GAP_PX}px)`;
  return `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px) translate(${INLINE_TOOLTIP_SHIFTS[align]}, ${shiftY})`;
}

function hoveredStandingIndex(view, snapshot) {
  const dot = view.dots.get(inlineReplay.hoveredId);
  if (!dot?.transform || !view.geometry) return -1;
  return snapshot.standings.findIndex(standing => standing.zwiftId === inlineReplay.hoveredId);
}

function renderInlineTooltip(view, snapshot) {
  const { tooltip } = view;
  const index = hoveredStandingIndex(view, snapshot);
  if (tooltip.element.hidden !== (index < 0)) tooltip.element.hidden = index < 0;
  if (index < 0) return;

  const standing = snapshot.standings[index];
  const { time, sampleInterval } = inlineReplay;
  setSlotText(tooltip.name, standing.name);
  setSlotText(tooltip.stats, buildRiderStatsText({
    rank: index + 1,
    power: standing.currentPower,
    gapToLeader: calcStandingGap(snapshot.leader, standing, time, sampleInterval),
  }));

  const transform = tooltipTransform(view.dots.get(standing.zwiftId), view.geometry);
  if (tooltip.transform === transform) return;
  tooltip.transform = transform;
  tooltip.element.style.transform = transform;
}

function watchedStatsText({ standings, groups, leader, you }) {
  if (!you) return '';
  const { time, sampleInterval } = inlineReplay;
  return buildRiderStatsText({
    rank: standings.indexOf(you) + 1,
    power: you.currentPower,
    leaderPower: leader.currentPower,
    gapToLeader: calcStandingGap(leader, you, time, sampleInterval),
    gapToGroup: calcGapToGroupAhead(groups, you, time, sampleInterval),
  });
}

function renderInlineControls(view, snapshot) {
  const { bar } = view;
  const { time, maxTime } = inlineReplay;
  const timeText = `${formatTime(time)} / ${formatTime(maxTime)}`;
  if (bar.time.text.data !== timeText) {
    bar.time.text.data = timeText;
    bar.scrubber.value = String(Math.floor(time));
    bar.scrubber.setAttribute('aria-valuetext', formatTime(time));
  }
  setSlotText(bar.stats, watchedStatsText(snapshot));
}

function renderInlineFrame() {
  const { view } = inlineReplay;
  if (!view || inlineReplay.riders.length === 0) return;

  const snapshot = computeInlineSnapshot();
  renderInlineDots(view, snapshot);
  renderInlineTooltip(view, snapshot);
  renderInlineControls(view, snapshot);
}

function renderInlinePlayState() {
  const play = inlineReplay.view?.bar.play;
  if (!play) return;
  const label = inlineReplay.playing ? 'Pause' : 'Play';
  if (play.textContent !== label) play.textContent = label;
}

function renderInlineSpeed() {
  inlineReplay.view?.bar.speedButtons.forEach((button, index) => {
    button.setAttribute('aria-pressed', String(INLINE_SPEEDS[index] === inlineReplay.speed));
  });
}

function renderInlineBarSetup(bar) {
  const watched = inlineReplay.riders.find(rider => rider.position === inlineReplay.watchingPosition);
  bar.scrubber.max = String(Math.ceil(inlineReplay.maxTime));
  bar.stats.element.title = watched ? watched.name : '';
  renderInlinePlayState();
  renderInlineSpeed();
}

function renderInlineReplay() {
  if (!ensureInlineView()) return;

  const { view } = inlineReplay;
  syncInlineDots(view);
  inlineReplay.courseKm = resolveCourseKm(view.pageCourseKm, inlineReplay.riders);
  renderInlineBarSetup(view.bar);
  renderInlineFrame();
}

function advanceInlineFrame(timestamp) {
  const elapsedMs = inlineReplay.lastFrameAt === null ? 0 : timestamp - inlineReplay.lastFrameAt;
  const { speed, maxTime } = inlineReplay;
  inlineReplay.lastFrameAt = timestamp;
  inlineReplay.time = advancePlaybackTime(inlineReplay.time, elapsedMs, speed, maxTime);
  renderInlineFrame();

  if (inlineReplay.time >= maxTime) pauseInline();
  else inlineReplay.frameId = requestAnimationFrame(advanceInlineFrame);
}

function playInline() {
  if (inlineReplay.playing || !inlineReplay.view || inlineReplay.maxTime <= 0) return;
  if (inlineReplay.time >= inlineReplay.maxTime) inlineReplay.time = 0;
  Object.assign(inlineReplay, { playing: true, lastFrameAt: null });
  inlineReplay.frameId = requestAnimationFrame(advanceInlineFrame);
  renderInlinePlayState();
}

function pauseInline() {
  if (inlineReplay.frameId !== null) cancelAnimationFrame(inlineReplay.frameId);
  Object.assign(inlineReplay, { playing: false, frameId: null, lastFrameAt: null });
  renderInlinePlayState();
}

function toggleInlinePlayback() {
  if (inlineReplay.playing) pauseInline();
  else playInline();
}

function seekInline(time) {
  inlineReplay.time = clamp(time, 0, inlineReplay.maxTime);
  renderInlineFrame();
}

function setInlineSpeed(speed) {
  inlineReplay.speed = speed;
  renderInlineSpeed();
}

function openFullInlineReplay() {
  pauseInline();
  requestOpenReplay(inlineReplay.raceKey);
}

function applyInlineRace(race) {
  const riders = (race?.riders || []).filter(rider => rider.distance?.length > 0);
  const sampleInterval = riders[0]?.sampleInterval || 1;
  const maxTime = calcRaceDuration(riders, sampleInterval);

  Object.assign(inlineReplay, {
    loadId: inlineReplay.loadId + 1,
    riders,
    sampleInterval,
    maxTime,
    watchingPosition: findWatchedRider(riders)?.position ?? null,
    time: Math.min(inlineReplay.time, maxTime),
  });
  renderInlineReplay();
}

function resetInlineRace(raceKey) {
  unmountInlineView();
  Object.assign(inlineReplay, {
    raceKey,
    loadId: inlineReplay.loadId + 1,
    riders: [],
    time: 0,
    hoveredId: null,
  });
}

async function loadInlineRace(raceKey) {
  if (raceKey !== inlineReplay.raceKey) resetInlineRace(raceKey);
  const { loadId } = inlineReplay;
  const race = await getExistingRaceData(raceKey);
  if (loadId === inlineReplay.loadId) applyInlineRace(race);
  return raceKey === inlineReplay.raceKey;
}

function reportInlineError(error) {
  console.log(`[ZP Replay] Inline replay failed: ${error.message}`);
}

function refreshInlineReplay(raceKey) {
  if (raceKey !== inlineReplay.raceKey) loadInlineRace(raceKey).catch(reportInlineError);
  else if (!isInlineViewCurrent(findProfileTarget())) renderInlineReplay();
}

function handleInlineRacesChanged(races) {
  if (inlineReplay.raceKey) applyInlineRace(races?.[inlineReplay.raceKey]);
}

function revealInlineReplay(view) {
  view.graph.scrollIntoView({ behavior: 'smooth', block: 'center' });
  view.bar.play.focus({ preventScroll: true });
}

async function startInlineReplay(raceKey) {
  if (!(await loadInlineRace(raceKey))) return;

  const { view } = inlineReplay;
  if (!view) {
    requestOpenReplay(raceKey);
    return;
  }
  revealInlineReplay(view);
  playInline();
}

function watchInlineReplay(raceKey) {
  if (!findProfileTarget()) return false;
  startInlineReplay(raceKey).catch(reportInlineError);
  return true;
}

registerReplayViewer({
  refresh: refreshInlineReplay,
  racesChanged: handleInlineRacesChanged,
  watch: watchInlineReplay,
});
