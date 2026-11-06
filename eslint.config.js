const js = require('@eslint/js');
const globals = require('globals');

const sharedUtils = Object.keys(require('./src/utils'));

const readonlyGlobals = names => Object.fromEntries(names.map(name => [name, 'readonly']));

const scriptOptions = { ecmaVersion: 2022, sourceType: 'script' };

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'src/lib/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    rules: {
      'no-unused-vars': ['error', { vars: 'local' }],
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/profile-bridge.js'],
    languageOptions: {
      ...scriptOptions,
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
      globals: readonlyGlobals(sharedUtils),
    },
  },
  {
    files: ['src/profile-bridge.js'],
    languageOptions: {
      ...scriptOptions,
      globals: globals.browser,
    },
  },
  {
    files: ['src/inline-replay.js'],
    languageOptions: {
      globals: readonlyGlobals(['getExistingRaceData', 'requestOpenReplay', 'replayControl']),
    },
  },
  {
    files: ['src/content.js'],
    languageOptions: {
      globals: readonlyGlobals(['refreshInlineReplay', 'handleInlineRacesChanged', 'watchInlineReplay']),
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
