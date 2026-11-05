const INLINE_GRAPH_SELECTOR = '#segment_graph';
const INLINE_PROFILE_ATTRIBUTE = 'data-zp-profile';
const INLINE_SVG_NS = 'http://www.w3.org/2000/svg';
const INLINE_HOST_CLASS = 'zp-replay-host';
const INLINE_DOT_CLASS = 'zp-replay-dot';
const INLINE_DOT_RADII = { you: 6.5, leader: 5, group: 4.5, muted: 3.5 };
const INLINE_LABEL_OFFSET_PX = 11;
const INLINE_LABEL_EDGE_PX = 80;
const INLINE_TOOLTIP_EDGE_PX = 90;
const INLINE_TOOLTIP_FLIP_PX = 56;
const INLINE_TOOLTIP_GAP_PX = 10;
const INLINE_TOOLTIP_SHIFTS = { start: '0%', middle: '-50%', end: '-100%' };
const INLINE_EDGE_INSET_PX = 4;
const INLINE_EDGE_BOTTOM_PX = 6;
const INLINE_HOVER_EVENTS = [
  ['mouseover', 'target'],
  ['focusin', 'target'],
  ['mouseout', 'relatedTarget'],
  ['focusout', 'relatedTarget'],
];
const INLINE_DEFAULT_SPEED = 10;

const inlineReplay = {
  raceKey: null,
  race: null,
  loadId: 0,
  riders: [],
  selectedId: null,
  sampleInterval: 1,
  maxTime: 0,
  maxTimeText: formatTime(0),
  time: 0,
  speed: INLINE_DEFAULT_SPEED,
  playing: false,
  frameId: null,
  lastFrameAt: null,
  hoveredId: null,
  lastSnapshot: null,
  view: null,
};

function createSvgElement(tagName, className) {
  const element = document.createElementNS(INLINE_SVG_NS, tagName);
  if (className) element.setAttribute('class', className);
  return element;
}

function createTextSlot(element) {
  const text = document.createTextNode('');
  element.append(text);
  return { element, text };
}

function setSlotText(slot, value) {
  if (slot.text.data !== value) slot.text.data = value;
}

function setIfChanged(element, attribute, value) {
  if (element.getAttribute(attribute) === value) return;
  if (value === null) element.removeAttribute(attribute);
  else element.setAttribute(attribute, value);
}

function readProfile(graph) {
  return graph ? JSON.parse(graph.getAttribute(INLINE_PROFILE_ATTRIBUTE)) : null;
}

function findProfileGraph() {
  const graph = document.querySelector(INLINE_GRAPH_SELECTOR);
  return readProfile(graph) ? graph : null;
}

function positionEdgeCounts({ edges, profile }) {
  if (!profile) return;
  const { plotLeft, plotTop, plotWidth, plotHeight } = profile;
  const y = String(plotTop + plotHeight - INLINE_EDGE_BOTTOM_PX);
  setIfChanged(edges.behind.element, 'x', String(plotLeft + INLINE_EDGE_INSET_PX));
  setIfChanged(edges.behind.element, 'y', y);
  setIfChanged(edges.ahead.element, 'x', String(plotLeft + plotWidth - INLINE_EDGE_INSET_PX));
  setIfChanged(edges.ahead.element, 'y', y);
}

function updateInlineProfile(view) {
  view.profile = readProfile(view.graph);
  positionEdgeCounts(view);
}

function refreshInlineProfile() {
  const { view } = inlineReplay;
  if (!view) return;
  updateInlineProfile(view);
  inlineReplay.lastSnapshot = null;
  renderInlineFrame();
}

function observeProfileChanges(view) {
  const observer = new MutationObserver(refreshInlineProfile);
  observer.observe(view.graph, { attributes: true, attributeFilter: [INLINE_PROFILE_ATTRIBUTE] });
  view.observers.push(observer);
}

function dotIdFrom(target) {
  return target?.closest?.(`.${INLINE_DOT_CLASS}`)?.dataset.zwiftId ?? null;
}

function hoverInlineDot(zwiftId) {
  if (inlineReplay.hoveredId === zwiftId) return;
  inlineReplay.hoveredId = zwiftId;
  const { view, lastSnapshot } = inlineReplay;
  if (view && lastSnapshot) renderInlineTooltip(view, lastSnapshot);
}

