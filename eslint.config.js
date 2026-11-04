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
  'highlightMatch',
  'isValidCategory',
  'parseCategoryFromHash',
  'parseCategoryFromUrl',
  'formatCategoryName',
  'parsePosition',
  'findClosestIndex',
  'getValueAtDistance',
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
    ignores: ['src/utils.js'],
    languageOptions: {
      globals: Object.fromEntries(sharedUtils.map(name => [name, 'readonly'])),
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
