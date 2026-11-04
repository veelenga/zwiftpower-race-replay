/**
 * Content script for ZwiftPower pages
 * Extracts rider list and fetches analysis data
 */

const ZWIFTPOWER_EVENT_PATTERN = /zwiftpower\.com\/events\.php\?zid=(\d+)/;
const ZWIFTPOWER_API_BASE = 'https://zwiftpower.com/api3.php';
const MAX_RIDERS_TO_SYNC = 50;
const DELAY_BETWEEN_REQUESTS_MS = 1500;
const HIGHLIGHTED_ROW_CLASS = 'pointed';
const FETCH_TIMEOUT_MS = 15000;
const MAX_RETRIES = 2;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 2000;
const MAX_CONSECUTIVE_FAILURES = 5;
const PROFILE_LINK_SELECTOR = 'a[href*="profile.php?z="]';
const ZWIFT_ID_PATTERN = /z=(\d+)/;
const TABLE_LOAD_TIMEOUT_MS = 5000;
const PAGE_INFO_TIMEOUT_MS = 3000;
const TABLE_POLL_INTERVAL_MS = 200;
const MAX_VALID_POSITION = 200;
const MAX_SYNCED_RACES = 15;
const SYNC_STATUS_KEY = 'syncStatus';
const SYNCED_RACES_KEY = 'syncedRaces';
const SYNC_STATUS_MAX_AGE_MS = 2 * 60 * 1000;
const CATEGORY_FILTER_SELECTOR = 'button[data-value][class*="event_filter_id"]';
const CATEGORY_BUTTON_SELECTOR = 'button[data-value]';
const CONTROL_REFRESH_DELAY_MS = 100;
const CONTROL_MOUNT_THROTTLE_MS = 250;
const CONTROL_STANDALONE_CLASS = 'zp-replay-standalone';
const CONTROL_LINK_LABELS = { cancel: 'Cancel', resync: 'Re-sync' };

// Sync state
let currentSyncAbortController = null;

/**
 * Extract event ID from current URL
 */
function getEventIdFromUrl() {
  const match = window.location.href.match(ZWIFTPOWER_EVENT_PATTERN);
  return match ? match[1] : null;
}

/**
 * Extract event name from page
 */
function getEventName() {
  const titleEl = document.querySelector('h3') || document.querySelector('title');
  return titleEl?.textContent?.trim() || 'Unknown Race';
}

function getActiveCategory() {
  const categoryId = detectActiveCategoryId();
  const categoryName = formatCategoryName(categoryId);

  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    if (table.offsetParent !== null && table.querySelector(PROFILE_LINK_SELECTOR)) {
      return { categoryId, categoryName, table };
    }
  }

  return { categoryId: null, categoryName: null, table: null };
}

function detectActiveCategoryId() {
  const activeButtons = document.querySelectorAll('button.btn-primary[data-value], button.active[data-value]');
  for (const btn of activeButtons) {
    const value = btn.dataset.value;
    if (isValidCategory(value)) {
      return value.toUpperCase();
    }
  }

  const hashCategory = parseCategoryFromHash(window.location.hash);
  if (hashCategory) return hashCategory;

  const urlCategory = parseCategoryFromUrl(window.location.search);
  if (urlCategory) return urlCategory;

  return null;
}

function detectCurrentUserZwiftId() {
  const profileLinks = document.querySelectorAll(PROFILE_LINK_SELECTOR);

  for (const link of profileLinks) {
    if (link.closest('table')) continue;

    const match = link.href.match(ZWIFT_ID_PATTERN);
    if (match) return match[1];
  }

  const highlightedRow = document.querySelector(`tr.${HIGHLIGHTED_ROW_CLASS}`);
  if (highlightedRow) {
    const link = highlightedRow.querySelector(PROFILE_LINK_SELECTOR);
    const match = link?.href?.match(ZWIFT_ID_PATTERN);
    if (match) return match[1];
  }

  return null;
}

async function waitForTableData(maxWaitMs = TABLE_LOAD_TIMEOUT_MS) {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const { table } = getActiveCategory();
    if (table) {
      const profileLinks = table.querySelectorAll('a[href*="profile.php"], a[href*="/profile/"]');
      if (profileLinks.length > 0) {
        return true;
      }
    }

    const profileLinks = document.querySelectorAll('table a[href*="profile.php"]');
    if (profileLinks.length > 0) {
      return true;
    }

    await new Promise(r => setTimeout(r, TABLE_POLL_INTERVAL_MS));
  }

  return false;
}


