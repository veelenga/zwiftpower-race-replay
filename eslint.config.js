const js = require('@eslint/js');
const globals = require('globals');

const utilsExports = Object.keys(require('./src/utils'));
const raceExports = Object.keys(require('./src/race'));

const readonlyGlobals = names => Object.fromEntries(names.map(name => [name, 'readonly']));

const scriptOptions = { ecmaVersion: 2022, sourceType: 'script' };

module.exports = [
  { ignores: ['node_modules/**', 'dist/**'] },
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
      },
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/utils.js', 'src/profile-bridge.js'],
    languageOptions: {
      globals: readonlyGlobals(utilsExports),
    },
  },
  {
    files: ['src/**/*.js'],
    ignores: ['src/utils.js', 'src/race.js', 'src/popup.js', 'src/profile-bridge.js'],
    languageOptions: {
      globals: readonlyGlobals(raceExports),
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
      globals: readonlyGlobals(['getExistingRaceData', 'replayControl']),
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
