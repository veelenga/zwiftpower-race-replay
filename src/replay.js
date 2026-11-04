const STORAGE_KEY_RACES = 'syncedRaces';

const MIN_ZOOM_SELECTION_PX = 20;
const CHART_UPDATE_INTERVAL_MS = 500;
const STANDINGS_RENDER_INTERVAL_MS = 100;
const LIVE_SYNC_DEBOUNCE_MS = 300;
const CHART_WINDOW_SIZE_SECONDS = 600;

const DEFAULT_ELEVATION_CONTAINER_HEIGHT = 220;
const PROFILE_TOP_PADDING_PX = 36;
const PLAYER_BAR_CLEARANCE_PX = 10;
const POWER_LABEL_OFFSET_PX = 28;
const ELEVATION_PATH_MAX_POINTS = 300;
const CURSOR_INFO_WIDTH_PX = 120;
const CURSOR_INFO_OFFSET_PX = 10;

const POWER_AXIS_MIN = 0;
const POWER_AXIS_SUGGESTED_MAX = 500;
const HR_AXIS_MIN = 60;
const HR_AXIS_SUGGESTED_MAX = 200;
const POWER_LINE_WIDTH = 2;
const HR_LINE_WIDTH = 1.25;
const HR_LINE_DASH = [5, 4];
const CHART_TEXT_COLOR = '#8b949e';
const CHART_GRID_COLOR = '#21262d';
const CHART_CURSOR_COLOR = 'rgba(255, 255, 255, 0.5)';
const CHART_TOOLTIP_OFFSET_PX = 12;

const MIN_CHART_STEP_SECONDS = 10;

const GROUP_COLORS = [
  '#ffd700', '#58a6ff', '#a371f7', '#3fb950', '#f0883e',
  '#ff7b72', '#79c0ff', '#d2a8ff', '#7ee787', '#ffa657',
];

const COMPARE_COLORS = ['#ffd700', '#58a6ff', '#a371f7', '#3fb950'];
const MAX_COMPARE_RIDERS = 4;
const WATCHING_COLOR = '#f85149';
const LEADER_COLOR = '#ffd700';

let riders = [];
let totalDistanceKm = 42;
let watchingPosition = 1;
let currentTime = 0;
let maxTime = 0;
let isPlaying = false;
let playbackSpeed = 10;
let lastFrameTime = null;
let animationFrameId = null;
let chart = null;
let chartSeries = [];
let elevationData = [];
let distanceData = [];
let compareRiders = [];
let expandedGroups = new Set();
let riderSearchTerm = '';
let zoomStart = 0;
let zoomEnd = 1;
let isDragging = false;
let dragStartX = 0;
let sampleInterval = 1;
let lastChartUpdate = 0;
let currentEventId = null;
const renderStandingsThrottled = throttle(renderStandings, STANDINGS_RENDER_INTERVAL_MS);

