const INLINE_GRAPH_SELECTOR = '#segment_graph';
const INLINE_PROFILE_ATTRIBUTE = 'data-zp-profile';
const INLINE_HOST_CLASS = 'zp-replay-host';
const INLINE_DEFAULT_SPEED = 10;
const INLINE_TOOLTIP_EDGE_PX = 90;
const INLINE_TOOLTIP_FLIP_PX = 56;
const INLINE_TOOLTIP_GAP_PX = 10;
const INLINE_DOT_SPACING_PX = 12;
const INLINE_LANE_STEP_PX = 12;
const INLINE_MAX_LANES = 3;
const INLINE_HOVER_EVENTS = [
  ['mouseover', 'target'],
  ['focusin', 'target'],
  ['mouseout', 'relatedTarget'],
  ['focusout', 'relatedTarget'],
];
const INLINE_LAYER_TEMPLATE = `
  <div class="zp-replay-tooltip" hidden>
    <div class="zp-replay-tooltip-name"></div>
    <div class="zp-replay-tooltip-stats"></div>
  </div>
  <span class="zp-replay-edge-count zp-replay-edge-count-behind" hidden></span>
  <span class="zp-replay-edge-count zp-replay-edge-count-ahead" hidden></span>`;
const INLINE_BAR_TEMPLATE = `
  <div class="zp-replay-bar-row">
    <button type="button" class="zp-replay-button zp-replay-play">Play</button>
    <span class="zp-replay-time"></span>
    <input type="range" class="zp-replay-scrubber" min="0" step="1" value="0" aria-label="Race time">
    <div class="zp-replay-speeds" role="group" aria-label="Playback speed">
      ${PLAYBACK_SPEEDS.map(speed => `<button type="button" class="zp-replay-speed" data-speed="${speed}">${speed}x</button>`).join('')}
    </div>
  </div>
  <div class="zp-replay-bar-row">
    <label class="zp-replay-watch">Watching <select class="zp-replay-watch-select"></select></label>
    <span class="zp-replay-stats"></span>
  </div>
  <div class="zp-replay-groups" aria-label="Groups"></div>`;

const inlineReplay = {
  raceKey: null,
  riders: [],
  selectedId: null,
  sampleInterval: 1,
  maxTime: 0,
  time: 0,
  speed: INLINE_DEFAULT_SPEED,
  frameId: null,
  hoveredId: null,
  hoveredGroup: null,
  view: null,
};

function readProfile(graph) {
  return graph && JSON.parse(graph.getAttribute(INLINE_PROFILE_ATTRIBUTE));
}

function dotIdFrom(target) {
  return target?.closest?.('.zp-replay-dot')?.dataset.zwiftId ?? null;
}

function hoverInlineDot(zwiftId) {
  inlineReplay.hoveredId = zwiftId;
  renderInlineFrame();
}

function groupChipFrom(target) {
  return target?.closest?.('.zp-replay-group[data-group]') ?? null;
}

function hoverGroupChip(chip) {
  inlineReplay.hoveredGroup = chip ? Number(chip.dataset.group) : null;
  renderInlineFrame();
}

function handleInlineKeydown(event) {
  const action = resolveShortcut(event);
  if (action?.type === 'togglePlay') setInlinePlaying(inlineReplay.frameId === null);
  else if (action?.type === 'seekBy') seekInline(inlineReplay.time + action.seconds);
  else return;
  event.preventDefault();
}

function createInlineLayer() {
  const layer = document.createElement('div');
  layer.className = 'zp-replay-layer';
  layer.innerHTML = INLINE_LAYER_TEMPLATE;
  layer.addEventListener('click', event => {
    const zwiftId = dotIdFrom(event.target);
    if (zwiftId) selectWatchedRider(zwiftId);
  });
  INLINE_HOVER_EVENTS.forEach(([type, key]) => {
    layer.addEventListener(type, event => hoverInlineDot(dotIdFrom(event[key])));
  });
  return layer;
}