function handleInlineKeydown(event) {
  const action = resolveShortcut(event);
  switch (action?.type) {
    case 'togglePlay':
      toggleInlinePlayback();
      break;
    case 'seekBy':
      seekInline(inlineReplay.time + action.seconds);
      break;
    default:
      return;
  }
  event.preventDefault();
}

function activateDot(event) {
  if (event.type === 'keydown' && event.key !== 'Enter') return;
  const zwiftId = dotIdFrom(event.target);
  if (!zwiftId) return;
  event.preventDefault();
  selectWatchedRider(zwiftId);
}

function createInlineLayer() {
  const layer = createSvgElement('svg', 'zp-replay-layer');
  layer.setAttribute('role', 'group');
  layer.setAttribute('aria-label', 'Race replay riders');
  layer.addEventListener('keydown', handleInlineKeydown);
  layer.addEventListener('keydown', activateDot);
  layer.addEventListener('click', activateDot);
  INLINE_HOVER_EVENTS.forEach(([type, key]) => {
    layer.addEventListener(type, event => hoverInlineDot(dotIdFrom(event[key])));
  });
  return layer;
}

function createEdgeCount(side, anchor) {
  const edge = createTextSlot(createSvgElement('text', `zp-replay-edge-count zp-replay-edge-count-${side}`));
  edge.element.setAttribute('text-anchor', anchor);
  edge.element.setAttribute('display', 'none');
  return edge;
}

function createEdgeCounts(layer) {
  const edges = { behind: createEdgeCount('behind', 'start'), ahead: createEdgeCount('ahead', 'end') };
  layer.append(edges.behind.element, edges.ahead.element);
  return edges;
}

function createWatchLabel() {
  const label = createTextSlot(createSvgElement('text', 'zp-replay-dot-label'));
  label.element.setAttribute('y', String(-INLINE_LABEL_OFFSET_PX));
  return label;
}