const elements = {
  raceInfo: document.getElementById('raceInfo'),
  riderSelect: document.getElementById('riderSelect'),
  syncBanner: document.getElementById('syncBanner'),
  syncText: document.querySelector('#syncBanner .sync-text'),
  statPosition: document.getElementById('statPosition'),
  statPower: document.getElementById('statPower'),
  statLeaderPower: document.getElementById('statLeaderPower'),
  statGapToLeader: document.getElementById('statGapToLeader'),
  statGapToGroup: document.getElementById('statGapToGroup'),
  elevationContainer: document.getElementById('elevationContainer'),
  elevationSvg: document.getElementById('elevationSvg'),
  zoomSelection: document.getElementById('zoomSelection'),
  cursorLine: document.getElementById('cursorLine'),
  cursorInfo: document.getElementById('cursorInfo'),
  distanceMarkers: document.getElementById('distanceMarkers'),
  playerBar: document.getElementById('playerBar'),
  playBtn: document.getElementById('playBtn'),
  timeDisplay: document.getElementById('timeDisplay'),
  timeSlider: document.getElementById('timeSlider'),
  speedControl: document.getElementById('speedControl'),
  speedButtons: [...document.querySelectorAll('#speedControl [data-speed]')],
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  standings: document.getElementById('standings'),
  riderSearch: document.getElementById('riderSearch'),
  comparisonPanel: document.getElementById('comparisonPanel'),
  chart: document.getElementById('chart'),
  chartTooltip: document.getElementById('chartTooltip'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  errorOverlay: document.getElementById('errorOverlay'),
  errorText: document.getElementById('errorText'),
};

function shortName(rider) {
  return rider.name.split(' ')[0];
}

function getWatchingRiderName() {
  const rider = riders.find(r => r.position === watchingPosition);
  return rider ? shortName(rider) : 'Rider';
}

function selectRider(pos) {
  watchingPosition = pos;
  expandedGroups.clear();
  elements.riderSelect.value = pos;
  updateNow();
}

function toggleGroup(gIdx) {
  if (expandedGroups.has(gIdx)) {
    expandedGroups.delete(gIdx);
  } else {
    expandedGroups.add(gIdx);
  }
  updateNow();
}

function onCompareRidersChange() {
  renderComparisonPanel();
  updateNow();
}

function toggleCompareRider(pos) {
  if (pos === watchingPosition) return;

  const index = compareRiders.indexOf(pos);
  if (index >= 0) {
    compareRiders.splice(index, 1);
  } else if (compareRiders.length < MAX_COMPARE_RIDERS) {
    compareRiders.push(pos);
  }
  onCompareRidersChange();
}

function removeCompareRider(pos) {
  const index = compareRiders.indexOf(pos);
  if (index >= 0) {
    compareRiders.splice(index, 1);
    onCompareRidersChange();
  }
}

function getCompareRiderColor(pos) {
  const index = compareRiders.indexOf(pos);
  return index >= 0 ? COMPARE_COLORS[index] : null;
}

function getCompareRiderObjects() {
  return compareRiders
    .map(pos => riders.find(r => r.position === pos))
    .filter(Boolean);
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function createCompareChip(rider, color) {
  const chip = createElement('span', 'compare-chip');
  chip.style.setProperty('--chip-color', color);
  chip.dataset.pos = rider.position;

  const removeBtn = createElement('button', 'chip-remove', '×');
  removeBtn.dataset.pos = rider.position;

  chip.append(
    createElement('span', 'chip-star', '★'),
    createElement('span', 'chip-name', rider.name.split(' ')[0]),
    removeBtn,
  );
  return chip;
}

function renderComparisonPanel() {
  const panel = elements.comparisonPanel;
  panel.classList.toggle('hidden', compareRiders.length === 0);
  if (compareRiders.length === 0) return;

  const chips = compareRiders.flatMap((pos, idx) => {
    const rider = riders.find(r => r.position === pos);
    return rider ? [createCompareChip(rider, COMPARE_COLORS[idx])] : [];
  });

  panel.replaceChildren(createElement('span', 'compare-label', 'Comparing:'), ...chips);
}

function handleComparisonClick(e) {
  const removeBtn = e.target.closest('.chip-remove');
  if (removeBtn) removeCompareRider(Number(removeBtn.dataset.pos));
}

async function loadRaceData() {
  const urlParams = new URLSearchParams(window.location.search);
  const eventId = urlParams.get('eventId');

  if (!eventId) {
    showError('No event ID provided');
    return;
  }

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY_RACES);
    const races = result[STORAGE_KEY_RACES] || {};
    const raceData = races[eventId];

    if (!raceData) {
      showError('Race not found. Please sync the race first.');
      return;
    }

    currentEventId = eventId;
    renderRaceStatus(raceData);

    sampleInterval = raceData.riders[0]?.sampleInterval || 1;
    riders = raceData.riders.map(toReplayRider);

    const currentUser = riders.find(r => r.isCurrentUser);
    watchingPosition = currentUser?.position || riders[0]?.position || 1;

    updateMaxTime();

    const maxDistance = Math.max(...riders.map(r => {
      const dist = r.distance;
      return dist && dist.length > 0 ? dist[dist.length - 1] : 0;
    }));
    totalDistanceKm = maxDistance > 0 ? Math.ceil(maxDistance) : 42;

    if (riders[0]?.elevation?.length > 0) {
      elevationData = riders[0].elevation;
      distanceData = riders[0].distance || [];
    }

    populateRiderSelector();
    initElevation();
    initChart();
    update();

    elements.loadingOverlay.classList.add('hidden');
  } catch (error) {
    console.log('[Replay] Failed to load race:', error.message);
    showError('Failed to load race data');
  }
}