function findPositionFromCells(cells) {
  if (cells[0]) {
    const firstCellPos = parsePosition(cells[0].textContent, MAX_VALID_POSITION);
    if (firstCellPos) return firstCellPos;
  }

  for (const cell of cells) {
    const pos = parsePosition(cell.textContent, MAX_VALID_POSITION);
    if (pos) return pos;
  }

  return null;
}

function findPositionFromRow(row) {
  const cells = row.querySelectorAll('td');
  const cellPosition = findPositionFromCells(cells);
  if (cellPosition) return cellPosition;

  const tbody = row.closest('tbody');
  if (tbody) {
    const rows = [...tbody.querySelectorAll('tr')];
    const rowIndex = rows.indexOf(row) + 1;
    return rowIndex <= MAX_VALID_POSITION ? rowIndex : null;
  }

  return null;
}

function parseRiderFromRow(row, link, currentUserZwiftId) {
  const position = findPositionFromRow(row);
  if (!position) return null;

  const zwiftId = extractZwiftId(link.href);
  if (!zwiftId) return null;

  const name = link.textContent.trim();
  if (!name) return null;

  return {
    position,
    name,
    zwiftId,
    isCurrentUser: zwiftId === currentUserZwiftId,
  };
}

function getRidersFromPage() {
  const currentUserZwiftId = detectCurrentUserZwiftId();
  const { categoryId, categoryName, table } = getActiveCategory();

  if (!table) {
    return { riders: [], currentUserZwiftId, categoryId: null, categoryName: null };
  }

  const profileLinks = table.querySelectorAll(
    'a[href*="profile.php"], a[href*="/profile/"], a[href*="zwift_id"]'
  );

  const seenZwiftIds = new Set();
  const riders = [];

  for (const link of profileLinks) {
    const row = link.closest('tr');
    if (!row) continue;

    const rider = parseRiderFromRow(row, link, currentUserZwiftId);
    if (!rider) continue;
    if (seenZwiftIds.has(rider.zwiftId)) continue;

    seenZwiftIds.add(rider.zwiftId);
    riders.push(rider);
  }

  return {
    riders: riders.sort((a, b) => a.position - b.position),
    currentUserZwiftId,
    categoryId,
    categoryName,
  };
}


const AUTH_ERROR = 'Log in to ZwiftPower and try again.';
const RATE_LIMIT_ERROR = 'ZwiftPower is rate limiting requests - try again in a few minutes.';
const ANALYSIS_REQUEST_OPTIONS = {
  headers: {
    'accept': 'application/json',
    'x-requested-with': 'XMLHttpRequest',
  },
  credentials: 'include',
};

async function fetchTextWithTimeout(url, options, signal, timeoutMs = FETCH_TIMEOUT_MS) {
  signal.throwIfAborted();
  const controller = new AbortController();
  const abortWithSignal = () => controller.abort(signal.reason);
  const timeoutId = setTimeout(
    () => controller.abort(new Error(`Request timeout after ${timeoutMs}ms`)),
    timeoutMs
  );
  signal.addEventListener('abort', abortWithSignal, { once: true });

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return {
      status: response.status,
      url: response.url,
      contentType: response.headers.get('content-type') || '',
      bodyText: response.ok ? await response.text() : '',
    };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', abortWithSignal);
  }
}

async function requestAnalysis(url, zwiftId, signal) {
  try {
    const response = await fetchTextWithTimeout(url, ANALYSIS_REQUEST_OPTIONS, signal);
    return { kind: classifyAnalysisResponse(response), bodyText: response.bodyText };
  } catch (error) {
    signal.throwIfAborted();
    console.log(`[ZP Replay] Fetch failed for rider ${zwiftId}: ${error.message}`);
    return { kind: 'server-error' };
  }
}

