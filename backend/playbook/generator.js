function formatElapsedHours(hours) {
  const safeHours = Number.isFinite(hours) ? Math.max(0, hours) : 0;
  const totalMinutes = Math.round(safeHours * 60);
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (wholeHours === 0) return `${minutes}m`;
  if (minutes === 0) return `${wholeHours}h`;
  return `${wholeHours}h ${minutes}m`;
}

function buildTrafficSection(state, durationHours) {
  const evacuation = state?.evacuation || {};
  const routeCongestion = evacuation.route_congestion || [];
  const trafficJams = evacuation.traffic_jams || [];
  const activeRoutes = routeCongestion
    .filter(route => route.status === 'congested' || route.status === 'closed')
    .map(route => `${route.route_id}: ${route.status} (${route.load_pct}% load)`);

  const jamLines = trafficJams.map(jam => {
    const elapsed = jam.elapsed_hours != null ? ` at ${formatElapsedHours(jam.elapsed_hours)}` : '';
    return `${jam.route_id}: ${jam.severity} jam${elapsed}`;
  });

  const contentLines = [...activeRoutes, ...jamLines];

  return {
    title: 'Traffic and Congestion',
    content: contentLines.length > 0
      ? contentLines.join('\n')
      : 'No active route congestion reported.',
    agent: 'traffic',
    elapsed_hours: durationHours,
    time_elapsed: formatElapsedHours(durationHours),
  };
}

function generatePlaybook(sections, scenario, state = {}, metadata = {}) {
  // Accept either a structured ScenarioInput object or a legacy plain string
  const scenarioLabel =
    typeof scenario === 'string'
      ? scenario
      : (scenario?.location ?? JSON.stringify(scenario));
  const durationHours = metadata.durationHours || scenario?.durationHours || 6;
  const playbookSections = [
    ...sections.map((s, i) => {
      const elapsedHours = Number.isFinite(s.elapsed_hours)
        ? s.elapsed_hours
        : Math.min(durationHours, i + 1);
      return {
        title: s.title || `Section ${i + 1}`,
        content: s.content || '',
        agent: s.agent || 'synthesis',
        tick: s.tick || i + 1,
        elapsed_hours: elapsedHours,
        time_elapsed: formatElapsedHours(elapsedHours),
      };
    }),
    buildTrafficSection(state, durationHours),
  ];

  return {
    title: 'EMBER INCIDENT RESPONSE PLAYBOOK',
    scenario: scenarioLabel,
    duration_hours: durationHours,
    sections: playbookSections,
    summary: playbookSections.length > 0
      ? `This playbook was generated from a ${formatElapsedHours(durationHours)} simulation covering wildfire incident response for the scenario: "${scenarioLabel.substring(0, 100)}..."`
      : 'No playbook sections were generated during this simulation.',
    generated_at: new Date().toISOString(),
  };
}

module.exports = { generatePlaybook, formatElapsedHours };
