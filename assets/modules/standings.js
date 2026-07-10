(function () {
  function getTeams(state) {
    return state && Array.isArray(state.teams) ? state.teams : [];
  }

  function getPlayers(state) {
    return state && Array.isArray(state.players) ? state.players : [];
  }

  function getFixtures(state) {
    return state && Array.isArray(state.fixtures) ? state.fixtures : [];
  }

  function playersForTeam(state, teamId) {
    return getPlayers(state).filter((player) => player.teamId === teamId);
  }

  function lineupForTeam(state, teamId, playersPerTeam) {
    return playersForTeam(state, teamId).slice(0, playersPerTeam);
  }

  function playersForScoredGame(state, game, teamId, playersPerTeam) {
    const teamPlayers = playersForTeam(state, teamId);
    const scored = teamPlayers.filter((player) => Number.isFinite(game.scores[player.id]?.gross));
    return scored.length ? scored : lineupForTeam(state, teamId, playersPerTeam);
  }

  function rulesForFixture(state, fixture) {
    return window.HobbyligaResults.isConfirmed(fixture) && window.HobbyligaRules.getRulesSnapshot(fixture)
      ? window.HobbyligaRules.getRulesSnapshot(fixture)
      : window.HobbyligaRules.createSnapshot(state);
  }

  function calculate(state, includeSubmitted = false) {
    if (!state || typeof state !== "object") return [];
    if (!state.league || typeof state.league !== "object") return [];
    const rows = getTeams(state).map((team) => ({
      team,
      played: 0,
      points: 0,
      gamesWon: 0,
      gamesLost: 0,
      pins: 0,
      against: 0,
    }));

    const rowFor = (teamId) => rows.find((row) => row.team.id === teamId);
    (state.importedStandings || []).forEach((imported) => {
      const row = rowFor(imported.teamId);
      if (!row) return;
      row.played = imported.played || 0;
      row.points = imported.points || 0;
      row.pointsLost = imported.pointsLost || 0;
      row.gamesWon = imported.gamesWon || 0;
      row.gamesLost = imported.gamesLost || 0;
      row.pins = imported.pins || 0;
      row.grossPins = imported.grossPins || 0;
      row.against = imported.against || 0;
    });

    getFixtures(state).filter((fixture) => fixture.saved && (fixture.confirmed || (includeSubmitted && fixture.status === "submitted"))).forEach((fixture) => {
      if (state.importedStandingsThroughDay && fixture.day <= state.importedStandingsThroughDay) return;
      const rules = rulesForFixture(state, fixture);
      const home = rowFor(fixture.homeTeamId);
      const away = rowFor(fixture.awayTeamId);
      home.played += 1;
      away.played += 1;
      home.points += fixture.points.home;
      away.points += fixture.points.away;
      home.pins += fixture.totals.homeNet;
      away.pins += fixture.totals.awayNet;
      home.against += fixture.totals.awayNet;
      away.against += fixture.totals.homeNet;

      fixture.games.forEach((game) => {
        const homeNet = playersForScoredGame(state, game, fixture.homeTeamId, rules.playersPerTeam).reduce((sum, player) => sum + (game.scores[player.id]?.net || 0), 0);
        const awayNet = playersForScoredGame(state, game, fixture.awayTeamId, rules.playersPerTeam).reduce((sum, player) => sum + (game.scores[player.id]?.net || 0), 0);
        if (homeNet > awayNet) {
          home.gamesWon += 1;
          away.gamesLost += 1;
        } else if (awayNet > homeNet) {
          away.gamesWon += 1;
          home.gamesLost += 1;
        }
      });
    });

    return rows.sort((a, b) => {
      const primary = b.points - a.points;
      if (primary) return primary;
      if (state.league.tableSort === "pointsThenDiff") return b.pins - b.against - (a.pins - a.against) || b.pins - a.pins || a.team.name.localeCompare(b.team.name);
      return b.pins - a.pins || a.team.name.localeCompare(b.team.name);
    });
  }

  function getTeamRow(state, teamId) {
    return calculate(state).find((row) => row.team.id === teamId) || null;
  }

  function getRanking(state) {
    return calculate(state);
  }

  window.HobbyligaStandings = {
    calculate,
    getTeamRow,
    getRanking,
  };
})();