function toRiderAnalysis(data) {
  return {
    distance: data.xData,
    time: data.x2Data || [],
    power: data.datasets?.['1']?.data || [],
    heartRate: data.datasets?.['2']?.data || [],
    elevation: data.datasets?.['0']?.data || [],
    duration: data.x2Data?.length || 0,
    totalDistance: data.xData[data.xData.length - 1] || 0,
  };
}

async function waitForRateLimit(attempt, signal) {
  if (attempt >= MAX_RATE_LIMIT_RETRIES) throw new Error(RATE_LIMIT_ERROR);
  await delay(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt, signal);
}

async function fetchRiderAnalysis(zwiftId, eventId, signal) {
  const url = `${ZWIFTPOWER_API_BASE}?do=analysis&zwift_id=${zwiftId}&zwift_event_id=${eventId}`;
  let serverRetries = 0;
  let rateLimitRetries = 0;

  for (;;) {
    const { kind, bodyText } = await requestAnalysis(url, zwiftId, signal);

    if (kind === 'ok') return toRiderAnalysis(JSON.parse(bodyText));
    if (kind === 'auth') throw new Error(AUTH_ERROR);

    if (kind === 'rate-limited') {
      await waitForRateLimit(rateLimitRetries++, signal);
      continue;
    }

    if (kind === 'server-error' && serverRetries < MAX_RETRIES) {
      serverRetries++;
      await delay(DELAY_BETWEEN_REQUESTS_MS, signal);
      continue;
    }

    console.log(`[ZP Replay] No analysis for rider ${zwiftId}: ${kind}`);
    return null;
  }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    };
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function updateSyncStatus({ eventId, raceKey }, fields) {
  const syncStatus = { ...fields, eventId, raceKey, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [SYNC_STATUS_KEY]: syncStatus });
}

/**
 * Get existing race data from storage
 */
async function getExistingRaceData(eventId) {
  const existing = await chrome.storage.local.get(SYNCED_RACES_KEY);
  const races = existing[SYNCED_RACES_KEY] || {};
  return races[eventId] || null;
}

/**
 * Save race data to storage, enforcing max limit
 */
async function saveRaceData(raceData) {
  const existing = await chrome.storage.local.get(SYNCED_RACES_KEY);
  const races = existing[SYNCED_RACES_KEY] || {};

  // If adding a new race and at limit, remove oldest
  if (!races[raceData.eventId]) {
    const raceIds = Object.keys(races);
    if (raceIds.length >= MAX_SYNCED_RACES) {
      const oldest = raceIds.reduce((oldestId, id) => {
        if (!oldestId) return id;
        return new Date(races[id].syncedAt) < new Date(races[oldestId].syncedAt) ? id : oldestId;
      }, null);
      if (oldest) {
        delete races[oldest];
      }
    }
  }

  races[raceData.eventId] = raceData;
  await chrome.storage.local.set({ [SYNCED_RACES_KEY]: races });
}

function cancelSync() {
  currentSyncAbortController?.abort();
  currentSyncAbortController = null;
}

function beginSync() {
  cancelSync();
  currentSyncAbortController = new AbortController();
  return currentSyncAbortController.signal;
}

async function prepareSyncContext() {
  const eventId = getEventIdFromUrl();
  if (!eventId) {
    throw new Error('Not on a ZwiftPower event page');
  }

  await waitForTableData(TABLE_LOAD_TIMEOUT_MS);

  const eventName = getEventName();
  const { riders: allRiders, currentUserZwiftId, categoryId, categoryName } = getRidersFromPage();

  if (allRiders.length === 0) {
    throw new Error('No riders found in category.');
  }

  const ridersToSync = selectRidersToSync(allRiders, MAX_RIDERS_TO_SYNC);
  const fullEventName = categoryName ? `${eventName} - ${categoryName}` : eventName;
  const raceKey = buildRaceKey(eventId, categoryId);

  const existingRace = await getExistingRaceData(raceKey);
  const existingRiderIds = new Set(existingRace?.riders?.map(r => r.zwiftId) || []);
  const newRidersToSync = ridersToSync.filter(r => !existingRiderIds.has(r.zwiftId));

  return {
    eventId,
    raceKey,
    fullEventName,
    allRiders,
    ridersToSync,
    newRidersToSync,
    existingRace,
    currentUserZwiftId,
    categoryId,
    categoryName,
  };
}

