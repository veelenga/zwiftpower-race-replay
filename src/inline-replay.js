const INLINE_GRAPH_SELECTOR = '#segment_graph';
const INLINE_PLOT_SELECTOR = 'rect.highcharts-plot-background';
const INLINE_PATH_SELECTOR = 'path.highcharts-graph';
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
const INLINE_EDGE_INSET_PX = 4;
const INLINE_EDGE_BOTTOM_PX = 6;
const INLINE_PROFILE_ATTRIBUTE = 'data-zp-profile';
const INLINE_SPEEDS = [1, 5, 10, 30];
const INLINE_DEFAULT_SPEED = 10;

const inlineReplay = {
  raceKey: null,
  loadId: 0,
  riders: [],
  selectedId: null,
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

function readProfile(graph) {
  return parseProfileGeometry(parseJsonOrUndefined(graph.getAttribute(INLINE_PROFILE_ATTRIBUTE)));
}

function measureAxis({ graph, path }, toLayer) {
  const profile = readProfile(graph);
  const chartMatrix = path.ownerSVGElement?.getScreenCTM();
  if (!profile || !chartMatrix) return null;
  return { ...profile, ...transformPlotBox(profile, toLayer.multiply(chartMatrix)) };
}

function measureProfile(view) {
  const layerMatrix = view.layer.getScreenCTM();
  const pathMatrix = view.path.getScreenCTM();
  const length = view.path.getTotalLength();
  if (!layerMatrix || !pathMatrix || !(length > 0)) return null;

  const toLayer = layerMatrix.inverse();
  const { xs, ys } = samplePath(view.path, length, toLayer.multiply(pathMatrix));
  const axis = measureAxis(view, toLayer);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  return {
    firstX,
    lastX,
    minX: axis ? axis.plotLeft : firstX,
    maxX: axis ? axis.plotLeft + axis.plotWidth : lastX,
    curveY: buildCurveLookup(xs, ys),
    axis,
  };
}

function updateInlineCourseKm(view) {
  const profileCourseKm = view.geometry?.axis?.courseKm || view.pageCourseKm;
  inlineReplay.courseKm = resolveCourseKm(profileCourseKm, inlineReplay.riders);
}

function positionEdgeCount(edge, x, y) {
  edge.element.setAttribute('x', String(x));
  edge.element.setAttribute('y', String(y));
}

function positionEdgeCounts({ edges, geometry }) {
  const axis = geometry?.axis;
  if (!axis) return;
  const y = axis.plotTop + axis.plotHeight - INLINE_EDGE_BOTTOM_PX;
  positionEdgeCount(edges.behind, axis.plotLeft + INLINE_EDGE_INSET_PX, y);
  positionEdgeCount(edges.ahead, axis.plotLeft + axis.plotWidth - INLINE_EDGE_INSET_PX, y);
}

function updateInlineGeometry(view) {
  view.geometry = measureProfile(view);
  updateInlineCourseKm(view);
  positionEdgeCounts(view);
}

function refreshInlineGeometry() {
  const { view } = inlineReplay;
  if (!view) return;
  updateInlineGeometry(view);
  renderInlineFrame();
}

function observeProfileChanges(view) {
  const refreshSoon = debounce(refreshInlineGeometry, INLINE_GEOMETRY_DELAY_MS);
  const observer = new MutationObserver(() => refreshSoon());
  observer.observe(view.graph, { attributes: true, attributeFilter: [INLINE_PROFILE_ATTRIBUTE] });
  observer.observe(view.path, { attributes: true, attributeFilter: ['d'] });
  view.observers.push(observer);
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

function handleDotClick(event) {
  const zwiftId = dotIdFrom(event.target);
  if (zwiftId) selectWatchedRider(zwiftId);
}

function handleDotKeydown(event) {
  const zwiftId = event.key === 'Enter' ? dotIdFrom(event.target) : null;
  if (!zwiftId) return;
  event.preventDefault();
  selectWatchedRider(zwiftId);
}

function createInlineLayer() {
  const layer = createSvgElement('svg', 'zp-replay-layer');
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Race replay riders');
  layer.addEventListener('keydown', handleInlineKeydown);
  layer.addEventListener('keydown', handleDotKeydown);
  layer.addEventListener('click', handleDotClick);
  layer.addEventListener('mouseover', event => hoverInlineDot(dotIdFrom(event.target)));
  layer.addEventListener('mouseout', event => hoverInlineDot(dotIdFrom(event.relatedTarget)));
  layer.addEventListener('focusin', event => hoverInlineDot(dotIdFrom(event.target)));
  layer.addEventListener('focusout', event => hoverInlineDot(dotIdFrom(event.relatedTarget)));
  return layer;
}

function setSvgVisible(item, visible) {
  if (item.visible === visible) return;
  item.visible = visible;
  if (visible) item.element.removeAttribute('display');
  else item.element.setAttribute('display', 'none');
}

function createEdgeCount(side, anchor) {
  const element = createSvgElement('text', `zp-replay-edge-count zp-replay-edge-count-${side}`);
  const text = document.createTextNode('');
  const edge = { element, text, visible: true };
  element.setAttribute('text-anchor', anchor);
  element.append(text);
  setSvgVisible(edge, false);
  return edge;
}

function createEdgeCounts(layer) {
  const edges = { behind: createEdgeCount('behind', 'start'), ahead: createEdgeCount('ahead', 'end') };
  layer.append(edges.behind.element, edges.ahead.element);
  return edges;
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

function createWatchSelect() {
  const element = createControlElement('label', 'zp-replay-watch');
  const caption = createControlElement('span', 'zp-replay-watch-caption');
  const select = createControlElement('select', 'zp-replay-watch-select');
  caption.textContent = 'Watching';
  select.addEventListener('change', () => selectWatchedRider(select.value));
  element.append(caption, select);
  return { element, select, options: new Map() };
}

function createInlineBar() {
  const element = createControlElement('div', 'zp-replay-bar');
  const controls = createControlElement('div', 'zp-replay-bar-row');
  const details = createControlElement('div', 'zp-replay-bar-row');
  const play = createControlButton('zp-replay-play', toggleInlinePlayback);
  const time = createTextSlot('span', 'zp-replay-time');
  const scrubber = createInlineScrubber();
  const speeds = createInlineSpeedButtons();
  const watch = createWatchSelect();
  const stats = createTextSlot('span', 'zp-replay-stats');
  const open = createControlButton('zp-replay-link zp-replay-open', openFullInlineReplay);

  open.textContent = 'Open full replay';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Race replay');
  element.addEventListener('keydown', handleInlineKeydown);
  controls.append(play, time.element, scrubber, speeds.element);
  details.append(watch.element, stats.element, open);
  element.append(controls, details);
  return { element, play, time, scrubber, speedButtons: speeds.buttons, watch, stats };
}

function mountInlineView({ graph, path, plot }) {
  const layer = createInlineLayer();
  const view = {
    graph,
    path,
    plot,
    layer,
    edges: createEdgeCounts(layer),
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
  updateInlineGeometry(view);
  observeProfileChanges(view);
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
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', rider.name);
  element.dataset.zwiftId = rider.zwiftId;
  element.append(circle);
  return { element, circle, label: null, role: null, transform: null, anchor: null, visible: true, x: 0, y: 0 };
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

function findInlineWatchedRider() {
  return inlineReplay.riders.find(rider => rider.position === inlineReplay.watchingPosition) || null;
}

function raiseWatchedDot(view) {
  const watched = findInlineWatchedRider();
  const element = watched && view.dots.get(watched.zwiftId).element;
  if (!element || view.layer.lastElementChild === element) return;

  const hadFocus = document.activeElement === element;
  view.layer.append(element);
  if (hadFocus) element.focus({ preventScroll: true });
}

function syncInlineDots(view) {
  const { riders, watchingPosition } = inlineReplay;
  removeStaleDots(view, new Set(riders.map(rider => rider.zwiftId)));

  riders.forEach(rider => {
    const dot = view.dots.get(rider.zwiftId) || addRiderDot(view, rider);
    const isWatched = rider.position === watchingPosition;
    dot.element.setAttribute('aria-pressed', String(isWatched));
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

function standingCourseKm(standing) {
  const { courseKm } = inlineReplay;
  return standing.finished ? courseKm : clamp(standing.currentDistance, 0, courseKm);
}

function placeStanding(standing, geometry) {
  const distanceKm = standingCourseKm(standing);
  const { axis } = geometry;
  if (!axis) {
    return { side: 'visible', x: distanceToProfileX(distanceKm, geometry.firstX, geometry.lastX, inlineReplay.courseKm) };
  }
  return { side: classifyAxisDistance(distanceKm, axis), x: mapDistanceToAxisX(distanceKm, axis) };
}

function applyDotRole(dot, role) {
  if (dot.role === role) return;
  dot.role = role;
  dot.element.setAttribute('class', `${INLINE_DOT_CLASS} ${INLINE_DOT_CLASS}-${role}`);
  dot.circle.setAttribute('r', String(INLINE_DOT_RADII[role]));
}

function applyLabelAnchor(dot, geometry) {
  const anchor = alignNearEdges(dot.x, geometry.minX, geometry.maxX, INLINE_LABEL_EDGE_PX);
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

function renderEdgeCount(edge, count) {
  setSvgVisible(edge, count > 0);
  if (count > 0) setSlotText(edge, `+${count}`);
}

function renderInlineDots(view, snapshot) {
  const { geometry } = view;
  if (!geometry?.curveY) return;

  const hidden = { behind: 0, ahead: 0 };
  snapshot.standings.forEach(standing => {
    const dot = view.dots.get(standing.zwiftId);
    if (!dot) return;
    const { side, x } = placeStanding(standing, geometry);
    setSvgVisible(dot, side === 'visible');
    if (side !== 'visible') {
      hidden[side]++;
      return;
    }
    applyDotRole(dot, riderMarkerRole(standing.position, snapshot.roleContext));
    applyDotPosition(dot, x, geometry.curveY(x), geometry);
  });
  renderEdgeCount(view.edges.behind, hidden.behind);
  renderEdgeCount(view.edges.ahead, hidden.ahead);
}

function tooltipTransform(dot, geometry) {
  const align = alignNearEdges(dot.x, geometry.minX, geometry.maxX, INLINE_TOOLTIP_EDGE_PX);
  const shiftY = dot.y < INLINE_TOOLTIP_FLIP_PX
    ? `${INLINE_TOOLTIP_GAP_PX}px`
    : `calc(-100% - ${INLINE_TOOLTIP_GAP_PX}px)`;
  return `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px) translate(${INLINE_TOOLTIP_SHIFTS[align]}, ${shiftY})`;
}

function hoveredStandingIndex(view, snapshot) {
  const dot = view.dots.get(inlineReplay.hoveredId);
  if (!dot?.transform || !dot.visible || !view.geometry) return -1;
  return snapshot.standings.findIndex(standing => standing.zwiftId === inlineReplay.hoveredId);
}

function watchedGapFor(index, { standings, you }) {
  const watchedIndex = standings.indexOf(you);
  if (watchedIndex < 0 || watchedIndex === index) return null;

  const ahead = index < watchedIndex;
  const [front, back] = ahead ? [standings[index], you] : [you, standings[index]];
  const seconds = calcStandingGap(front, back, inlineReplay.time, inlineReplay.sampleInterval);
  return { seconds, ahead, name: shortRiderName(you.name) };
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
    watchedGap: watchedGapFor(index, snapshot),
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

function removeStaleOptions(watch, riderIds) {
  watch.options.forEach((option, zwiftId) => {
    if (riderIds.has(zwiftId)) return;
    option.remove();
    watch.options.delete(zwiftId);
  });
}

function ensureWatchOption(watch, { value, label }) {
  if (!watch.options.has(value)) {
    const option = document.createElement('option');
    option.value = value;
    watch.options.set(value, option);
  }
  const option = watch.options.get(value);
  if (option.textContent !== label) option.textContent = label;
  return option;
}

function syncWatchOptions(watch) {
  const entries = buildWatchOptions(inlineReplay.riders);
  removeStaleOptions(watch, new Set(entries.map(entry => entry.value)));
  entries.forEach((entry, index) => {
    const option = ensureWatchOption(watch, entry);
    const current = watch.select.options[index];
    if (current !== option) watch.select.insertBefore(option, current || null);
  });
}

function renderWatchSelection(bar) {
  const watched = findInlineWatchedRider();
  syncWatchOptions(bar.watch);
  bar.watch.select.value = watched ? watched.zwiftId : '';
  bar.stats.element.title = watched ? watched.name : '';
}

function renderInlineBarSetup(bar) {
  bar.scrubber.max = String(Math.ceil(inlineReplay.maxTime));
  renderWatchSelection(bar);
  renderInlinePlayState();
  renderInlineSpeed();
}

function selectWatchedRider(zwiftId) {
  const rider = inlineReplay.riders.find(candidate => candidate.zwiftId === zwiftId);
  if (!rider) return;

  Object.assign(inlineReplay, { selectedId: zwiftId, watchingPosition: rider.position });
  const { view } = inlineReplay;
  if (!view) return;
  syncInlineDots(view);
  renderWatchSelection(view.bar);
  renderInlineFrame();
}

function renderInlineReplay() {
  if (!ensureInlineView()) return;

  const { view } = inlineReplay;
  syncInlineDots(view);
  updateInlineCourseKm(view);
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
    watchingPosition: resolveWatchedRider(riders, inlineReplay.selectedId)?.position ?? null,
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
    selectedId: null,
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
