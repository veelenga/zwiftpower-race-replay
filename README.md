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

### From Source (Developer Mode)

1. Clone this repository:
   ```bash
   git clone https://github.com/yourusername/zwiftpower-race-replay.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top right)

4. Click "Load unpacked" and select the `zwiftpower-race-replay` folder

### From Chrome Web Store

*Coming soon*

## Usage

1. **Login to ZwiftPower**: Make sure you're logged into [zwiftpower.com](https://zwiftpower.com)

2. **Navigate to a Race**: Go to any race results page (e.g., `zwiftpower.com/events.php?zid=XXXXX`)

3. **Sync the Race**: Click the extension icon and press "Sync Race"
   - The extension syncs the top 40 riders + you (if outside top 40)
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

- **Manifest V3** Chrome extension
- Pure JavaScript (no framework dependencies)
- Uses Chrome Storage API for local data persistence
- Fetches data from ZwiftPower's internal API endpoints

## Limitations

- Requires ZwiftPower login (uses your authenticated session)
- Syncs top 40 riders to avoid rate limiting
- Race data is as accurate as ZwiftPower's analysis data

## License

MIT License - see [LICENSE](LICENSE) for details

## Contributing

Contributions welcome! Please feel free to submit issues and pull requests.

## Acknowledgments

- [ZwiftPower](https://zwiftpower.com) for providing race data
- [Chart.js](https://www.chartjs.org/) for power visualization
