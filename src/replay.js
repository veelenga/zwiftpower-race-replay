/**
 * Race Replay Visualization
 * Loads race data from extension storage and renders interactive replay
 */

// Storage key (shared with other modules)
const STORAGE_KEY_RACES = 'syncedRaces';

// Replay-specific constants
const MIN_ZOOM_SELECTION_PX = 20;
const CHART_UPDATE_INTERVAL_MS = 500;
const CHART_WINDOW_SIZE_SECONDS = 600;

// Elevation profile constants
const DEFAULT_ELEVATION_SVG_HEIGHT = 150;
const DEFAULT_ELEVATION_CONTAINER_HEIGHT = 180;
const ELEVATION_PATH_TOP_PADDING = 20;
const ELEVATION_PATH_MAX_POINTS = 300;
const MARKER_TOP_PADDING = 25;
const MARKER_BOTTOM_PADDING = 10;

// Chart axis limits
const POWER_CHART_MIN = 0;
const POWER_CHART_SUGGESTED_MAX = 500;
const HR_CHART_MIN = 60;
const HR_CHART_SUGGESTED_MAX = 200;

// Chart data sampling
const MIN_CHART_STEP_SECONDS = 10;

const GROUP_COLORS = [
  '#ffd700', '#58a6ff', '#a371f7', '#3fb950', '#f0883e',
  '#ff7b72', '#79c0ff', '#d2a8ff', '#7ee787', '#ffa657',
];

// State
let riders = [];
let totalDistanceKm = 42;
let watchingPosition = 1;
let currentTime = 0;
let maxTime = 0;
let isPlaying = false;
let playbackSpeed = 10;
let lastFrameTime = null;
let animationFrameId = null;
let powerChart = null;
let hrChart = null;
let elevationData = [];
let compareRiderPos = null;
let compareGroupIdx = null;
let expandedGroups = new Set();
let riderSearchTerm = '';
let zoomStart = 0;
let zoomEnd = 1;
let isDragging = false;
let dragStartX = 0;
let sampleInterval = 1; // Data sample interval (1 = every second, 5 = every 5 seconds)
let lastChartUpdate = 0; // Timestamp for throttling chart updates

// DOM Elements
const elements = {
  raceInfo: document.getElementById('raceInfo'),
  riderSelect: document.getElementById('riderSelect'),
  syncBanner: document.getElementById('syncBanner'),
  syncText: document.querySelector('#syncBanner .sync-text'),
  elevationContainer: document.getElementById('elevationContainer'),
  elevationSvg: document.getElementById('elevationSvg'),
  zoomSelection: document.getElementById('zoomSelection'),
  zoomResetBtn: document.getElementById('zoomResetBtn'),
  cursorLine: document.getElementById('cursorLine'),
  cursorInfo: document.getElementById('cursorInfo'),
  distanceMarkers: document.getElementById('distanceMarkers'),
  timeDisplay: document.getElementById('timeDisplay'),
  playBtn: document.getElementById('playBtn'),
  resetBtn: document.getElementById('resetBtn'),
  timeSlider: document.getElementById('timeSlider'),
  yourPosition: document.getElementById('yourPosition'),
  yourPower: document.getElementById('yourPower'),
  leaderPower: document.getElementById('leaderPower'),
  gapToLeader: document.getElementById('gapToLeader'),
  gapToGroup: document.getElementById('gapToGroup'),
  positionLabel: document.getElementById('positionLabel'),
  powerLabel: document.getElementById('powerLabel'),
  standings: document.getElementById('standings'),
  riderSearch: document.getElementById('riderSearch'),
  compareLabel: document.getElementById('compareLabel'),
  hrCompareLabel: document.getElementById('hrCompareLabel'),
  powerChart: document.getElementById('powerChart'),
  hrChart: document.getElementById('hrChart'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  errorOverlay: document.getElementById('errorOverlay'),
  errorText: document.getElementById('errorText'),
};

// Current event ID for storage listener
let currentEventId = null;

function getWatchingRiderName() {
  const rider = riders.find(r => r.position === watchingPosition);
  return rider ? rider.name.split(' ')[0] : 'Rider';
}

function selectRider(pos) {
  watchingPosition = pos;
  expandedGroups.clear();
  elements.riderSelect.value = pos;
  update();
}

// Data loading
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
    elements.raceInfo.textContent = `${raceData.eventName} | ${raceData.riders.length} riders`;

    // Show/hide sync banner with progress
    if (raceData.syncInProgress) {
      elements.syncBanner.classList.remove('hidden');
      if (raceData.syncProgress) {
        elements.syncText.textContent = `Syncing ${raceData.syncProgress.current}/${raceData.syncProgress.total}...`;
      }
    } else {
      elements.syncBanner.classList.add('hidden');
    }

    sampleInterval = raceData.riders[0]?.sampleInterval || 1;

    riders = raceData.riders.map(r => ({
      position: r.position,
      name: r.name,
      zwiftId: r.zwiftId,
      duration: r.duration,
      power: r.power || [],
      heartRate: r.heartRate || [],
      elevation: r.elevation || [],
      distance: r.distance || null,
      isCurrentUser: r.isCurrentUser,
    }));

    // Find current user or default to first rider
    const currentUser = riders.find(r => r.isCurrentUser);
    watchingPosition = currentUser?.position || riders[0]?.position || 1;

    // maxTime is in real seconds (duration * sampleInterval)
    maxTime = Math.max(...riders.map(r => r.duration * sampleInterval));
    elements.timeSlider.max = maxTime;

    // Calculate total distance (last element of distance array)
    const maxDistance = Math.max(...riders.map(r => {
      const dist = r.distance;
      return dist && dist.length > 0 ? dist[dist.length - 1] : 0;
    }));
    totalDistanceKm = maxDistance > 0 ? Math.ceil(maxDistance) : 42;

    if (riders[0]?.elevation?.length > 0) {
      elevationData = riders[0].elevation;
    }

    populateRiderSelector();
    initElevation();
    initPowerChart();
    initHRChart();
    update();

    elements.loadingOverlay.classList.add('hidden');
  } catch (error) {
    console.log('[Replay] Failed to load race:', error.message);
    showError('Failed to load race data');
  }
}

