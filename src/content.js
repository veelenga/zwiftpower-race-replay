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
const MAX_CONSECUTIVE_FAILURES = 5;
const PROFILE_LINK_SELECTOR = 'a[href*="profile.php?z="]';
const ZWIFT_ID_PATTERN = /z=(\d+)/;
const TABLE_LOAD_TIMEOUT_MS = 5000;
const PAGE_INFO_TIMEOUT_MS = 3000;
const TABLE_POLL_INTERVAL_MS = 200;
const MAX_VALID_POSITION = 200;
const MAX_SYNCED_RACES = 15;

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
    const text = response.ok ? await response.text() : '';
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener('abort', abortWithSignal);
  }
}

/**
 * Fetch analysis data for a single rider with retry logic
 */
async function fetchRiderAnalysis(zwiftId, eventId, signal, retries = MAX_RETRIES) {
  const url = `${ZWIFTPOWER_API_BASE}?do=analysis&zwift_id=${zwiftId}&zwift_event_id=${eventId}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchTextWithTimeout(url, {
        headers: {
          'accept': 'application/json',
          'x-requested-with': 'XMLHttpRequest',
        },
        credentials: 'include',
      }, signal);

      if (!response.ok) {
        console.log(`[ZP Replay] HTTP ${response.status} for rider ${zwiftId}`);
        if (attempt < retries && response.status >= 500) {
          await delay(DELAY_BETWEEN_REQUESTS_MS, signal);
          continue;
        }
        return null;
      }

      const { text } = response;
      if (!text || text.trim() === '') {
        return null;
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.log(`[ZP Replay] Invalid JSON for rider ${zwiftId}`);
        return null;
      }

      if (!data.xData || data.xData.length === 0) {
        return null;
      }

      return {
        distance: data.xData || [],
        time: data.x2Data || [],
        power: data.datasets?.['1']?.data || [],
        heartRate: data.datasets?.['2']?.data || [],
        elevation: data.datasets?.['0']?.data || [],
        duration: data.x2Data?.length || 0,
        totalDistance: data.xData?.[data.xData.length - 1] || 0,
      };
    } catch (error) {
      signal.throwIfAborted();
      console.log(`[ZP Replay] Fetch failed for rider ${zwiftId}: ${error.message}`);
      if (attempt < retries) {
        await delay(DELAY_BETWEEN_REQUESTS_MS, signal);
        continue;
      }
      return null;
    }
  }
  return null;
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

async function updateSyncStatus(eventId, fields) {
  const syncStatus = { ...fields, eventId, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ syncStatus });
}

/**
 * Get existing race data from storage
 */
async function getExistingRaceData(eventId) {
  const existing = await chrome.storage.local.get('syncedRaces');
  const races = existing.syncedRaces || {};
  return races[eventId] || null;
}

/**
 * Save race data to storage, enforcing max limit
 */
async function saveRaceData(raceData) {
  const existing = await chrome.storage.local.get('syncedRaces');
  const races = existing.syncedRaces || {};

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
  await chrome.storage.local.set({ syncedRaces: races });
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
  const fullEventId = categoryId ? `${eventId}_${categoryId}` : eventId;

  const existingRace = await getExistingRaceData(fullEventId);
  const existingRiderIds = new Set(existingRace?.riders?.map(r => r.zwiftId) || []);
  const newRidersToSync = ridersToSync.filter(r => !existingRiderIds.has(r.zwiftId));

  return {
    eventId,
    fullEventId,
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
    eventId: ctx.fullEventId,
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

    await updateSyncStatus(ctx.eventId, {
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

async function finishCancelledSync(ctx, riderData, errors) {
  const raceResult = createRaceResult(ctx, riderData, errors, null, false);
  if (riderData.length > 0) {
    await saveRaceData(raceResult);
  }
  await updateSyncStatus(ctx.eventId, { status: 'cancelled', eventName: ctx.fullEventName });
  return raceResult;
}

async function syncRaceData(signal) {
  const ctx = await prepareSyncContext();

  if (ctx.newRidersToSync.length === 0) {
    await updateSyncStatus(ctx.eventId, {
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
    if (!signal.aborted) throw error;
  }

  if (signal.aborted) {
    return finishCancelledSync(ctx, riderData, errors);
  }

  if (riderData.length === 0) {
    throw new Error(NOT_READY_ERROR);
  }

  const raceResult = createRaceResult(ctx, riderData, errors, null, false);
  await saveRaceData(raceResult);

  await updateSyncStatus(ctx.eventId, {
    status: 'complete',
    eventName: ctx.fullEventName,
    successfulSyncs: riderData.length,
    totalRiders: ctx.allRiders.length,
    errors: errors.length,
  });

  return raceResult;
}

async function runSync() {
  const signal = beginSync();
  const eventId = getEventIdFromUrl();

  try {
    await updateSyncStatus(eventId, { status: 'starting' });
    const data = await syncRaceData(signal);
    return { success: true, data };
  } catch (error) {
    await updateSyncStatus(eventId, { status: 'error', error: error.message });
    return { success: false, error: error.message };
  }
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