function createInlineBar() {
  const element = document.createElement('div');
  element.className = 'zp-replay-bar';
  element.tabIndex = -1;
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Race replay');
  element.innerHTML = INLINE_BAR_TEMPLATE;
  const part = selector => element.querySelector(selector);
  const bar = {
    element,
    play: part('.zp-replay-play'),
    time: part('.zp-replay-time'),
    scrubber: part('.zp-replay-scrubber'),
    speeds: [...element.querySelectorAll('[data-speed]')],
    select: part('.zp-replay-watch-select'),
    stats: part('.zp-replay-stats'),
    groups: part('.zp-replay-groups'),
    groupsMarkup: '',
  };
  bar.play.addEventListener('click', () => setInlinePlaying(inlineReplay.frameId === null));
  bar.scrubber.addEventListener('input', () => seekInline(Number(bar.scrubber.value)));
  bar.select.addEventListener('change', () => selectWatchedRider(bar.select.value));
  element.addEventListener('click', event => {
    const speed = event.target.closest('[data-speed]')?.dataset.speed;
    const chip = groupChipFrom(event.target);
    if (speed) setInlineSpeed(Number(speed));
    else if (chip) selectWatchedRider(chip.dataset.zwiftId);
  });
  INLINE_HOVER_EVENTS.forEach(([type, key]) => {
    bar.groups.addEventListener(type, event => hoverGroupChip(groupChipFrom(event[key])));
  });
  element.addEventListener('keydown', handleInlineKeydown);
  return bar;
}

function mountInlineView(graph) {
  const layer = createInlineLayer();
  const part = selector => layer.querySelector(selector);
  const view = {
    graph,
    layer,
    profile: null,
    tooltip: part('.zp-replay-tooltip'),
    tooltipName: part('.zp-replay-tooltip-name'),
    tooltipStats: part('.zp-replay-tooltip-stats'),
    behind: part('.zp-replay-edge-count-behind'),
    ahead: part('.zp-replay-edge-count-ahead'),
    bar: createInlineBar(),
    dots: new Map(),
    observer: new MutationObserver(() => renderInlineReplay()),
  };
  graph.classList.add(INLINE_HOST_CLASS);
  graph.append(layer);
  graph.after(view.bar.element);
  view.observer.observe(graph, { attributes: true, attributeFilter: [INLINE_PROFILE_ATTRIBUTE] });
  inlineReplay.view = view;
  setInlineSpeed(inlineReplay.speed);
}

function unmountInlineView() {
  const { view } = inlineReplay;
  if (!view) return;
  setInlinePlaying(false);
  view.observer.disconnect();
  view.layer.remove();
  view.bar.element.remove();
  view.graph.classList.remove(INLINE_HOST_CLASS);
  inlineReplay.view = null;
}

function isInlineViewCurrent(graph) {
  const { view } = inlineReplay;
  return view?.graph === graph && view.layer.isConnected && view.bar.element.isConnected;
}

function ensureInlineView() {
  const graph = document.querySelector(INLINE_GRAPH_SELECTOR);
  const profile = inlineReplay.riders.length > 0 && readProfile(graph);
  if (!profile) {
    unmountInlineView();
    return false;
  }
  if (!isInlineViewCurrent(graph)) {
    unmountInlineView();
    mountInlineView(graph);
  }
  const { view } = inlineReplay;
  view.profile = profile;
  Object.assign(view.layer.style, {
    left: `${profile.plotLeft}px`,
    top: `${profile.plotTop}px`,
    width: `${profile.plotWidth}px`,
    height: `${profile.plotHeight}px`,
  });
  return true;
}

function syncInlineDots(view) {
  inlineReplay.riders.filter(rider => !view.dots.has(rider.zwiftId)).forEach(rider => {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'zp-replay-dot';
    dot.dataset.zwiftId = rider.zwiftId;
    dot.dataset.label = rider.name;
    dot.setAttribute('aria-label', rider.name);
    view.layer.append(dot);
    view.dots.set(rider.zwiftId, dot);
  });
}

function inlineSnapshot() {
  const { riders, time, sampleInterval, selectedId } = inlineReplay;
  const watched = resolveWatchedRider(riders, selectedId);
  const standings = computeRaceStandings(riders, time, sampleInterval);
  const groups = detectGroups(standings, time, watched?.position, sampleInterval);
  const yourGroupIndex = groups.findIndex(group => group.hasYou);
  const idsOf = group => new Set(group?.riders.map(standing => standing.rider.zwiftId));
  return {
    time,
    standings,
    groups,
    yourGroupIndex,
    youIndex: standings.findIndex(standing => standing.rider === watched),
    groupIds: idsOf(groups[yourGroupIndex]),
    hotIds: idsOf(groups[inlineReplay.hoveredGroup]),
  };
}

function placeStanding(standing, { xMin, xMax, plotWidth, plotTop, courseKm, ys }) {
  const km = standing.finished ? courseKm : clamp(standing.currentDistance, 0, courseKm);
  const x = ((km - xMin) / (xMax - xMin)) * plotWidth;
  const side = km < xMin ? 'behind' : km > xMax ? 'ahead' : null;
  return { side, x, y: ys[clamp(Math.round(x), 0, ys.length - 1)] - plotTop };
}