function showError(message) {
  elements.loadingOverlay.classList.add('hidden');
  elements.errorText.textContent = message;
  elements.errorOverlay.classList.remove('hidden');
}

function populateRiderSelector() {
  const sortedRiders = [...riders].sort((a, b) => a.position - b.position);
  elements.riderSelect.innerHTML = sortedRiders.map(r => {
    const isUser = r.isCurrentUser;
    return `<option value="${r.position}" ${r.position === watchingPosition ? 'selected' : ''}>
      #${r.position} ${r.name}${isUser ? ' (You)' : ''}
    </option>`;
  }).join('');
}

// Elevation profile
function initElevation() {
  const svg = elements.elevationSvg;
  const container = svg.parentElement;
  const width = container.clientWidth;
  const height = svg.clientHeight || DEFAULT_ELEVATION_SVG_HEIGHT;

  if (!elevationData.length) return;

  const startIdx = Math.floor(zoomStart * elevationData.length);
  const endIdx = Math.floor(zoomEnd * elevationData.length);
  const zoomedData = elevationData.slice(startIdx, endIdx);

  if (!zoomedData.length) return;

  const minElev = Math.min(...zoomedData);
  const maxElev = Math.max(...zoomedData);
  const range = maxElev - minElev || 1;

  const step = Math.max(1, Math.floor(zoomedData.length / ELEVATION_PATH_MAX_POINTS));
  let pathD = `M 0 ${height}`;

  for (let i = 0; i < zoomedData.length; i += step) {
    const x = (i / zoomedData.length) * width;
    const y = height - ((zoomedData[i] - minElev) / range) * (height - ELEVATION_PATH_TOP_PADDING);
    pathD += ` L ${x} ${y}`;
  }
  pathD += ` L ${width} ${height} Z`;

  svg.innerHTML = `
    <defs>
      <linearGradient id="elevGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" style="stop-color:#238636;stop-opacity:0.6"/>
        <stop offset="100%" style="stop-color:#238636;stop-opacity:0.1"/>
      </linearGradient>
    </defs>
    <path d="${pathD}" fill="url(#elevGrad)" stroke="#3fb950" stroke-width="2"/>
  `;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  updateDistanceMarkers();
}