function toReplayRider(r) {
  return {
    position: r.position,
    name: r.name,
    zwiftId: r.zwiftId,
    duration: r.duration,
    power: r.power || [],
    heartRate: r.heartRate || [],
    elevation: r.elevation || [],
    distance: r.distance || null,
    isCurrentUser: r.isCurrentUser,
  };
}

function renderRaceStatus(raceData) {
  const { eventName, syncInProgress, syncProgress } = raceData;
  elements.raceInfo.textContent = `${eventName} | ${raceData.riders.length} riders`;
  elements.syncBanner.classList.toggle('hidden', !syncInProgress);
  if (syncInProgress && syncProgress) {
    elements.syncText.textContent = `Syncing ${syncProgress.current}/${syncProgress.total}...`;
  }
}

function updateMaxTime() {
  maxTime = Math.max(...riders.map(r => r.duration * sampleInterval));
  elements.timeSlider.max = maxTime;
}

function showError(message) {
  elements.loadingOverlay.classList.add('hidden');
  elements.errorText.textContent = message;
  elements.errorOverlay.classList.remove('hidden');
}

function populateRiderSelector() {
  const sortedRiders = [...riders].sort((a, b) => a.position - b.position);
  const options = sortedRiders.map(r => {
    const isSelected = r.position === watchingPosition;
    const label = `#${r.position} ${r.name}${r.isCurrentUser ? ' (you)' : ''}`;
    return new Option(label, r.position, isSelected, isSelected);
  });
  elements.riderSelect.replaceChildren(...options);
}

function elevationPointsInZoom() {
  const zoomStartKm = zoomStart * totalDistanceKm;
  const zoomEndKm = zoomEnd * totalDistanceKm;
  const points = [];

  for (let i = 0; i < elevationData.length; i++) {
    const dist = distanceData[i] || 0;
    if (dist >= zoomStartKm && dist <= zoomEndKm) {
      points.push({ dist, elev: elevationData[i] });
    }
  }

  return { zoomStartKm, zoomEndKm, points };
}

function elevationBounds(points) {
  if (!points.length) return { minElev: 0, maxElev: 100 };

  let minElev = Infinity;
  let maxElev = -Infinity;
  for (const { elev } of points) {
    if (elev < minElev) minElev = elev;
    if (elev > maxElev) maxElev = elev;
  }

  return { minElev, maxElev };
}

function profileGeometry() {
  const container = elements.elevationContainer;
  const height = container.clientHeight || DEFAULT_ELEVATION_CONTAINER_HEIGHT;
  return {
    width: container.clientWidth,
    height,
    top: PROFILE_TOP_PADDING_PX,
    bottom: height - elements.playerBar.offsetHeight - PLAYER_BAR_CLEARANCE_PX,
  };
}

function elevationToY(elev, bounds, geometry) {
  const range = bounds.maxElev - bounds.minElev || 1;
  return geometry.bottom - ((elev - bounds.minElev) / range) * (geometry.bottom - geometry.top);
}

