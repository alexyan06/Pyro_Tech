const { GoogleGenAI } = require('@google/genai');

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

function buildFallbackSummary(sections, state, metadata) {
  const fire = state.fire || {};
  const evac = state.evacuation || {};
  const resources = state.resources || {};
  const infra = state.infrastructure || {};
  const tickSummaries = state.tick_summaries || [];
  const durationHours = metadata.durationHours || 6;

  const decisions = tickSummaries.flatMap(t => t.key_decisions || []).slice(0, 6);
  const decisionText = decisions.length > 0
    ? `Key decisions included: ${decisions.join('; ')}.`
    : '';

  const infraOffline = infra.facilities_offline || 0;
  const infraText = infraOffline > 0
    ? ` ${infraOffline} infrastructure facilit${infraOffline === 1 ? 'y was' : 'ies were'} taken offline by the fire perimeter.`
    : '';

  const lastSummary = tickSummaries[tickSummaries.length - 1] || {};
  const contained = lastSummary.percent_contained ?? 0;

  return `This playbook covers a ${formatElapsedHours(durationHours)} wildfire incident response simulation. ` +
    `The fire burned approximately ${(fire.acres_burned || 0).toLocaleString()} acres with ${contained}% containment achieved. ` +
    `A total of ${(evac.total_evacuees || 0).toLocaleString()} residents were evacuated across ${Object.keys(evac.zones || {}).length} zones. ` +
    `${resources.engines_deployed || 0} engine companies and ${resources.crews_deployed || 0} hand crews were deployed. ` +
    `${decisionText}${infraText}`;
}

async function generateExecutiveSummary(transcripts, sections, state, metadata) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    console.log('[generator] No API key — using fallback summary');
    return buildFallbackSummary(sections, state, metadata);
  }

  const durationHours = metadata.durationHours || 6;
  const fire = state.fire || {};
  const evac = state.evacuation || {};
  const resources = state.resources || {};
  const infra = state.infrastructure || {};
  const tickSummaries = state.tick_summaries || [];

  const statsBlock = [
    `Duration: ${formatElapsedHours(durationHours)}`,
    `Acres burned: ${(fire.acres_burned || 0).toLocaleString()}`,
    `Containment: ${tickSummaries[tickSummaries.length - 1]?.percent_contained ?? 0}%`,
    `Total evacuees: ${(evac.total_evacuees || 0).toLocaleString()}`,
    `Engines deployed: ${resources.engines_deployed || 0}`,
    `Crews deployed: ${resources.crews_deployed || 0}`,
    `Air tankers active: ${resources.air_tankers_active || 0}`,
    `Infrastructure offline: ${infra.facilities_offline || 0}`,
    `Routes closed: ${evac.routes_closed || 0}`,
  ].join('\n');

  const sectionsBlock = sections
    .map(s => `[${s.title}] ${s.content}`)
    .join('\n');

  const tickBlock = tickSummaries
    .map(t => `Cycle ${t.tick}: decisions=[${(t.key_decisions || []).join('; ')}] priorities=[${(t.next_priorities || []).join('; ')}]`)
    .join('\n');

  // Group transcripts by cycle and truncate to stay within context limits
  const MAX_TRANSCRIPT_CHARS = 14_000;
  let transcriptBlock = '';
  const byGroup = {};
  for (const t of transcripts) {
    const key = `Cycle ${t.cycle} (+${formatElapsedHours(t.elapsed_hours)})`;
    byGroup[key] = byGroup[key] || [];
    byGroup[key].push(`[${t.agent.toUpperCase()}]: ${t.text.substring(0, 400)}`);
  }
  for (const [label, lines] of Object.entries(byGroup)) {
    const block = `\n--- ${label} ---\n${lines.join('\n')}\n`;
    if (transcriptBlock.length + block.length > MAX_TRANSCRIPT_CHARS) break;
    transcriptBlock += block;
  }

  const userPrompt = [
    'FINAL STATISTICS:',
    statsBlock,
    '\nCOMMAND DECISIONS (per cycle):',
    tickBlock || '(none)',
    '\nPLAYBOOK SECTIONS:',
    sectionsBlock || '(none)',
    '\nAGENT RADIO TRANSCRIPTS:',
    transcriptBlock || '(none)',
  ].join('\n');

  const systemInstruction = `You are writing the Executive Summary of an Incident Response Playbook for a wildfire simulation.
Write 4–6 paragraphs covering: (1) incident overview and weather/conditions at onset, (2) fire behavior and spread progression, (3) evacuation and traffic management decisions, (4) resources deployed and containment actions, (5) infrastructure impacts, (6) overall outcome and key lessons. Be specific, authoritative, and factual. Use past tense. Do not use bullet points — prose only.`;

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction,
        maxOutputTokens: 2048,
        thinkingConfig: { thinkingBudget: 0 },
      },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });
    const text = response.text?.trim();
    if (!text) throw new Error('Empty response');
    console.log('[generator] Executive summary generated via Gemini');
    return text;
  } catch (err) {
    console.warn('[generator] Executive summary LLM call failed, using fallback:', err.message);
    return buildFallbackSummary(sections, state, metadata);
  }
}

function generatePlaybook(sections, scenario, state = {}, metadata = {}, executiveSummary = null) {
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
    summary: executiveSummary || (playbookSections.length > 0
      ? `This playbook was generated from a ${formatElapsedHours(durationHours)} simulation covering wildfire incident response for the scenario: "${scenarioLabel.substring(0, 100)}..."`
      : 'No playbook sections were generated during this simulation.'),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { generatePlaybook, generateExecutiveSummary, formatElapsedHours };
