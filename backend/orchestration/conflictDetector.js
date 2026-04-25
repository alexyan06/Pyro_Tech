function detectConflicts(agentOutputs) {
  const conflicts = [];
  const closedRoutes = new Set();
  const openedRoutes = new Set();

  for (const output of agentOutputs) {
    for (const event of output.mapEvents) {
      if (event.type === 'close_route') {
        if (openedRoutes.has(event.route_id)) {
          conflicts.push({
            agents: [output.agent, findAgentForEvent(agentOutputs, 'open_route', event.route_id)],
            issue: `Route ${event.route_id}: one agent closes, another opens`,
          });
        }
        closedRoutes.add(event.route_id);
      }
      if (event.type === 'open_route') {
        if (closedRoutes.has(event.route_id)) {
          conflicts.push({
            agents: [output.agent, findAgentForEvent(agentOutputs, 'close_route', event.route_id)],
            issue: `Route ${event.route_id}: one agent opens, another closes`,
          });
        }
        openedRoutes.add(event.route_id);
      }
    }
  }

  return conflicts;
}

function findAgentForEvent(outputs, eventType, routeId) {
  for (const output of outputs) {
    for (const event of output.mapEvents) {
      if (event.type === eventType && event.route_id === routeId) {
        return output.agent;
      }
    }
  }
  return 'unknown';
}

module.exports = { detectConflicts };