function initElevation() {
  if (!elevationData.length || !distanceData.length) return;

  const { zoomStartKm, zoomEndKm, points } = elevationPointsInZoom();
  const zoomRangeKm = zoomEndKm - zoomStartKm;
  if (zoomRangeKm <= 0 || points.length === 0) return;

  const geometry = profileGeometry();
  const bounds = elevationBounds(points);
  const step = Math.max(1, Math.floor(points.length / ELEVATION_PATH_MAX_POINTS));
  let pathD = `M 0 ${geometry.height}`;

  for (let i = 0; i < points.length; i += step) {
    const x = ((points[i].dist - zoomStartKm) / zoomRangeKm) * geometry.width;
    pathD += ` L ${x} ${elevationToY(points[i].elev, bounds, geometry)}`;
  }
  pathD += ` L ${geometry.width} ${geometry.height} Z`;

  const svg = elements.elevationSvg;
  svg.innerHTML = `
    <defs>
      <linearGradient id="elevGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#238636;stop-opacity:0.6"/>
        <stop offset="100%" style="stop-color:#238636;stop-opacity:0.1"/>
      </linearGradient>
    </defs>
    <path d="${pathD}" fill="url(#elevGrad)" stroke="#3fb950" stroke-width="2"/>
  `;
  svg.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);

  updateDistanceMarkers();
}

function updateDistanceMarkers() {
  const markers = [0, 1, 2, 3, 4].map(quarter => {
    const progress = zoomStart + (zoomEnd - zoomStart) * (quarter / 4);
    return createElement('span', '', `${(progress * totalDistanceKm).toFixed(1)} km`);
  });
  elements.distanceMarkers.replaceChildren(...markers);
}

const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw: (target) => {
    const x = target.options.plugins.verticalLine?.cursorX;
    const area = target.chartArea;
    if (x === null || x === undefined || !area || x < area.left || x > area.right) return;

    const ctx = target.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = CHART_CURSOR_COLOR;
    ctx.stroke();
    ctx.restore();
  },
};

function valueAxis(position, title, range) {
  return {
    type: 'linear',
    axis: 'y',
    position,
    title: { display: true, text: title, color: CHART_TEXT_COLOR },
    ticks: { color: CHART_TEXT_COLOR },
    grid: { color: CHART_GRID_COLOR, drawOnChartArea: position === 'left' },
    ...range,
  };
}

function initChart() {
  chart = new Chart(elements.chart.getContext('2d'), {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: { ticks: { color: CHART_TEXT_COLOR, maxTicksLimit: 8 }, grid: { color: CHART_GRID_COLOR } },
        power: valueAxis('left', 'Power (W)', { min: POWER_AXIS_MIN, suggestedMax: POWER_AXIS_SUGGESTED_MAX }),
        heartRate: valueAxis('right', 'Heart rate (bpm)', { min: HR_AXIS_MIN, suggestedMax: HR_AXIS_SUGGESTED_MAX }),
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
        verticalLine: { cursorX: null },
      },
      elements: { point: { radius: 0 }, line: { tension: 0.2 } },
    },
    plugins: [verticalLinePlugin],
  });
  elements.chart.addEventListener('mousemove', handleChartMouseMove);
  elements.chart.addEventListener('mouseleave', handleChartMouseLeave);
}

function chartRiders(you, leader) {
  const compared = getCompareRiderObjects().map((rider, idx) => ({ rider, color: COMPARE_COLORS[idx], role: 'compare' }));
  const leaderFallback = leader && leader.position !== you.position
    ? [{ rider: leader, color: LEADER_COLOR, role: 'leader' }]
    : [];
  return [{ rider: you, color: WATCHING_COLOR, role: 'watching' }, ...(compared.length ? compared : leaderFallback)];
}

function chartDatasets({ rider, color, power, heartRate }) {
  const name = shortName(rider);
  return [
    { label: `${name} power`, data: power, yAxisID: 'power', borderColor: color, borderWidth: POWER_LINE_WIDTH, fill: false },
    { label: `${name} heart rate`, data: heartRate, yAxisID: 'heartRate', borderColor: color, borderWidth: HR_LINE_WIDTH, borderDash: HR_LINE_DASH, fill: false },
  ];
}

function updateChart(t, you, leader) {
  if (!chart || !you) return;

  const entries = chartRiders(you, leader);
  const { labels, series } = sampleChartWindow(entries.map(entry => entry.rider), t, {
    windowSeconds: CHART_WINDOW_SIZE_SECONDS,
    stepSeconds: Math.max(sampleInterval, MIN_CHART_STEP_SECONDS),
    sampleInterval,
  });

  chartSeries = entries.map((entry, idx) => ({ ...entry, ...series[idx] }));
  chart.data.labels = labels;
  chart.data.datasets = chartSeries.flatMap(chartDatasets);
  chart.update('none');
}

