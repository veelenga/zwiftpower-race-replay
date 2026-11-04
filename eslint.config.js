const js = require('@eslint/js');
const globals = require('globals');

const sharedUtils = Object.keys(require('./src/utils'));

const contentScriptApi = [
  'createControlElement',
  'createControlButton',
  'currentReplayRaceKey',
  'getExistingRaceData',
  'requestOpenReplay',
];

const inlineReplayApi = ['refreshInlineReplay', 'handleInlineRacesChanged', 'watchInlineReplay'];

const readonlyGlobals = names => Object.fromEntries(names.map(name => [name, 'readonly']));

const unusedExceptApi = api => ['error', { varsIgnorePattern: `^(${api.join('|')})$` }];

const scriptOptions = { ecmaVersion: 2022, sourceType: 'script' };

module.exports = [
  { ignores: ['node_modules/**', 'dist/**', 'src/lib/**'] },
  js.configs.recommended,
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
      globals: readonlyGlobals(contentScriptApi),
    },
    rules: {
      'no-unused-vars': unusedExceptApi(inlineReplayApi),
    },
  },
  {
    files: ['src/content.js'],
    rules: {
      'no-unused-vars': unusedExceptApi(contentScriptApi),
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