function createRiderWithAnalysis(rider, analysis) {
  return {
    position: rider.position,
    name: rider.name,
    zwiftId: rider.zwiftId,
    isCurrentUser: rider.isCurrentUser,
    ...analysis,
  };
}

function createRaceResult(ctx, riderData, errors, syncProgress, syncInProgress) {
  return {
    eventId: ctx.raceKey,
    eventName: ctx.fullEventName,
    riders: riderData,
    errors,
    totalRiders: ctx.allRiders.length,
    syncedRiders: ctx.ridersToSync.length,
    successfulSyncs: riderData.length,
    currentUserZwiftId: ctx.currentUserZwiftId,
    categoryId: ctx.categoryId,
    categoryName: ctx.categoryName,
    syncedAt: new Date().toISOString(),
    syncInProgress,
    syncProgress,
  };
}

const NOT_READY_ERROR = 'Race analysis not ready yet. ZwiftPower may still be processing - try again later.';

async function syncRiders(ctx, riderData, errors, signal) {
  const total = ctx.newRidersToSync.length;
  let consecutiveFailures = 0;

  for (let i = 0; i < total; i++) {
    signal.throwIfAborted();

    const rider = ctx.newRidersToSync[i];

    await updateSyncStatus(ctx, {
      status: 'syncing',
      eventName: ctx.fullEventName,
      current: i + 1,
      total,
      riderName: rider.name,
      riderPosition: rider.position,
      consecutiveFailures,
    });

    if (i > 0) await delay(DELAY_BETWEEN_REQUESTS_MS, signal);

    const analysis = await fetchRiderAnalysis(rider.zwiftId, ctx.eventId, signal);

    if (!analysis) {
      consecutiveFailures++;
      errors.push(rider.position);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(riderData.length === 0
          ? NOT_READY_ERROR
          : `Sync stopped: ${consecutiveFailures} consecutive failures. Try again later.`);
      }
      continue;
    }

    consecutiveFailures = 0;
    riderData.push(createRiderWithAnalysis(rider, analysis));
    await saveRaceData(createRaceResult(ctx, riderData, errors, { current: i + 1, total }, true));
  }
}

async function saveFinishedRace(ctx, riderData, errors) {
  const raceResult = createRaceResult(ctx, riderData, errors, null, false);
  if (riderData.length > 0) {
    await saveRaceData(raceResult);
  }
  return raceResult;
}

async function finishCancelledSync(ctx, riderData, errors) {
  const raceResult = await saveFinishedRace(ctx, riderData, errors);
  await updateSyncStatus(ctx, { status: 'cancelled', eventName: ctx.fullEventName });
  return raceResult;
}

async function syncRaceData(signal) {
  const ctx = await prepareSyncContext();

  if (ctx.newRidersToSync.length === 0) {
    await updateSyncStatus(ctx, {
      status: 'complete',
      eventName: ctx.fullEventName,
      successfulSyncs: ctx.existingRace.riders.length,
      totalRiders: ctx.allRiders.length,
      errors: 0,
      message: 'All riders already synced',
    });
    return ctx.existingRace;
  }

  const riderData = [...(ctx.existingRace?.riders || [])];
  const errors = [];

  try {
    await syncRiders(ctx, riderData, errors, signal);
  } catch (error) {
    if (!signal.aborted) {
      await saveFinishedRace(ctx, riderData, errors);
      throw error;
    }
  }

  if (signal.aborted) {
    return finishCancelledSync(ctx, riderData, errors);
  }

  if (riderData.length === 0) {
    throw new Error(NOT_READY_ERROR);
  }

  const raceResult = await saveFinishedRace(ctx, riderData, errors);

  await updateSyncStatus(ctx, {
    status: 'complete',
    eventName: ctx.fullEventName,
    successfulSyncs: riderData.length,
    totalRiders: ctx.allRiders.length,
    errors: errors.length,
  });

  return raceResult;
}

function finishSync(signal) {
  if (currentSyncAbortController?.signal === signal) {
    currentSyncAbortController = null;
  }
}