function chartIndexAt(x) {
  const xAxis = chart?.scales.x;
  const count = chart?.data.labels.length ?? 0;
  if (!xAxis || count === 0) return -1;

  const index = Math.round(xAxis.getValueForPixel(x));
  return index >= 0 && index < count ? index : -1;
}

function formatChartValue(value, unit) {
  return value === null || value === undefined ? '-' : `${Math.round(value)} ${unit}`;
}

function chartTooltipRow(entry, index) {
  const row = createElement('div', 'chart-tooltip-row');
  const name = createElement('span', 'chart-tooltip-name', shortName(entry.rider));
  name.style.color = entry.color;
  row.append(name, ` ${formatChartValue(entry.power[index], 'W')} · ${formatChartValue(entry.heartRate[index], 'bpm')}`);
  return row;
}

function renderChartTooltip(index, e) {
  const tooltip = elements.chartTooltip;
  tooltip.replaceChildren(
    createElement('div', 'chart-tooltip-time', chart.data.labels[index]),
    ...chartSeries.map(entry => chartTooltipRow(entry, index)),
  );
  tooltip.classList.remove('hidden');

  const fitsRight = e.clientX + CHART_TOOLTIP_OFFSET_PX + tooltip.offsetWidth <= window.innerWidth;
  const left = fitsRight ? e.clientX + CHART_TOOLTIP_OFFSET_PX : e.clientX - CHART_TOOLTIP_OFFSET_PX - tooltip.offsetWidth;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${e.clientY - CHART_TOOLTIP_OFFSET_PX}px`;
}

function setChartCursor(x) {
  if (!chart) return;
  chart.options.plugins.verticalLine.cursorX = x;
  chart.draw();
}

function handleChartMouseMove(e) {
  const x = e.clientX - elements.chart.getBoundingClientRect().left;
  const index = chartIndexAt(x);
  setChartCursor(x);

  if (index < 0 || chartSeries.length === 0) {
    elements.chartTooltip.classList.add('hidden');
    return;
  }
  renderChartTooltip(index, e);
}

function handleChartMouseLeave() {
  setChartCursor(null);
  elements.chartTooltip.classList.add('hidden');
}

function update() {
  const t = currentTime;
  const standings = computeStandings(t);
  const you = standings.find(r => r.position === watchingPosition);
  const leader = standings[0];
  const groups = detectGroups(standings, t, watchingPosition, sampleInterval);

  renderPlaybackTime(t);
  renderStats({ t, standings, groups, you, leader });
  renderStandingsThrottled(groups, standings);
  updateRiderMarkers(groups);
  updateChartThrottled(t, you, leader);
}

function updateNow() {
  update();
  renderStandingsThrottled.flush();
}

function computeStandings(t) {
  const idx = timeToIndex(t, sampleInterval);
  return riders.map(r => {
    const currentDistance = r.distance?.[idx] ?? (t / (r.duration * sampleInterval) * totalDistanceKm);
    const progress = currentDistance / totalDistanceKm;
    return { ...r, progress, currentDistance, currentPower: r.power[idx] || 0 };
  }).sort((a, b) => b.currentDistance - a.currentDistance);
}

function renderPlaybackTime(t) {
  const progressPercent = maxTime > 0 ? (t / maxTime) * 100 : 0;
  elements.timeDisplay.textContent = formatTime(t);
  elements.timeSlider.value = t;
  elements.timeSlider.setAttribute('aria-valuetext', formatTime(t));
  elements.timeSlider.style.setProperty('--progress', `${progressPercent}%`);
}

function gapStatText(seconds, target) {
  return seconds > 0 ? `${formatTimeGap(seconds)} to ${target}` : null;
}

function gapToGroupAhead(groups, you, t) {
  const yourGroupIdx = groups.findIndex(g => g.hasYou);
  if (yourGroupIdx <= 0) return 0;

  const groupAhead = groups[yourGroupIdx - 1];
  const lastRiderAhead = groupAhead.riders[groupAhead.riders.length - 1];
  return calcTimeGap(lastRiderAhead, you, t, sampleInterval);
}

function setStat(el, text) {
  el.classList.toggle('hidden', text === null);
  el.textContent = text ?? '';
}

function renderStats({ t, standings, groups, you, leader }) {
  const watchingName = getWatchingRiderName();
  const isChasing = Boolean(you && leader && you !== leader);
  const rank = standings.findIndex(r => r.position === watchingPosition) + 1;

  setStat(elements.statPosition, `#${rank}`);
  setStat(elements.statPower, `${you?.currentPower || 0} W`);
  setStat(elements.statLeaderPower, `leader ${leader?.currentPower || 0} W`);
  setStat(elements.statGapToLeader, isChasing ? gapStatText(calcTimeGap(leader, you, t, sampleInterval), 'leader') : null);
  setStat(elements.statGapToGroup, isChasing ? gapStatText(gapToGroupAhead(groups, you, t), 'group') : null);
  elements.statPosition.title = `${watchingName}'s position`;
  elements.statPower.title = `${watchingName}'s power`;
}

