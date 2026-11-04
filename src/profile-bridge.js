(() => {
  const GRAPH_ID = 'segment_graph';
  const POLL_INTERVAL_MS = 250;
  const POLL_TIMEOUT_MS = 30000;
  const DATASET_PREFIX = 'zp';

  function findProfileChart() {
    return (window.Highcharts?.charts || []).find(chart => chart?.renderTo?.id === GRAPH_ID) || null;
  }

  function lastXValue(series) {
    const xData = series?.xData || [];
    return xData[xData.length - 1];
  }

  function courseKm(chart) {
    const values = chart.series.map(lastXValue).filter(Number.isFinite);
    return values.length > 0 ? Math.max(...values) : undefined;
  }

  function profileValues(chart) {
    const axis = chart.xAxis[0];
    return {
      zpXMin: axis?.min,
      zpXMax: axis?.max,
      zpPlotLeft: chart.plotLeft,
      zpPlotWidth: chart.plotWidth,
      zpPlotTop: chart.plotTop,
      zpPlotHeight: chart.plotHeight,
      zpCourseKm: courseKm(chart),
    };
  }

  function writeValue(dataset, key, value) {
    if (!Number.isFinite(value)) {
      delete dataset[key];
      return;
    }
    const text = String(value);
    if (dataset[key] !== text) dataset[key] = text;
  }

  function publish(chart) {
    Object.entries(profileValues(chart)).forEach(([key, value]) => writeValue(chart.renderTo.dataset, key, value));
  }

  function clear({ dataset }) {
    Object.keys(dataset).filter(key => key.startsWith(DATASET_PREFIX)).forEach(key => delete dataset[key]);
  }

  function watchLater() {
    const startedAt = Date.now();
    setTimeout(() => watchForChart(startedAt), POLL_INTERVAL_MS);
  }

  function attach(chart) {
    const { addEvent } = window.Highcharts;
    const { renderTo } = chart;
    publish(chart);
    addEvent(chart, 'load', () => publish(chart));
    addEvent(chart, 'redraw', () => publish(chart));
    addEvent(chart, 'destroy', () => {
      clear(renderTo);
      watchLater();
    });
  }

  function watchForChart(startedAt) {
    const chart = findProfileChart();
    if (chart && typeof window.Highcharts.addEvent === 'function') {
      attach(chart);
      return;
    }
    if (Date.now() - startedAt < POLL_TIMEOUT_MS) {
      setTimeout(() => watchForChart(startedAt), POLL_INTERVAL_MS);
    }
  }

  watchForChart(Date.now());
})();