async function runSync() {
  const signal = beginSync();
  const eventId = getEventIdFromUrl();
  const target = { eventId, raceKey: buildRaceKey(eventId, detectActiveCategoryId()) };

  try {
    await updateSyncStatus(target, { status: 'starting' });
    const data = await syncRaceData(signal);
    return { success: true, data, cancelled: signal.aborted };
  } catch (error) {
    await updateSyncStatus(target, { status: 'error', error: error.message });
    return { success: false, error: error.message };
  } finally {
    finishSync(signal);
  }
}

const replayControl = {
  eventId: null,
  elements: null,
  raceKey: null,
  state: null,
  syncStatus: null,
  races: {},
};

const replayViewers = [];

const CONTROL_BUTTON_ACTIONS = {
  idle: () => startSyncFromControl({ watchWhenDone: true }),
  error: () => startSyncFromControl({ watchWhenDone: true }),
  synced: () => watchReplay(replayControl.raceKey),
};

const CONTROL_LINK_ACTIONS = {
  cancel: () => cancelSyncFromControl(),
  resync: () => startSyncFromControl({ watchWhenDone: false }),
};

function requestOpenReplay(raceKey) {
  chrome.runtime.sendMessage({ action: 'openReplay', eventId: raceKey })
    .catch(error => console.log(`[ZP Replay] Could not open replay: ${error.message}`));
}

function watchReplay(raceKey) {
  const watchedInline = raceKey === replayControl.raceKey && replayViewers.some(viewer => viewer.watch(raceKey));
  if (!watchedInline) requestOpenReplay(raceKey);
}

async function startSyncFromControl({ watchWhenDone }) {
  replayControl.elements.button.disabled = true;
  const result = await runSync();
  if (watchWhenDone && result.success && !result.cancelled) {
    watchReplay(result.data.eventId);
  }
}

function cancelSyncFromControl() {
  if (currentSyncAbortController) {
    cancelSync();
    return;
  }
  updateSyncStatus({ eventId: replayControl.eventId, raceKey: replayControl.raceKey }, { status: 'cancelled' });
}

function createControlElement(tagName, className) {
  const element = document.createElement(tagName);
  element.className = className;
  return element;
}