function updateChartThrottled(t, you, leader) {
  const now = Date.now();
  if (isPlaying && now - lastChartUpdate < CHART_UPDATE_INTERVAL_MS) return;

  updateChart(t, you, leader);
  lastChartUpdate = now;
}

function renderStandings(groups, standings) {
  let html = '';
  const searchLower = riderSearchTerm.toLowerCase().trim();

  groups.forEach((group, gIdx) => {
    const filteredRiders = searchLower
      ? group.riders.filter(r => r.name.toLowerCase().includes(searchLower))
      : group.riders;

    if (searchLower && filteredRiders.length === 0) return;

    const isYourGroup = group.hasYou;
    const isExpanded = searchLower || isYourGroup || expandedGroups.has(gIdx);
    const headerClasses = ['group-header', isYourGroup ? 'your-group' : ''].filter(Boolean).join(' ');

    const displayCount = searchLower ? `${filteredRiders.length}/${group.riders.length}` : group.riders.length;
    const expandIcon = isExpanded ? '▼' : '▶';
    html += `
      <div class="${headerClasses}" data-group="${gIdx}">
        <span class="group-name"><span class="expand-icon">${expandIcon}</span> ${group.name} (${displayCount})${isYourGroup ? ' ★' : ''}</span>
        <span class="group-info">${group.avgPower}W avg ${formatTimeGap(group.timeGapToLeader)}</span>
      </div>`;

    if (isExpanded) {
      const ridersToShow = searchLower ? filteredRiders : group.riders;
      ridersToShow.forEach((r) => {
        const isYou = r.position === watchingPosition;
        const isComparing = compareRiders.includes(r.position);
        const compareColor = getCompareRiderColor(r.position);
        const overallPos = standings.findIndex(s => s.position === r.position) + 1;
        const classes = ['standings-row', isYou ? 'you' : '', isComparing ? 'comparing' : ''].filter(Boolean).join(' ');

        const displayName = highlightMatch(r.name, searchLower);

        const starStyle = compareColor ? `style="color: ${compareColor}"` : '';
        const starIcon = isYou ? '' : `<span class="compare-star" ${starStyle}>${isComparing ? '★' : '☆'}</span>`;

        html += `
          <div class="${classes}" data-pos="${r.position}">
            <span class="pos">${overallPos}</span>
            <span class="name">${displayName}</span>
            <span class="power">${r.currentPower}W</span>
            ${starIcon}
          </div>`;
      });
    }
  });

  if (searchLower && !html) {
    html = '<div style="color: #8b949e; padding: 10px; text-align: center;">No riders found</div>';
  }

  elements.standings.innerHTML = html;
}

function handleStandingsClick(e) {
  const header = e.target.closest('.group-header');
  const row = e.target.closest('.standings-row:not(.you)');
  if (header) toggleGroup(Number(header.dataset.group));
  else if (row) toggleCompareRider(Number(row.dataset.pos));
}

