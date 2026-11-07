# ZwiftPower Race Replay

A browser extension that syncs Zwift races from ZwiftPower and replays them on the event page's own course profile.

## Features

- **Sync race data**: pulls rider data from a ZwiftPower race page
- **Inline replay**: plays the race on ZwiftPower's course profile, right on the event page
- **Rider markers**: every rider is a dot on the profile; hover for power and gaps, click to follow that rider
- **Group detection**: riders within 5 seconds of each other form a group
- **Playback controls**: play, pause, scrub and change speed, with keyboard shortcuts

## Installation

### Chrome

1. Clone this repository:
   ```bash
   git clone https://github.com/veelenga/zwiftpower-race-replay.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the `zwiftpower-race-replay` folder

### Firefox

1. Clone this repository and switch to the Firefox manifest:
   ```bash
   git clone https://github.com/veelenga/zwiftpower-race-replay.git
   cd zwiftpower-race-replay
   npm run build:firefox
   ```
2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Select the `manifest.json` file from the project folder

> **Note**: To switch back to Chrome, run `npm run build:chrome`

## Usage

1. **Log in to ZwiftPower**: make sure you are logged in to [zwiftpower.com](https://zwiftpower.com)
2. **Open a race**: go to any race results page (e.g. `zwiftpower.com/events.php?zid=XXXXX`) and pick a category
3. **Sync the race**: press "Replay race" next to the category buttons, or click the extension icon and press "Sync race"
   - The extension syncs the top 50 riders and you (if outside the top 50)
   - Progress is shown during sync
4. **Watch the replay**: a sync started from the page plays the replay on the course profile when it finishes. Press "Watch replay" to play it again later
5. **Explore**:
   - Use the play button, time slider and speed buttons under the profile
   - Press Space to play or pause and the arrow keys to seek (hold Shift for bigger steps)
   - Click a rider on the profile or pick one in "Watching" to follow them
6. **Come back later**: the extension popup lists synced races; "Open race" opens the race page on ZwiftPower

## Data privacy

- All data is stored locally in your browser
- The extension only accesses ZwiftPower when you explicitly sync a race
- No data is sent to any external servers
