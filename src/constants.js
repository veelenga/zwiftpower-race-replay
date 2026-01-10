// ZwiftPower URL patterns
export const ZWIFTPOWER_BASE_URL = 'https://zwiftpower.com';
export const ZWIFTPOWER_EVENT_PATTERN = /zwiftpower\.com\/events\.php\?zid=(\d+)/;
export const ZWIFTPOWER_API_BASE = 'https://zwiftpower.com/api3.php';

// Race configuration
export const TOTAL_DISTANCE_KM = 42;
export const GROUP_GAP_THRESHOLD_SECONDS = 5;
export const DEFAULT_SPEED_KMH = 40;
export const MIN_SPEED_KMH = 10;

// UI configuration
export const PLAYBACK_SPEEDS = [1, 5, 10, 30];
export const DEFAULT_PLAYBACK_SPEED = 10;
export const CHART_WINDOW_SIZE_SECONDS = 600;
export const CHART_SAMPLE_INTERVAL = 10;

// Storage keys
export const STORAGE_KEY_RACES = 'syncedRaces';

// Group colors for visualization
export const GROUP_COLORS = [
  '#ffd700', // gold - lead group
  '#58a6ff', // blue
  '#a371f7', // purple
  '#3fb950', // green
  '#f0883e', // orange
  '#ff7b72', // red
  '#79c0ff', // light blue
  '#d2a8ff', // light purple
  '#7ee787', // light green
  '#ffa657', // light orange
];

// Zoom configuration
export const MIN_ZOOM_SELECTION_PX = 20;

// Elevation profile dimensions
export const ELEVATION_CONTAINER_HEIGHT = 220;
export const ELEVATION_SVG_HEIGHT = 180;
