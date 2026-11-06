(() => {
  const GRAPH_ID = 'segment_graph';
  const PROFILE_ATTRIBUTE = 'data-zp-profile';
  const POLL_INTERVAL_MS = 250;
  const POLL_TIMEOUT_MS = 30000;

  function curveRows({ series, plotTop, plotWidth }) {
    const ys = new Array(Math.round(plotWidth) + 1);
    series.forEach(({ points = [] }) => points.forEach(({ plotX, plotY }) => {
      if (plotX >= 0 && plotX <= plotWidth && Number.isFinite(plotY)) ys[Math.round(plotX)] = Math.round(plotTop + plotY);
    }));
    let previous = ys.find(y => y !== undefined);
    return Array.from(ys, y => (previous = y ?? previous));
  }

  function publish(chart) {
    const { min, max } = chart.xAxis[0];
    const json = JSON.stringify({
      xMin: min,
      xMax: max,
      plotLeft: chart.plotLeft,
      plotWidth: chart.plotWidth,
      plotTop: chart.plotTop,
      plotHeight: chart.plotHeight,
      courseKm: Math.max(...chart.series.map(({ xData }) => xData?.at(-1) ?? 0)),
      ys: curveRows(chart),
    });
    if (chart.renderTo.getAttribute(PROFILE_ATTRIBUTE) !== json) chart.renderTo.setAttribute(PROFILE_ATTRIBUTE, json);
  }

  function attach(chart) {
    const { renderTo } = chart;
    publish(chart);
    window.Highcharts.addEvent(chart, 'redraw', () => publish(chart));
    window.Highcharts.addEvent(chart, 'destroy', () => {
      renderTo.removeAttribute(PROFILE_ATTRIBUTE);
      setTimeout(() => waitForChart(), POLL_INTERVAL_MS);
    });
  }

  function waitForChart(deadline = Date.now() + POLL_TIMEOUT_MS) {
    const chart = window.Highcharts?.charts?.find(candidate => candidate?.renderTo?.id === GRAPH_ID);
    if (chart) attach(chart);
    else if (Date.now() < deadline) setTimeout(() => waitForChart(deadline), POLL_INTERVAL_MS);
  }

  waitForChart();
})();
