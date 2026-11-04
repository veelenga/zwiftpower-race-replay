const js = require('@eslint/js');
const globals = require('globals');

const sharedUtils = [
  'formatTime',
  'formatTimeGap',
  'formatRelativeTime',
  'timeToIndex',
  'extractZwiftId',
  'calcSpeed',
  'calcTimeGapFromDistance',
  'calcTimeGap',
  'detectGroups',
  'selectRidersToSync',
  'isValidPosition',
  'lerp',
  'clamp',
  'calcGroupAveragePower',
  'calcGroupAverageHR',
  'filterRidersByName',
  'escapeHtml',
  'isValidEventId',
  'highlightMatch',
  'isValidCategory',
  'parseCategoryFromHash',
  'parseCategoryFromUrl',
  'formatCategoryName',
  'parsePosition',
  'findClosestIndex',
  'getValueAtDistance',
  'isSyncStatusForEvent',
  'isSyncStatusStale',
  'buildRaceKey',
  'summarizeSyncedRaces',
  'buildReplayControlState',
  'classifyAnalysisResponse',
  'parseJsonOrUndefined',
  'debounce',
  'throttle',
  'sampleChartWindow',
  'resolveShortcut',
  'stepSpeed',
  'parseCourseDistanceKm',
  'resolveCourseKm',
  'distanceToProfileX',
  'buildCurveLookup',
  'parseProfileGeometry',
  'mapDistanceToAxisX',
  'classifyAxisDistance',
  'transformPlotBox',
  'alignNearEdges',
  'computeRaceStandings',
  'calcStandingGap',
  'calcGapToGroupAhead',
  'advancePlaybackTime',
  'calcRaceDuration',
  'findWatchedRider',
  'resolveWatchedRider',
  'buildWatchOptions',
  'shortRiderName',
  'riderMarkerRole',
  'buildRiderStatsText',
];

const contentScriptApi = [
  'createControlElement',
  'createControlButton',
  'getExistingRaceData',
  'registerReplayViewer',
  'requestOpenReplay',
];

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'src/lib/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        module: 'readonly',
        Chart: 'readonly',
      },
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/utils.js', 'src/profile-bridge.js'],
    languageOptions: {
      globals: Object.fromEntries(sharedUtils.map(name => [name, 'readonly'])),
    },
  },
  {
    files: ['src/profile-bridge.js'],
    languageOptions: {
      globals: { chrome: 'off', browser: 'off' },
    },
  },
  {
    files: ['src/inline-replay.js'],
    languageOptions: {
      globals: Object.fromEntries(contentScriptApi.map(name => [name, 'readonly'])),
    },
  },
  {
    files: ['src/content.js'],
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: `^(${contentScriptApi.join('|')})$` }],
    },
  },
  {
    files: ['tests/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.jest },
    },
  },
];