function createRiderMarker(r, groupIdx, color) {
  const isWatching = r.position === watchingPosition;
  const dot = createElement('div', isWatching ? 'rider-marker you' : 'rider-marker group');
  if (!isWatching) dot.style.background = color;
  dot.title = `${r.name}\nGroup ${groupIdx + 1}\n${(r.progress * totalDistanceKm).toFixed(1)} km\n${r.currentPower}W\n\nClick to analyze`;
  dot.dataset.pos = r.position;
  dot.onclick = (e) => {
    e.stopPropagation();
    selectRider(r.position);
  };
  return dot;
}

function createPowerLabel(r) {
  return createElement('div', 'rider-power-label', `${r.currentPower}W`);
}

function placeAt(el, x, y) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  return el;
}

function updateRiderMarkers(groups) {
  const container = elements.elevationContainer;
  const geometry = profileGeometry();
  const bounds = elevationBounds(elevationPointsInZoom().points);
  const zoomSpan = zoomEnd - zoomStart;
  const markers = [];

  groups.forEach((group, gIdx) => {
    const color = GROUP_COLORS[gIdx % GROUP_COLORS.length];
    group.riders
      .filter(r => r.progress >= zoomStart && r.progress <= zoomEnd)
      .forEach((r) => {
        const x = ((r.progress - zoomStart) / zoomSpan) * geometry.width;
        const elev = getValueAtDistance(distanceData, elevationData, r.currentDistance);
        const y = elevationToY(elev, bounds, geometry);
        markers.push(placeAt(createRiderMarker(r, gIdx, color), x, y));
        if (r.position === watchingPosition) {
          markers.push(placeAt(createPowerLabel(r), x, y - POWER_LABEL_OFFSET_PX));
        }
      });
  });

  container.querySelectorAll('.rider-marker, .rider-power-label').forEach(el => el.remove());
  container.append(...markers);
}

function gameLoop(timestamp) {
  if (!isPlaying) return;

  if (lastFrameTime === null) {
    lastFrameTime = timestamp;
  }

  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;
  currentTime += (deltaMs / 1000) * playbackSpeed;

  if (currentTime >= maxTime) {
    currentTime = maxTime;
    pause();
    update();
    return;
  }

  update();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function renderPlayState() {
  elements.playBtn.setAttribute('aria-pressed', String(isPlaying));
  elements.playBtn.title = isPlaying ? 'Pause' : 'Play';
}

function play() {
  if (isPlaying) return;
  if (currentTime >= maxTime) currentTime = 0;
  isPlaying = true;
  lastFrameTime = null;
  renderPlayState();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function pause() {
  isPlaying = false;
  renderPlayState();
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  lastFrameTime = null;
}

function togglePlay() {
  if (isPlaying) pause();
  else play();
}

function seekTo(time) {
  currentTime = clamp(time, 0, maxTime);
  update();
}

function setPlaybackSpeed(speed) {
  playbackSpeed = speed;
  elements.speedButtons.forEach(btn => {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.speed) === speed));
  });
}

function handleSpeedClick(e) {
  const button = e.target.closest('[data-speed]');
  if (button) setPlaybackSpeed(Number(button.dataset.speed));
}

function isZoomed() {
  return zoomStart !== 0 || zoomEnd !== 1;
}

function setZoom(start, end) {
  zoomStart = start;
  zoomEnd = end;
  elements.zoomResetBtn.classList.toggle('hidden', !isZoomed());
  initElevation();
  update();
}

function resetZoom() {
  if (isZoomed()) setZoom(0, 1);
}

function profilePointer(e) {
  const rect = elements.elevationContainer.getBoundingClientRect();
  return { x: clamp(e.clientX - rect.left, 0, rect.width), width: rect.width };
}

function renderZoomSelection(currentX) {
  elements.zoomSelection.style.left = `${Math.min(dragStartX, currentX)}px`;
  elements.zoomSelection.style.width = `${Math.abs(currentX - dragStartX)}px`;
}

function startZoomDrag(e) {
  if (e.target.closest('.rider-marker')) return;
  isDragging = true;
  dragStartX = profilePointer(e).x;
  renderZoomSelection(dragStartX);
  elements.zoomSelection.style.display = 'block';
}

