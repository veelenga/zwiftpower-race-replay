(() => {
  const GRAPH_ID = 'segment_graph';
  const PROFILE_ATTRIBUTE = 'data-zp-profile';
  const POLL_INTERVAL_MS = 250;
  const POLL_TIMEOUT_MS = 30000;

  function findProfileChart() {
    return (window.Highcharts?.charts || []).find(chart => chart?.renderTo?.id === GRAPH_ID) || null;
  }

  function lastXValue(series) {
    const xData = series?.xData || [];
    return xData[xData.length - 1];
  }

  function readCourseKm(chart) {
    const values = chart.series.map(lastXValue).filter(Number.isFinite);
    return values.length > 0 ? Math.max(...values) : undefined;
  }

  function profileJson(chart, courseKm) {
    const axis = chart.xAxis[0];
    return JSON.stringify({
      xMin: axis?.min,
      xMax: axis?.max,
      plotLeft: chart.plotLeft,
      plotTop: chart.plotTop,
      plotWidth: chart.plotWidth,
      plotHeight: chart.plotHeight,
      courseKm,
    });
  }

  function publish(chart, courseKm) {
    const json = profileJson(chart, courseKm);
    if (chart.renderTo.getAttribute(PROFILE_ATTRIBUTE) !== json) chart.renderTo.setAttribute(PROFILE_ATTRIBUTE, json);
  }

  function watchLater() {
    const startedAt = Date.now();
    setTimeout(() => watchForChart(startedAt), POLL_INTERVAL_MS);
  }

  function attach(chart) {
    const { addEvent } = window.Highcharts;
    const { renderTo } = chart;
    let courseKm = readCourseKm(chart);
    publish(chart, courseKm);
    addEvent(chart, 'load', () => {
      courseKm = readCourseKm(chart);
      publish(chart, courseKm);
    });
    addEvent(chart, 'redraw', () => publish(chart, courseKm));
    addEvent(chart, 'destroy', () => {
      renderTo.removeAttribute(PROFILE_ATTRIBUTE);
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