function dotRole(index, zwiftId, { youIndex, groupIds }) {
  if (index === youIndex) return 'you';
  if (index === 0) return 'leader';
  return groupIds.has(zwiftId) ? 'group' : 'muted';
}

function placeVisibleDots(view, snapshot) {
  const hidden = { behind: 0, ahead: 0 };
  const placed = [];
  snapshot.standings.forEach((standing, index) => {
    const point = placeStanding(standing, view.profile);
    if (point.side) hidden[point.side]++;
    else placed.push({ standing, index, role: dotRole(index, standing.rider.zwiftId, snapshot), ...point });
  });
  return { hidden, placed };
}

function renderInlineDots(view, snapshot) {
  const { hidden, placed } = placeVisibleDots(view, snapshot);
  const lanes = assignDotLanes(placed.map(dot => dot.x), INLINE_DOT_SPACING_PX, INLINE_MAX_LANES);
  view.dots.forEach(dot => { dot.hidden = true; });
  placed.forEach((dot, i) => {
    const { zwiftId } = dot.standing.rider;
    const element = view.dots.get(zwiftId);
    element.hidden = false;
    element.className = `zp-replay-dot zp-replay-dot-${dot.role}`;
    element.classList.toggle('zp-replay-dot-hot', snapshot.hotIds.has(zwiftId));
    element.style.transform = `translate(${dot.x}px, ${dot.y - lanes[i] * INLINE_LANE_STEP_PX}px)`;
  });
  Object.entries(hidden).forEach(([side, count]) => {
    view[side].hidden = count === 0;
    view[side].textContent = `+${count}`;
  });
}

function tooltipTransform({ x, y }, plotWidth) {
  const edgeShift = x > plotWidth - INLINE_TOOLTIP_EDGE_PX ? '-100%' : '-50%';
  const shiftX = x < INLINE_TOOLTIP_EDGE_PX ? '0%' : edgeShift;
  const shiftY = y < INLINE_TOOLTIP_FLIP_PX ? `${INLINE_TOOLTIP_GAP_PX}px` : `calc(-100% - ${INLINE_TOOLTIP_GAP_PX}px)`;
  return `translate(${x}px, ${y}px) translate(${shiftX}, ${shiftY})`;
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
  const index = snapshot.standings.findIndex(standing => standing.rider.zwiftId === inlineReplay.hoveredId);
  const standing = snapshot.standings[index];
  const point = standing && placeStanding(standing, view.profile);
  view.tooltip.hidden = !point || Boolean(point.side);
  if (view.tooltip.hidden) return;
  view.tooltipName.textContent = standing.rider.name;
  view.tooltipStats.textContent = buildRiderStatsText({
    rank: index + 1,
    power: standing.currentPower,
    gapToLeader: calcStandingGap(snapshot.standings[0], standing, snapshot.time, inlineReplay.sampleInterval),
    watchedGap: watchedGapFor(index, snapshot),
  });
  view.tooltip.style.transform = tooltipTransform(point, view.profile.plotWidth);
}

function watchedStatsText({ standings, groups, youIndex, yourGroupIndex, time }) {
  if (youIndex < 0) return '';
  const { sampleInterval } = inlineReplay;
  const you = standings[youIndex];
  return buildRiderStatsText({
    rank: youIndex + 1,
    power: you.currentPower,
    gapToLeader: calcStandingGap(standings[0], you, time, sampleInterval),
    gapToGroup: calcGapToGroupAhead(groups, yourGroupIndex, you, time, sampleInterval),
    ...nearestRiderGaps(standings, youIndex, time, sampleInterval),
  });
}

function groupChipMarkup(item) {
  const gap = item.gap > 0 ? `<span class="zp-replay-gap">${formatGapDuration(item.gap)}</span>` : '';
  if (item.type === 'fold') return `${gap}<span class="zp-replay-group zp-replay-group-fold">${escapeHtml(item.label)}</span>`;
  const role = item.isYou ? 'you' : item.index === 0 ? 'lead' : 'other';
  return `${gap}<button type="button" class="zp-replay-group zp-replay-group-${role}" data-group="${item.index}" data-zwift-id="${escapeHtml(item.zwiftId)}">${escapeHtml(item.label)}</button>`;
}

function renderGroupStrip({ bar }, { groups, yourGroupIndex, time }) {
  const markup = buildGroupStrip(groups, yourGroupIndex, time, inlineReplay.sampleInterval).map(groupChipMarkup).join('');
  if (markup === bar.groupsMarkup) return;
  bar.groupsMarkup = markup;
  bar.groups.innerHTML = markup;
}