function trackZoomDrag(e) {
  if (isDragging) renderZoomSelection(profilePointer(e).x);
}

function finishZoomDrag(e) {
  if (!isDragging) return;
  isDragging = false;
  elements.zoomSelection.style.display = 'none';

  const { x, width } = profilePointer(e);
  const startPx = Math.min(dragStartX, x);
  const endPx = Math.max(dragStartX, x);
  if (endPx - startPx < MIN_ZOOM_SELECTION_PX) {
    resetZoom();
    return;
  }

  const zoomSpan = zoomEnd - zoomStart;
  setZoom(
    Math.max(0, zoomStart + (startPx / width) * zoomSpan),
    Math.min(1, zoomStart + (endPx / width) * zoomSpan),
  );
}

function showProfileCursor(e) {
  if (isDragging) return;

  const { x, width } = profilePointer(e);
  const distanceKm = (zoomStart + (x / width) * (zoomEnd - zoomStart)) * totalDistanceKm;
  const elevation = getValueAtDistance(distanceData, elevationData, distanceKm);
  const fitsRight = x + CURSOR_INFO_OFFSET_PX + CURSOR_INFO_WIDTH_PX <= width;
  const infoLeft = fitsRight ? x + CURSOR_INFO_OFFSET_PX : x - CURSOR_INFO_WIDTH_PX - CURSOR_INFO_OFFSET_PX;

  elements.cursorLine.style.left = `${x}px`;
  elements.cursorLine.style.display = 'block';
  elements.cursorInfo.style.left = `${infoLeft}px`;
  elements.cursorInfo.style.display = 'block';
  elements.cursorInfo.innerHTML = `
    <span class="value">${distanceKm.toFixed(2)} km</span><br>
    <span style="color: #3fb950;">${Math.round(elevation)}m</span> elevation
  `;
}

function hideProfileCursor() {
  elements.cursorLine.style.display = 'none';
  elements.cursorInfo.style.display = 'none';
}

function initPlayerControls() {
  elements.playBtn.addEventListener('click', togglePlay);
  elements.timeSlider.addEventListener('input', (e) => seekTo(Number(e.target.value)));
  elements.speedControl.addEventListener('click', handleSpeedClick);
  elements.zoomResetBtn.addEventListener('click', resetZoom);
  setPlaybackSpeed(playbackSpeed);
  renderPlayState();
}

function initProfileInteractions() {
  const container = elements.elevationContainer;
  container.addEventListener('mousedown', startZoomDrag);
  container.addEventListener('mousemove', showProfileCursor);
  container.addEventListener('mouseleave', hideProfileCursor);
  document.addEventListener('mousemove', trackZoomDrag);
  document.addEventListener('mouseup', finishZoomDrag);
  window.addEventListener('resize', initElevation);
}

function initEventListeners() {
  initPlayerControls();
  initProfileInteractions();
  elements.riderSelect.addEventListener('change', (e) => selectRider(Number(e.target.value)));
  elements.standings.addEventListener('click', handleStandingsClick);
  elements.comparisonPanel.addEventListener('click', handleComparisonClick);
  elements.riderSearch.addEventListener('input', (e) => {
    riderSearchTerm = e.target.value;
    updateNow();
  });
  document.getElementById('closeBtn').addEventListener('click', () => window.close());
}

function applyLiveRaceData(raceData) {
  renderRaceStatus(raceData);
  if (raceData.riders.length <= riders.length) return;

  riders = raceData.riders.map(toReplayRider);
  updateMaxTime();
  populateRiderSelector();
  update();
  console.log(`[Replay] Updated to ${riders.length} riders`);
}

const applyLiveRaceDataDebounced = debounce(applyLiveRaceData, LIVE_SYNC_DEBOUNCE_MS);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY_RACES] || !currentEventId) return;

  const raceData = changes[STORAGE_KEY_RACES].newValue?.[currentEventId];
  if (raceData) applyLiveRaceDataDebounced(raceData);
});

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadRaceData();
});
