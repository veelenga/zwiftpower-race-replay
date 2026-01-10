# ZwiftPower Race Replay

A browser extension that lets you sync and replay Zwift races with detailed visualizations.

## Features

- **Sync Race Data**: Automatically extracts rider data from ZwiftPower race pages
- **Interactive Replay**: Watch the race unfold with real-time position updates
- **Group Detection**: Dynamic grouping based on time gaps (5-second threshold)
- **Power Analysis**: Compare your power output against other riders or groups
- **Course Profile**: Zoomable elevation profile with rider markers
- **Rider Selection**: Click any rider to analyze their race perspective

## Installation

### Chrome

1. Clone this repository:
   ```bash
   git clone https://github.com/veelenga/zwiftpower-race-reply.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked" and select the `zwiftpower-race-replay` folder

### Firefox

1. Clone this repository and switch to the Firefox manifest:
   ```bash
   git clone https://github.com/veelenga/zwiftpower-race-reply.git
   cd zwiftpower-race-replay
   npm run build:firefox
   ```

2. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`

3. Click "Load Temporary Add-on..."

4. Select the `manifest.json` file from the project folder

> **Note**: To switch back to Chrome, run `npm run build:chrome`

## Usage

1. **Login to ZwiftPower**: Make sure you're logged into [zwiftpower.com](https://zwiftpower.com)

2. **Navigate to a Race**: Go to any race results page (e.g., `zwiftpower.com/events.php?zid=XXXXX`)

3. **Sync the Race**: Click the extension icon and press "Sync Race"
   - The extension syncs the top 50 riders + you (if outside top 50)
   - Progress is shown during sync

4. **Open Replay**: Once synced, click "Replay" to open the visualization

5. **Analyze**:
   - Use playback controls to navigate through the race
   - Click riders on the course profile or standings to change perspective
   - Zoom into specific sections by dragging on the profile
   - Compare power with groups or individual riders

## Data Privacy

- All data is stored locally in your browser
- The extension only accesses ZwiftPower when you explicitly sync a race
- No data is sent to any external servers

## Development

```bash
# Install dependencies (none required currently)

# Load the extension in Chrome developer mode
# Make changes and reload the extension to test
```

## Technical Details

- **Manifest V3** browser extension (Chrome & Firefox)
- Pure JavaScript (no framework dependencies)
- Uses browser Storage API for local data persistence
- Fetches data from ZwiftPower's internal API endpoints

## Limitations

- Requires ZwiftPower login (uses your authenticated session)
- Syncs top 50 riders to avoid rate limiting
- Race data is as accurate as ZwiftPower's analysis data

## License

MIT License - see [LICENSE](LICENSE) for details

## Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## Acknowledgments

- [ZwiftPower](https://zwiftpower.com) for providing race data
- [Chart.js](https://www.chartjs.org/) for power visualization