function renderInlineFrame() {
  const { view, time, maxTime } = inlineReplay;
  if (!view) return;
  const snapshot = inlineSnapshot();
  renderInlineDots(view, snapshot);
  renderInlineTooltip(view, snapshot);
  renderGroupStrip(view, snapshot);
  view.bar.stats.textContent = watchedStatsText(snapshot);
  view.bar.time.textContent = `${formatTime(time)} / ${formatTime(maxTime)}`;
  view.bar.scrubber.value = String(Math.floor(time));
  view.bar.scrubber.setAttribute('aria-valuetext', formatTime(time));
}

function renderWatched({ bar }) {
  const watched = resolveWatchedRider(inlineReplay.riders, inlineReplay.selectedId);
  bar.select.value = watched?.zwiftId ?? '';
  bar.stats.title = watched?.name ?? '';
}

function renderInlineReplay() {
  if (!ensureInlineView()) return;
  const { view, riders, maxTime } = inlineReplay;
  syncInlineDots(view);
  view.bar.select.replaceChildren(...buildWatchOptions(riders).map(({ label, value }) => new Option(label, value)));
  view.bar.scrubber.max = String(Math.ceil(maxTime));
  renderWatched(view);
  renderInlineFrame();
}

function setInlinePlaying(playing) {
  cancelAnimationFrame(inlineReplay.frameId);
  inlineReplay.frameId = null;
  if (playing && inlineReplay.maxTime > 0) {
    if (inlineReplay.time >= inlineReplay.maxTime) inlineReplay.time = 0;
    let last = null;
    const tick = now => {
      inlineReplay.time = advancePlaybackTime(inlineReplay.time, now - (last ?? now), inlineReplay.speed, inlineReplay.maxTime);
      last = now;
      renderInlineFrame();
      if (inlineReplay.time < inlineReplay.maxTime) inlineReplay.frameId = requestAnimationFrame(tick);
      else setInlinePlaying(false);
    };
    inlineReplay.frameId = requestAnimationFrame(tick);
  }
  if (inlineReplay.view) inlineReplay.view.bar.play.textContent = inlineReplay.frameId === null ? 'Play' : 'Pause';
}

function seekInline(time) {
  inlineReplay.time = clamp(time, 0, inlineReplay.maxTime);
  renderInlineFrame();
}

function setInlineSpeed(speed) {
  inlineReplay.speed = speed;
  inlineReplay.view?.bar.speeds.forEach(button => {
    button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === speed));
  });
}

function selectWatchedRider(zwiftId) {
  inlineReplay.selectedId = zwiftId;
  renderWatched(inlineReplay.view);
  renderInlineFrame();
}

function setInlineRace(raceKey, race) {
  const isNewRace = raceKey !== inlineReplay.raceKey;
  const riders = (race?.riders || []).filter(rider => rider.distance?.length > 0);
  const sampleInterval = riders[0]?.sampleInterval || 1;
  const maxTime = Math.max(0, ...riders.map(rider => (rider.distance.length - 1) * sampleInterval));
  if (isNewRace) unmountInlineView();
  Object.assign(inlineReplay, {
    raceKey,
    riders,
    sampleInterval,
    maxTime,
    selectedId: isNewRace ? null : inlineReplay.selectedId,
    hoveredId: isNewRace ? null : inlineReplay.hoveredId,
    hoveredGroup: isNewRace ? null : inlineReplay.hoveredGroup,
    time: isNewRace ? 0 : Math.min(inlineReplay.time, maxTime),
  });
  renderInlineReplay();
}

async function loadInlineRace(raceKey) {
  const race = await getExistingRaceData(raceKey);
  const isActive = raceKey === replayControl.raceKey;
  if (isActive) setInlineRace(raceKey, race);
  return isActive;
}

function refreshInlineReplay(raceKey) {
  if (raceKey !== inlineReplay.raceKey) loadInlineRace(raceKey);
  else if (!isInlineViewCurrent(document.querySelector(INLINE_GRAPH_SELECTOR))) renderInlineReplay();
}

function handleInlineRacesChanged(races) {
  if (inlineReplay.raceKey) setInlineRace(inlineReplay.raceKey, races?.[inlineReplay.raceKey]);
}

async function startInlineReplay(raceKey) {
  if (!(await loadInlineRace(raceKey)) || !inlineReplay.view) return;
  inlineReplay.view.graph.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inlineReplay.view.bar.play.focus({ preventScroll: true });
  setInlinePlaying(true);
}

function watchInlineReplay(raceKey) {
  const canWatch = raceKey === replayControl.raceKey && Boolean(readProfile(document.querySelector(INLINE_GRAPH_SELECTOR)));
  if (canWatch) startInlineReplay(raceKey);
  return canWatch;
}