function createControlButton(className, onClick) {
  const button = createControlElement('button', className);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

function createReplayControlElements() {
  const root = createControlElement('div', 'zp-replay');
  const actions = createControlElement('div', 'zp-replay-actions');
  const buttonWrap = createControlElement('span', 'zp-replay-button-wrap');
  const progress = createControlElement('span', 'zp-replay-progress');
  const progressFill = createControlElement('span', 'zp-replay-progress-fill');
  const button = createControlButton('zp-replay-button', () => CONTROL_BUTTON_ACTIONS[replayControl.state?.kind]?.());
  const link = createControlButton('zp-replay-link', () => CONTROL_LINK_ACTIONS[replayControl.state?.link]?.());
  const status = createControlElement('div', 'zp-replay-status');

  progress.append(progressFill);
  buttonWrap.append(button, progress);
  actions.append(buttonWrap, link);
  root.append(actions, status);
  return { root, button, progress, progressFill, link, status };
}

function applyReplayControlState(elements, state) {
  elements.button.textContent = state.buttonLabel;
  elements.button.disabled = state.kind === 'syncing';
  elements.link.textContent = CONTROL_LINK_LABELS[state.link] || '';
  elements.link.hidden = !state.link;
  elements.progress.hidden = state.progress === null;
  elements.progressFill.style.width = `${state.progress ?? 0}%`;
  elements.status.textContent = state.statusText;
  elements.status.title = state.statusText;
  elements.status.classList.toggle('zp-replay-status-error', state.isError);
}

function findCategoryFilterAnchor() {
  const buttons = document.querySelectorAll(CATEGORY_FILTER_SELECTOR);
  const lastButton = buttons[buttons.length - 1];
  return lastButton?.closest('.btn-group') || lastButton || null;
}

function findReplayControlPlacement() {
  const filterAnchor = findCategoryFilterAnchor();
  if (filterAnchor) return { standalone: false, mount: root => filterAnchor.after(root) };

  const { table } = getActiveCategory();
  const tableAnchor = table?.closest('.dataTables_wrapper') || table;
  return tableAnchor ? { standalone: true, mount: root => tableAnchor.before(root) } : null;
}

function ensureReplayControlMounted() {
  const { root } = replayControl.elements;
  if (root.isConnected) return;

  const placement = findReplayControlPlacement();
  if (!placement) return;

  root.classList.toggle(CONTROL_STANDALONE_CLASS, placement.standalone);
  placement.mount(root);
}

function getActiveRaceKey() {
  return buildRaceKey(replayControl.eventId, detectActiveCategoryId());
}

function renderReplayControl() {
  const raceKey = getActiveRaceKey();
  const state = buildReplayControlState({
    syncStatus: replayControl.syncStatus,
    raceSummary: replayControl.races[raceKey],
    raceKey,
    now: Date.now(),
    maxAgeMs: SYNC_STATUS_MAX_AGE_MS,
  });

  Object.assign(replayControl, { raceKey, state });
  applyReplayControlState(replayControl.elements, state);
  ensureReplayControlMounted();
}

function refreshReplayControl() {
  const categoryChanged = getActiveRaceKey() !== replayControl.raceKey;
  if (categoryChanged || !replayControl.elements.root.isConnected) {
    renderReplayControl();
  }
  refreshReplayViewers();
}

function registerReplayViewer(viewer) {
  replayViewers.push(viewer);
  if (replayControl.raceKey) viewer.refresh(replayControl.raceKey);
}

function refreshReplayViewers() {
  replayViewers.forEach(viewer => viewer.refresh(replayControl.raceKey));
}

function updateReplayViewerRaces(races) {
  replayViewers.forEach(viewer => viewer.racesChanged(races));
}

function updateReplayControlData(values) {
  if (SYNC_STATUS_KEY in values) {
    replayControl.syncStatus = values[SYNC_STATUS_KEY] ?? null;
  }
  if (SYNCED_RACES_KEY in values) {
    replayControl.races = summarizeSyncedRaces(values[SYNCED_RACES_KEY]);
  }
}

function handleReplayStorageChange(changes, areaName) {
  const keys = [SYNC_STATUS_KEY, SYNCED_RACES_KEY].filter(key => key in changes);
  if (areaName !== 'local' || keys.length === 0) return;

  updateReplayControlData(Object.fromEntries(keys.map(key => [key, changes[key].newValue])));
  renderReplayControl();
  if (SYNCED_RACES_KEY in changes) updateReplayViewerRaces(changes[SYNCED_RACES_KEY].newValue);
}

function watchCategorySwitches() {
  const refreshSoon = debounce(refreshReplayControl, CONTROL_REFRESH_DELAY_MS);
  document.addEventListener('click', (event) => {
    if (event.target.closest?.(CATEGORY_BUTTON_SELECTOR)) refreshSoon();
  });
  window.addEventListener('hashchange', refreshSoon);
}

function watchPageChanges() {
  const refresh = throttle(refreshReplayControl, CONTROL_MOUNT_THROTTLE_MS);
  new MutationObserver(() => refresh()).observe(document.body, { childList: true, subtree: true });
}

async function initReplayControl() {
  replayControl.eventId = getEventIdFromUrl();
  if (!replayControl.eventId) return;

  replayControl.elements = createReplayControlElements();
  updateReplayControlData(await chrome.storage.local.get([SYNC_STATUS_KEY, SYNCED_RACES_KEY]));
  renderReplayControl();
  refreshReplayViewers();

  chrome.storage.onChanged.addListener(handleReplayStorageChange);
  watchCategorySwitches();
  watchPageChanges();
}

// Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'cancelSync') {
    cancelSync();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'getPageInfo') {
    (async () => {
      const eventId = getEventIdFromUrl();
      if (!eventId) {
        sendResponse({ isEventPage: false });
        return;
      }

      await waitForTableData(PAGE_INFO_TIMEOUT_MS);

      const { riders, categoryId, categoryName } = getRidersFromPage();
      const ridersToSync = selectRidersToSync(riders, MAX_RIDERS_TO_SYNC);

      sendResponse({
        eventId,
        eventName: getEventName(),
        riderCount: riders.length,
        syncCount: ridersToSync.length,
        isEventPage: true,
        userParticipates: riders.some(r => r.isCurrentUser),
        categoryId,
        categoryName,
      });
    })();
    return true;
  }

  if (message.action === 'startSync') {
    runSync().then(sendResponse);
    return true;
  }

  return false;
});

initReplayControl();