function updateDistanceMarkers() {
  const startKm = (zoomStart * totalDistanceKm).toFixed(1);
  const endKm = (zoomEnd * totalDistanceKm).toFixed(1);
  const midKm = ((zoomStart + zoomEnd) / 2 * totalDistanceKm).toFixed(1);
  const q1Km = ((zoomStart * 3 + zoomEnd) / 4 * totalDistanceKm).toFixed(1);
  const q3Km = ((zoomStart + zoomEnd * 3) / 4 * totalDistanceKm).toFixed(1);
  elements.distanceMarkers.innerHTML = `
    <span>${startKm} km</span>
    <span>${q1Km} km</span>
    <span>${midKm} km</span>
    <span>${q3Km} km</span>
    <span>${endKm} km</span>
  `;
}

// Vertical line plugin for charts - shows on hover with values
const verticalLinePlugin = {
  id: 'verticalLine',
  afterDraw: (chart) => {
    const verticalLineOpts = chart.options.plugins.verticalLine;
    if (!verticalLineOpts?.show || verticalLineOpts.cursorX === null) return;

    const ctx = chart.ctx;
    const xAxis = chart.scales.x;
    const yAxis = chart.scales.y;

    if (!xAxis || !yAxis) return;

    const x = verticalLineOpts.cursorX;

    // Only draw if x is within chart area
    if (x < xAxis.left || x > xAxis.right) return;

    // Draw vertical line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, yAxis.top);
    ctx.lineTo(x, yAxis.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.stroke();
    ctx.restore();
  }
};

// Get data values at cursor position
function getChartValuesAtX(chart, x) {
  const xAxis = chart.scales.x;
  if (!xAxis || chart.data.labels.length === 0) return null;

  // Find the closest data index to the cursor position
  const dataIndex = Math.round(xAxis.getValueForPixel(x));
  if (dataIndex < 0 || dataIndex >= chart.data.labels.length) return null;

  const label = chart.data.labels[dataIndex];
  const values = chart.data.datasets.map(ds => ({
    label: ds.label,
    value: ds.data[dataIndex],
    color: ds.borderColor
  }));

  return { label, values, dataIndex };
}

// Shared tooltip element for charts
let chartTooltip = null;

function getChartTooltip() {
  if (!chartTooltip) {
    chartTooltip = document.createElement('div');
    chartTooltip.className = 'chart-tooltip';
    chartTooltip.style.cssText = `
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 6px 10px;
      font-size: 12px;
      color: #f0f6fc;
      pointer-events: none;
      z-index: 1000;
      display: none;
      white-space: nowrap;
    `;
    document.body.appendChild(chartTooltip);
  }
  return chartTooltip;
}

function setupChartCursorTracking(chart, canvas) {
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;

    // Update both charts with cursor position
    if (powerChart) {
      powerChart.options.plugins.verticalLine.cursorX = x;
      powerChart.draw();
    }
    if (hrChart) {
      hrChart.options.plugins.verticalLine.cursorX = x;
      hrChart.draw();
    }

    // Show tooltip with values
    const tooltip = getChartTooltip();
    const data = getChartValuesAtX(chart, x);

    if (data && data.values.length > 0) {
      const unit = chart === powerChart ? 'W' : 'bpm';
      let html = `<div style="color: #8b949e; margin-bottom: 4px;">${data.label}</div>`;
      data.values.forEach(v => {
        const val = v.value !== undefined && v.value !== null ? Math.round(v.value) : '-';
        html += `<div><span style="color: ${v.color};">${v.label}:</span> ${val}${unit}</div>`;
      });
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX + 12}px`;
      tooltip.style.top = `${e.clientY - 10}px`;
    } else {
      tooltip.style.display = 'none';
    }
  });

  canvas.addEventListener('mouseleave', () => {
    // Hide line on both charts
    if (powerChart) {
      powerChart.options.plugins.verticalLine.cursorX = null;
      powerChart.draw();
    }
    if (hrChart) {
      hrChart.options.plugins.verticalLine.cursorX = null;
      hrChart.draw();
    }

    // Hide tooltip
    const tooltip = getChartTooltip();
    tooltip.style.display = 'none';
  });
}

// Power chart
function initPowerChart() {
  const ctx = elements.powerChart.getContext('2d');
  powerChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { enabled: false },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, min: POWER_CHART_MIN, suggestedMax: POWER_CHART_SUGGESTED_MAX },
      },
      plugins: {
        legend: { display: true, labels: { color: '#c9d1d9', boxWidth: 12 } },
        verticalLine: { show: true, cursorX: null }
      },
      elements: { point: { radius: 0 }, line: { tension: 0.2 } },
    },
    plugins: [verticalLinePlugin],
  });
  setupChartCursorTracking(powerChart, elements.powerChart);
}

function initHRChart() {
  const ctx = elements.hrChart.getContext('2d');
  hrChart = new Chart(ctx, {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { enabled: false },
      scales: {
        x: { ticks: { color: '#8b949e', maxTicksLimit: 8 }, grid: { color: '#21262d' } },
        y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' }, min: HR_CHART_MIN, suggestedMax: HR_CHART_SUGGESTED_MAX },
      },
      plugins: {
        legend: { display: true, labels: { color: '#c9d1d9', boxWidth: 12 } },
        verticalLine: { show: true, cursorX: null }
      },
      elements: { point: { radius: 0 }, line: { tension: 0.2 } },
    },
    plugins: [verticalLinePlugin],
  });
  setupChartCursorTracking(hrChart, elements.hrChart);
}

// Main update loop
function update() {
  const t = currentTime;
  const idx = timeToIndex(t, sampleInterval);
  elements.timeDisplay.textContent = formatTime(t);
  elements.timeSlider.value = t;

  const standings = riders.map(r => {
    const currentDistance = r.distance?.[idx] ?? (t / (r.duration * sampleInterval) * totalDistanceKm);
    const progress = currentDistance / totalDistanceKm;
    return { ...r, progress, currentDistance, currentPower: r.power[idx] || 0 };
  }).sort((a, b) => b.currentDistance - a.currentDistance);

  const you = standings.find(r => r.position === watchingPosition);
  const yourRank = standings.findIndex(r => r.position === watchingPosition) + 1;
  const leader = standings[0];

  const watchingName = getWatchingRiderName();
  elements.yourPosition.textContent = `#${yourRank}`;
  elements.yourPower.textContent = you?.currentPower || 0;
  elements.leaderPower.textContent = leader?.currentPower || 0;
  elements.positionLabel.textContent = `${watchingName}'s Position`;
  elements.powerLabel.textContent = `${watchingName}'s Power (W)`;

  const groups = detectGroups(standings, t, watchingPosition, sampleInterval);

  if (you && leader && you !== leader) {
    const timeToLeader = calcTimeGap(leader, you, t, sampleInterval);
    elements.gapToLeader.textContent = formatTimeGap(timeToLeader);

    const yourGroupIdx = groups.findIndex(g => g.hasYou);
    if (yourGroupIdx > 0) {
      const groupAhead = groups[yourGroupIdx - 1];
      const lastRiderInGroupAhead = groupAhead.riders[groupAhead.riders.length - 1];
      const timeToGroup = calcTimeGap(lastRiderInGroupAhead, you, t, sampleInterval);
      elements.gapToGroup.textContent = formatTimeGap(timeToGroup);
    } else {
      elements.gapToGroup.textContent = '-';
    }
  } else {
    elements.gapToLeader.textContent = '-';
    elements.gapToGroup.textContent = '-';
  }

  renderStandings(groups, standings);
  updateRiderMarkers(groups);

  // Throttle chart updates during playback for better performance
  const now = Date.now();
  if (!isPlaying || now - lastChartUpdate >= CHART_UPDATE_INTERVAL_MS) {
    const compareTarget = getCompareTarget(groups, standings, leader);
    updatePowerChart(t, you, compareTarget);
    updateHRChart(t, you, compareTarget);
    lastChartUpdate = now;
  }
}

function renderStandings(groups, standings) {
  let html = '';
  const searchLower = riderSearchTerm.toLowerCase().trim();

  groups.forEach((group, gIdx) => {
    // Filter riders in this group based on search
    const filteredRiders = searchLower
      ? group.riders.filter(r => r.name.toLowerCase().includes(searchLower))
      : group.riders;

    // Skip group if searching and no riders match
    if (searchLower && filteredRiders.length === 0) return;

    const isGroupSelected = compareGroupIdx === gIdx;
    const isYourGroup = group.hasYou;
    // Auto-expand when searching, otherwise use normal logic
    const isExpanded = searchLower || isYourGroup || expandedGroups.has(gIdx);
    const headerClasses = [
      'group-header',
      isGroupSelected ? 'selected' : '',
      isYourGroup ? 'your-group' : '',
    ].filter(Boolean).join(' ');

    const displayCount = searchLower ? `${filteredRiders.length}/${group.riders.length}` : group.riders.length;
    const expandIcon = isExpanded ? '▼' : '▶';
    html += `
      <div class="${headerClasses}" data-group="${gIdx}">
        <span class="group-name"><span class="expand-icon" data-toggle="${gIdx}">${expandIcon}</span> ${group.name} (${displayCount})${isYourGroup ? ' ★' : ''}</span>
        <span class="group-info">${group.avgPower}W avg ${formatTimeGap(group.timeGapToLeader)}</span>
      </div>`;

    if (isExpanded) {
      const ridersToShow = searchLower ? filteredRiders : group.riders;
      ridersToShow.forEach((r) => {
        const isYou = r.position === watchingPosition;
        const isSelected = r.position === compareRiderPos;
        const overallPos = standings.findIndex(s => s.position === r.position) + 1;
        const classes = ['standings-row', isYou ? 'you' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ');

        // Highlight matching text
        let displayName = r.name;
        if (searchLower) {
          const idx = r.name.toLowerCase().indexOf(searchLower);
          if (idx >= 0) {
            displayName = r.name.slice(0, idx) +
              '<mark style="background:#58a6ff33;color:#58a6ff;">' +
              r.name.slice(idx, idx + searchLower.length) +
              '</mark>' +
              r.name.slice(idx + searchLower.length);
          }
        }

        html += `
          <div class="${classes}" data-pos="${r.position}">
            <span class="pos">${overallPos}</span>
            <span class="name">${displayName}</span>
            <span class="power">${r.currentPower}W</span>
          </div>`;
      });
    }
  });

  if (searchLower && !html) {
    html = '<div style="color: #8b949e; padding: 10px; text-align: center;">No riders found</div>';
  }

  elements.standings.innerHTML = html;

  // Event listeners
  elements.standings.querySelectorAll('.expand-icon').forEach(icon => {
    icon.onclick = (e) => {
      e.stopPropagation();
      const gIdx = parseInt(icon.dataset.toggle);
      expandedGroups.has(gIdx) ? expandedGroups.delete(gIdx) : expandedGroups.add(gIdx);
      update();
    };
  });

  elements.standings.querySelectorAll('.group-header').forEach(header => {
    header.onclick = (e) => {
      if (e.target.classList.contains('expand-icon')) return;
      const gIdx = parseInt(header.dataset.group);
      compareGroupIdx = (compareGroupIdx === gIdx) ? null : gIdx;
      compareRiderPos = null;
      update();
    };
  });

  elements.standings.querySelectorAll('.standings-row:not(.you)').forEach(row => {
    row.onclick = () => {
      const pos = parseInt(row.dataset.pos);
      compareRiderPos = (compareRiderPos === pos) ? null : pos;
      compareGroupIdx = null;
      update();
    };
  });
}

function getCompareTarget(groups, standings, leader) {
  if (compareGroupIdx !== null && groups[compareGroupIdx]) {
    const group = groups[compareGroupIdx];
    const avgPower = [];
    const maxLen = Math.max(...group.riders.map(r => r.power.length));
    for (let i = 0; i < maxLen; i++) {
      const sum = group.riders.reduce((acc, r) => acc + (r.power[i] || 0), 0);
      avgPower.push(Math.round(sum / group.riders.length));
    }
    // Include riders array for HR calculation
    return { name: group.name, power: avgPower, riders: group.riders, isGroup: true };
  }
  if (compareRiderPos) {
    const rider = standings.find(r => r.position === compareRiderPos);
    // Ensure heartRate is available from original rider data
    if (rider) {
      const originalRider = riders.find(r => r.position === compareRiderPos);
      rider.heartRate = originalRider?.heartRate || [];
    }
    return rider;
  }
  // For leader, ensure heartRate is available
  if (leader) {
    const originalLeader = riders.find(r => r.position === leader.position);
    leader.heartRate = originalLeader?.heartRate || [];
  }
  return leader;
}

function updateRiderMarkers(groups) {
  const container = elements.elevationContainer;
  const width = container.clientWidth;

  const startIdx = Math.floor(zoomStart * elevationData.length);
  const endIdx = Math.floor(zoomEnd * elevationData.length);
  const zoomedData = elevationData.slice(startIdx, endIdx);
  const minElev = zoomedData.length ? Math.min(...zoomedData) : 0;
  const maxElev = zoomedData.length ? Math.max(...zoomedData) : 100;
  const elevRange = maxElev - minElev || 1;

  container.querySelectorAll('.rider-marker, .rider-power-label').forEach(el => el.remove());

  groups.forEach((group, gIdx) => {
    const color = GROUP_COLORS[gIdx % GROUP_COLORS.length];

    const visibleRiders = group.riders.filter(r =>
      r.progress >= zoomStart && r.progress <= zoomEnd
    );

    if (visibleRiders.length === 0) return;

    visibleRiders.forEach((r) => {
      const x = ((r.progress - zoomStart) / (zoomEnd - zoomStart)) * width;
      const elevIdx = Math.floor(r.progress * (elevationData.length - 1));
      const elev = elevationData[elevIdx] || 0;
      const containerHeight = container.clientHeight || DEFAULT_ELEVATION_CONTAINER_HEIGHT;
      const markerRange = containerHeight - MARKER_TOP_PADDING - MARKER_BOTTOM_PADDING;
      const y = containerHeight - MARKER_BOTTOM_PADDING - ((elev - minElev) / elevRange) * markerRange;

      const dot = document.createElement('div');
      const isWatching = r.position === watchingPosition;

      if (isWatching) {
        dot.className = 'rider-marker you';

        const powerLabel = document.createElement('div');
        powerLabel.className = 'rider-power-label';
        powerLabel.style.left = `${x}px`;
        powerLabel.style.top = `${y - 28}px`;
        powerLabel.textContent = `${r.currentPower}W`;
        container.appendChild(powerLabel);
      } else {
        dot.className = 'rider-marker group';
        dot.style.background = color;
      }

      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.title = `${r.name}\nGroup ${gIdx + 1}\n${(r.progress * totalDistanceKm).toFixed(1)} km\n${r.currentPower}W\n\nClick to analyze`;
      dot.dataset.pos = r.position;

      dot.onclick = (e) => {
        e.stopPropagation();
        selectRider(r.position);
      };

      container.appendChild(dot);
    });
  });
}

function updatePowerChart(t, you, compareTarget) {
  if (!powerChart || !you || !compareTarget) return;

  const start = Math.max(0, t - CHART_WINDOW_SIZE_SECONDS);
  const step = Math.max(sampleInterval, MIN_CHART_STEP_SECONDS);

  const labels = [];
  const youData = [];
  const compareData = [];

  for (let i = start; i <= t; i += step) {
    const idx = timeToIndex(i, sampleInterval);
    labels.push(formatTime(i));
    youData.push(you.power[idx] || 0);
    compareData.push(compareTarget.power[idx] || 0);
  }

  const compareName = compareTarget.isGroup
    ? compareTarget.name
    : compareTarget.name.split(' ')[0];
  elements.compareLabel.textContent = `(vs ${compareName})`;

  const watchingName = getWatchingRiderName();
  const compareColor = compareTarget.isGroup ? '#a371f7' : '#58a6ff';
  powerChart.data.labels = labels;
  powerChart.data.datasets = [
    { label: watchingName, data: youData, borderColor: '#f85149', borderWidth: 2, fill: false },
    { label: compareName, data: compareData, borderColor: compareColor, borderWidth: 2, fill: false },
  ];
  powerChart.update('none');
}

function updateHRChart(t, you, compareTarget) {
  if (!hrChart || !you || !compareTarget) return;

  const start = Math.max(0, t - CHART_WINDOW_SIZE_SECONDS);
  const step = Math.max(sampleInterval, MIN_CHART_STEP_SECONDS);

  const labels = [];
  const youData = [];
  const compareData = [];

  for (let i = start; i <= t; i += step) {
    const idx = timeToIndex(i, sampleInterval);
    labels.push(formatTime(i));
    youData.push(you.heartRate?.[idx] || 0);
    // For groups, calculate average HR
    if (compareTarget.isGroup && compareTarget.riders) {
      const hrValues = compareTarget.riders
        .map(r => r.heartRate?.[idx])
        .filter(v => v && v > 0);
      compareData.push(hrValues.length ? Math.round(hrValues.reduce((a, b) => a + b, 0) / hrValues.length) : 0);
    } else {
      compareData.push(compareTarget.heartRate?.[idx] || 0);
    }
  }

  const compareName = compareTarget.isGroup
    ? compareTarget.name
    : compareTarget.name.split(' ')[0];
  elements.hrCompareLabel.textContent = `(vs ${compareName})`;

  const watchingName = getWatchingRiderName();
  const compareColor = compareTarget.isGroup ? '#a371f7' : '#58a6ff';
  hrChart.data.labels = labels;
  hrChart.data.datasets = [
    { label: watchingName, data: youData, borderColor: '#f85149', borderWidth: 2, fill: false },
    { label: compareName, data: compareData, borderColor: compareColor, borderWidth: 2, fill: false },
  ];
  hrChart.update('none');
}

// Playback controls using requestAnimationFrame for smooth animation
function gameLoop(timestamp) {
  if (!isPlaying) return;

  if (lastFrameTime === null) {
    lastFrameTime = timestamp;
  }

  const deltaMs = timestamp - lastFrameTime;
  lastFrameTime = timestamp;

  // Calculate time increment based on playback speed
  // deltaMs is in milliseconds, we want to advance currentTime by (deltaMs/1000 * playbackSpeed) seconds
  const timeIncrement = (deltaMs / 1000) * playbackSpeed;
  currentTime += timeIncrement;

  if (currentTime >= maxTime) {
    currentTime = maxTime;
    pause();
    update();
    return;
  }

  update();
  animationFrameId = requestAnimationFrame(gameLoop);
}

function play() {
  if (isPlaying) return;
  isPlaying = true;
  lastFrameTime = null;
  elements.playBtn.textContent = 'Pause';
  elements.playBtn.classList.remove('primary');
  animationFrameId = requestAnimationFrame(gameLoop);
}

function pause() {
  isPlaying = false;
  elements.playBtn.textContent = 'Play';
  elements.playBtn.classList.add('primary');
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  lastFrameTime = null;
}

// Event listeners
function initEventListeners() {
  elements.playBtn.onclick = () => isPlaying ? pause() : play();
  elements.resetBtn.onclick = () => { pause(); currentTime = 0; update(); };
  elements.timeSlider.oninput = (e) => { currentTime = +e.target.value; update(); };
  elements.riderSelect.onchange = (e) => selectRider(parseInt(e.target.value));

  // Rider search
  elements.riderSearch.oninput = (e) => {
    riderSearchTerm = e.target.value;
    update();
  };

  document.querySelectorAll('[data-speed]').forEach(btn => {
    btn.onclick = (e) => {
      playbackSpeed = +e.target.dataset.speed;
      document.querySelectorAll('[data-speed]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    };
  });

  window.addEventListener('resize', initElevation);

  // Zoom
  elements.elevationContainer.addEventListener('mousedown', (e) => {
    if (e.target.closest('.zoom-controls')) return;
    if (e.target.closest('.rider-marker')) return;
    isDragging = true;
    const rect = elements.elevationContainer.getBoundingClientRect();
    dragStartX = e.clientX - rect.left;
    elements.zoomSelection.style.left = `${dragStartX}px`;
    elements.zoomSelection.style.width = '0px';
    elements.zoomSelection.style.display = 'block';
  });

  elements.elevationContainer.addEventListener('mousemove', (e) => {
    const rect = elements.elevationContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const containerWidth = rect.width;

    // Cursor info
    if (!isDragging) {
      const progress = zoomStart + (x / containerWidth) * (zoomEnd - zoomStart);
      const distanceKm = progress * totalDistanceKm;
      const elevIdx = Math.floor(progress * (elevationData.length - 1));
      const elevation = elevationData[elevIdx] || 0;

      elements.cursorLine.style.left = `${x}px`;
      elements.cursorLine.style.display = 'block';

      const infoWidth = 120;
      const infoLeft = x + 10 + infoWidth > containerWidth ? x - infoWidth - 10 : x + 10;
      elements.cursorInfo.style.left = `${infoLeft}px`;
      elements.cursorInfo.style.display = 'block';
      elements.cursorInfo.innerHTML = `
        <span class="value">${distanceKm.toFixed(2)} km</span><br>
        <span style="color: #3fb950;">${Math.round(elevation)}m</span> elevation
      `;
    }

    // Zoom selection
    if (isDragging) {
      const currentX = e.clientX - rect.left;
      const left = Math.min(dragStartX, currentX);
      const width = Math.abs(currentX - dragStartX);
      elements.zoomSelection.style.left = `${left}px`;
      elements.zoomSelection.style.width = `${width}px`;
    }
  });

  elements.elevationContainer.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    elements.zoomSelection.style.display = 'none';

    const rect = elements.elevationContainer.getBoundingClientRect();
    const containerWidth = rect.width;
    const currentX = e.clientX - rect.left;

    const startPx = Math.min(dragStartX, currentX);
    const endPx = Math.max(dragStartX, currentX);

    if (endPx - startPx < MIN_ZOOM_SELECTION_PX) {
      if (zoomStart !== 0 || zoomEnd !== 1) {
        zoomStart = 0;
        zoomEnd = 1;
        elements.zoomResetBtn.disabled = true;
        initElevation();
        update();
      }
      return;
    }

    const startProgress = zoomStart + (startPx / containerWidth) * (zoomEnd - zoomStart);
    const endProgress = zoomStart + (endPx / containerWidth) * (zoomEnd - zoomStart);

    zoomStart = Math.max(0, startProgress);
    zoomEnd = Math.min(1, endProgress);

    elements.zoomResetBtn.disabled = false;
    initElevation();
    update();
  });

  elements.elevationContainer.addEventListener('mouseleave', () => {
    if (isDragging) {
      isDragging = false;
      elements.zoomSelection.style.display = 'none';
    }
    elements.cursorLine.style.display = 'none';
    elements.cursorInfo.style.display = 'none';
  });

  elements.zoomResetBtn.addEventListener('click', () => {
    zoomStart = 0;
    zoomEnd = 1;
    elements.zoomResetBtn.disabled = true;
    initElevation();
    update();
  });
}

/**
 * Update riders when new data is synced
 */
function updateRidersFromRaceData(raceData) {
  const newRiders = raceData.riders.map(r => ({
    position: r.position,
    name: r.name,
    zwiftId: r.zwiftId,
    duration: r.duration,
    power: r.power || [],
    heartRate: r.heartRate || [],
    elevation: r.elevation || [],
    distance: r.distance || null,
    isCurrentUser: r.isCurrentUser,
  }));

  // Only update if there are more riders or sync status changed
  if (newRiders.length > riders.length || raceData.syncInProgress !== !elements.syncBanner.classList.contains('hidden')) {
    riders = newRiders;
    elements.raceInfo.textContent = `${raceData.eventName} | ${raceData.riders.length} riders`;

    // Update sync banner with progress
    if (raceData.syncInProgress) {
      elements.syncBanner.classList.remove('hidden');
      if (raceData.syncProgress) {
        elements.syncText.textContent = `Syncing ${raceData.syncProgress.current}/${raceData.syncProgress.total}...`;
      }
    } else {
      elements.syncBanner.classList.add('hidden');
    }

    // Re-populate selector if new riders added
    populateRiderSelector();

    // Update display
    update();
    console.log(`[Replay] Updated to ${riders.length} riders`);
  }
}

/**
 * Listen for storage changes to update riders in real-time
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE_KEY_RACES] || !currentEventId) return;

  const races = changes[STORAGE_KEY_RACES].newValue || {};
  const raceData = races[currentEventId];

  if (raceData) {
    updateRidersFromRaceData(raceData);
  }
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  loadRaceData();

  // Close button for error overlay
  document.getElementById('closeBtn')?.addEventListener('click', () => window.close());
});