function createInlineTooltip() {
  const element = createControlElement('div', 'zp-replay-tooltip');
  const name = createTextSlot(createControlElement('div', 'zp-replay-tooltip-name'));
  const stats = createTextSlot(createControlElement('div', 'zp-replay-tooltip-stats'));
  element.append(name.element, stats.element);
  element.hidden = true;
  return { element, name, stats };
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
  const buttons = PLAYBACK_SPEEDS.map(speed => {
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
  return { element, select };
}

function createInlineBar() {
  const element = createControlElement('div', 'zp-replay-bar');
  const controls = createControlElement('div', 'zp-replay-bar-row');
  const details = createControlElement('div', 'zp-replay-bar-row');
  const play = createControlButton('zp-replay-play', toggleInlinePlayback);
  const time = createTextSlot(createControlElement('span', 'zp-replay-time'));
  const scrubber = createInlineScrubber();
  const speeds = createInlineSpeedButtons();
  const watch = createWatchSelect();
  const stats = createTextSlot(createControlElement('span', 'zp-replay-stats'));
  const open = createControlButton('zp-replay-link zp-replay-open', openFullInlineReplay);

  open.textContent = 'Open full replay';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Race replay');
  element.addEventListener('keydown', handleInlineKeydown);
  controls.append(play, time.element, scrubber, speeds.element);
  details.append(watch.element, stats.element, open);
  element.append(controls, details);
  return { element, play, time, scrubber, speedButtons: speeds.buttons, watchSelect: watch.select, stats };
}

function mountInlineView(graph) {
  const layer = createInlineLayer();
  const view = {
    graph,
    layer,
    edges: createEdgeCounts(layer),
    label: createWatchLabel(),
    tooltip: createInlineTooltip(),
    bar: createInlineBar(),
    dots: new Map(),
    observers: [],
    profile: null,
    renderedSnapshot: null,
  };

  graph.classList.add(INLINE_HOST_CLASS);
  graph.append(view.layer, view.tooltip.element);
  graph.after(view.bar.element);
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

function isInlineViewCurrent(graph) {
  const { view } = inlineReplay;
  return Boolean(view && graph) &&
    view.graph === graph &&
    view.layer.isConnected &&
    view.bar.element.isConnected;
}

function ensureInlineView() {
  const graph = inlineReplay.riders.length > 0 ? findProfileGraph() : null;
  if (!graph) {
    unmountInlineView();
    return false;
  }
  if (!isInlineViewCurrent(graph)) {
    unmountInlineView();
    mountInlineView(graph);
  }
  return true;
}

function inlineWatchedRider() {
  return resolveWatchedRider(inlineReplay.riders, inlineReplay.selectedId);
}

function createRiderDot(rider) {
  const element = createSvgElement('g', INLINE_DOT_CLASS);
  const circle = createSvgElement('circle');
  element.setAttribute('role', 'button');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', rider.name);
  element.dataset.zwiftId = rider.zwiftId;
  element.append(circle);
  return { element, circle, x: null, y: null };
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

function raiseDot(view, dot) {
  if (view.layer.lastElementChild === dot.element) return;
  const hadFocus = document.activeElement === dot.element;
  view.layer.append(dot.element);
  if (hadFocus) dot.element.focus({ preventScroll: true });
}

function unmarkWatchedDot(view, rider) {
  const dot = rider && view.dots.get(rider.zwiftId);
  if (dot) setIfChanged(dot.element, 'aria-pressed', 'false');
}

function markWatchedDot(view, rider) {
  const dot = rider && view.dots.get(rider.zwiftId);
  if (!dot) {
    view.label.element.remove();
    return;
  }
  setIfChanged(dot.element, 'aria-pressed', 'true');
  setSlotText(view.label, rider.name);
  if (view.label.element.parentNode !== dot.element) dot.element.append(view.label.element);
  raiseDot(view, dot);
}

function syncInlineDots(view, watched) {
  const { riders } = inlineReplay;
  removeStaleDots(view, new Set(riders.map(rider => rider.zwiftId)));
  riders.forEach(rider => {
    const dot = view.dots.get(rider.zwiftId) || addRiderDot(view, rider);
    setIfChanged(dot.element, 'aria-pressed', String(rider.zwiftId === watched?.zwiftId));
  });
  markWatchedDot(view, watched);
}

function computeInlineSnapshot(index) {
  const { riders, time, sampleInterval } = inlineReplay;
  const watched = inlineWatchedRider();
  const standings = computeRaceStandings(riders, time, sampleInterval);
  const groups = detectGroups(standings, time, watched?.position, sampleInterval);
  const ranks = new Map(standings.map((standing, rank) => [standing.rider.zwiftId, rank]));
  const yourGroupIndex = groups.findIndex(group => group.hasYou);
  return {
    index,
    time,
    standings,
    groups,
    ranks,
    youIndex: watched ? ranks.get(watched.zwiftId) : -1,
    yourGroupIndex,
    roleContext: {
      watchedId: watched?.zwiftId,
      leaderId: standings[0]?.rider.zwiftId,
      groupIds: new Set((groups[yourGroupIndex]?.riders || []).map(standing => standing.rider.zwiftId)),
    },
  };
}

function inlineSnapshot() {
  const index = timeToIndex(inlineReplay.time, inlineReplay.sampleInterval);
  if (inlineReplay.lastSnapshot?.index !== index) inlineReplay.lastSnapshot = computeInlineSnapshot(index);
  return inlineReplay.lastSnapshot;
}

function placeStanding(standing, profile) {
  const { courseKm, plotLeft, ys } = profile;
  const distanceKm = standing.finished ? courseKm : clamp(standing.currentDistance, 0, courseKm);
  const x = mapDistanceToAxisX(distanceKm, profile);
  const y = ys[clamp(Math.round(x - plotLeft), 0, ys.length - 1)];
  return { side: classifyAxisDistance(distanceKm, profile), x, y };
}

function axisAlignment(x, { plotLeft, plotWidth }, marginPx) {
  return alignNearEdges(x, plotLeft, plotLeft + plotWidth, marginPx);
}

function renderDot(view, dot, role, { x, y }) {
  Object.assign(dot, { x, y });
  setIfChanged(dot.element, 'display', null);
  setIfChanged(dot.element, 'class', `${INLINE_DOT_CLASS} ${INLINE_DOT_CLASS}-${role}`);
  setIfChanged(dot.circle, 'r', String(INLINE_DOT_RADII[role]));
  setIfChanged(dot.element, 'transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  if (role === 'you') {
    setIfChanged(view.label.element, 'text-anchor', axisAlignment(x, view.profile, INLINE_LABEL_EDGE_PX));
  }
}

function renderEdgeCount(edge, count) {
  setIfChanged(edge.element, 'display', count > 0 ? null : 'none');
  if (count > 0) setSlotText(edge, `+${count}`);
}

function renderInlineDots(view, snapshot) {
  const { profile } = view;
  if (!profile) return;

  const hidden = { behind: 0, ahead: 0 };
  snapshot.standings.forEach(standing => {
    const dot = view.dots.get(standing.rider.zwiftId);
    if (!dot) return;
    const point = placeStanding(standing, profile);
    if (point.side === 'visible') {
      renderDot(view, dot, riderMarkerRole(standing.rider.zwiftId, snapshot.roleContext), point);
      return;
    }
    setIfChanged(dot.element, 'display', 'none');
    hidden[point.side]++;
  });
  renderEdgeCount(view.edges.behind, hidden.behind);
  renderEdgeCount(view.edges.ahead, hidden.ahead);
}

function tooltipTransform(dot, axis) {
  const align = axisAlignment(dot.x, axis, INLINE_TOOLTIP_EDGE_PX);
  const shiftY = dot.y < INLINE_TOOLTIP_FLIP_PX
    ? `${INLINE_TOOLTIP_GAP_PX}px`
    : `calc(-100% - ${INLINE_TOOLTIP_GAP_PX}px)`;
  return `translate(${dot.x.toFixed(1)}px, ${dot.y.toFixed(1)}px) translate(${INLINE_TOOLTIP_SHIFTS[align]}, ${shiftY})`;
}

function isDotShown(dot) {
  return Boolean(dot) && dot.x !== null && dot.element.getAttribute('display') !== 'none';
}

function hoveredStandingIndex(view, snapshot) {
  if (!view.profile || !isDotShown(view.dots.get(inlineReplay.hoveredId))) return -1;
  return snapshot.ranks.get(inlineReplay.hoveredId) ?? -1;
}

function watchedGapFor(index, { standings, youIndex, time }) {
  if (youIndex < 0 || youIndex === index) return null;

  const you = standings[youIndex];
  const ahead = index < youIndex;
  const [front, back] = ahead ? [standings[index], you] : [you, standings[index]];
  const seconds = calcStandingGap(front, back, time, inlineReplay.sampleInterval);
  return { seconds, ahead, name: shortRiderName(you.rider.name) };
}

function renderInlineTooltip(view, snapshot) {
  const { tooltip } = view;
  const index = hoveredStandingIndex(view, snapshot);
  setIfChanged(tooltip.element, 'hidden', index < 0 ? '' : null);
  if (index < 0) return;

  const standing = snapshot.standings[index];
  setSlotText(tooltip.name, standing.rider.name);
  setSlotText(tooltip.stats, buildRiderStatsText({
    rank: index + 1,
    power: standing.currentPower,
    gapToLeader: calcStandingGap(snapshot.standings[0], standing, snapshot.time, inlineReplay.sampleInterval),
    watchedGap: watchedGapFor(index, snapshot),
  }));
  const transform = tooltipTransform(view.dots.get(standing.rider.zwiftId), view.profile);
  setIfChanged(tooltip.element, 'style', `transform: ${transform}`);
}

function watchedStatsText({ standings, groups, youIndex, yourGroupIndex, time }) {
  if (youIndex < 0) return '';
  const { sampleInterval } = inlineReplay;
  const [leader] = standings;
  const you = standings[youIndex];
  return buildRiderStatsText({
    rank: youIndex + 1,
    power: you.currentPower,
    leaderPower: leader.currentPower,
    gapToLeader: calcStandingGap(leader, you, time, sampleInterval),
    gapToGroup: calcGapToGroupAhead(groups, yourGroupIndex, you, time, sampleInterval),
  });
}

function renderInlineTime({ bar }) {
  const { time, maxTimeText } = inlineReplay;
  const timeText = `${formatTime(time)} / ${maxTimeText}`;
  if (bar.time.text.data === timeText) return;
  bar.time.text.data = timeText;
  bar.scrubber.value = String(Math.floor(time));
  bar.scrubber.setAttribute('aria-valuetext', formatTime(time));
}

function renderInlineFrame() {
  const { view } = inlineReplay;
  if (!view || inlineReplay.riders.length === 0) return;

  const snapshot = inlineSnapshot();
  if (view.renderedSnapshot !== snapshot) {
    view.renderedSnapshot = snapshot;
    renderInlineDots(view, snapshot);
    renderInlineTooltip(view, snapshot);
    setSlotText(view.bar.stats, watchedStatsText(snapshot));
  }
  renderInlineTime(view);
}

function renderInlinePlayState() {
  const play = inlineReplay.view?.bar.play;
  if (!play) return;
  const label = inlineReplay.playing ? 'Pause' : 'Play';
  if (play.textContent !== label) play.textContent = label;
}

function renderInlineSpeed() {
  inlineReplay.view?.bar.speedButtons.forEach((button, index) => {
    setIfChanged(button, 'aria-pressed', String(PLAYBACK_SPEEDS[index] === inlineReplay.speed));
  });
}

function createWatchOption({ value, label }) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  return option;
}

function renderWatchedRider(bar, watched) {
  bar.watchSelect.value = watched ? watched.zwiftId : '';
  bar.stats.element.title = watched ? watched.name : '';
}

function renderInlineRace(view, watched) {
  view.bar.watchSelect.replaceChildren(...buildWatchOptions(inlineReplay.riders).map(createWatchOption));
  view.bar.scrubber.max = String(Math.ceil(inlineReplay.maxTime));
  renderWatchedRider(view.bar, watched);
  renderInlinePlayState();
  renderInlineSpeed();
}

function selectWatchedRider(zwiftId) {
  const next = inlineReplay.riders.find(rider => rider.zwiftId === zwiftId);
  if (!next) return;

  const previous = inlineWatchedRider();
  Object.assign(inlineReplay, { selectedId: zwiftId, lastSnapshot: null });
  const { view } = inlineReplay;
  if (!view) return;
  if (previous && previous !== next) unmarkWatchedDot(view, previous);
  markWatchedDot(view, next);
  renderWatchedRider(view.bar, next);
  renderInlineFrame();
}

function renderInlineReplay() {
  if (!ensureInlineView()) return;

  const { view } = inlineReplay;
  const watched = inlineWatchedRider();
  syncInlineDots(view, watched);
  updateInlineProfile(view);
  renderInlineRace(view, watched);
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

function setInlineRace(raceKey, race) {
  const isNewRace = raceKey !== inlineReplay.raceKey;
  const riders = (race?.riders || []).filter(rider => rider.distance?.length > 0);
  const sampleInterval = riders[0]?.sampleInterval || 1;
  const maxTime = calcRaceDuration(riders, sampleInterval);

  if (isNewRace) unmountInlineView();
  Object.assign(inlineReplay, {
    raceKey,
    race,
    riders,
    sampleInterval,
    maxTime,
    maxTimeText: formatTime(maxTime),
    lastSnapshot: null,
    selectedId: isNewRace ? null : inlineReplay.selectedId,
    hoveredId: isNewRace ? null : inlineReplay.hoveredId,
    time: isNewRace ? 0 : Math.min(inlineReplay.time, maxTime),
  });
  renderInlineReplay();
}

async function loadInlineRace(raceKey) {
  const loadId = ++inlineReplay.loadId;
  const race = await getExistingRaceData(raceKey);
  const isLatest = loadId === inlineReplay.loadId;
  if (isLatest) setInlineRace(raceKey, race);
  return isLatest;
}

function reportInlineError(error) {
  console.log(`[ZP Replay] Inline replay failed: ${error.message}`);
}

function refreshInlineReplay(raceKey) {
  if (!raceKey) return;
  if (raceKey !== inlineReplay.raceKey) loadInlineRace(raceKey).catch(reportInlineError);
  else if (!isInlineViewCurrent(findProfileGraph())) renderInlineReplay();
}

function handleInlineRacesChanged(races) {
  const { raceKey } = inlineReplay;
  const race = races?.[raceKey];
  if (raceKey && !isSameSyncedRace(race, inlineReplay.race)) setInlineRace(raceKey, race);
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
  if (!findProfileGraph()) return false;
  startInlineReplay(raceKey).catch(reportInlineError);
  return true;
}

refreshInlineReplay(currentReplayRaceKey());
