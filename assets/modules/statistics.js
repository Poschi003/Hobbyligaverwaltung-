(function () {
  function getPlayers(state) {
    return state && Array.isArray(state.players) ? state.players : [];
  }

  function getFixtures(state) {
    return state && Array.isArray(state.fixtures) ? state.fixtures : [];
  }

  function findPlayer(state, playerId) {
    return getPlayers(state).find((player) => player.id === playerId) || null;
  }

  function clamp(value, min, max) {
    return Math.min(Number(max), Math.max(Number(min), value));
  }

  function getPlayerScores(state, playerId, untilFixtureId = null) {
    const rows = [];
    for (const fixture of getFixtures(state)) {
      if (!fixture.saved || !fixture.confirmed) continue;
      if (untilFixtureId && fixture.id === untilFixtureId) continue;
      for (const game of fixture.games || []) {
        Object.entries(game.scores || {}).forEach(([scorePlayerId, score]) => {
          if ((playerId === null || scorePlayerId === playerId) && Number.isFinite(score.gross)) {
            rows.push({ fixtureId: fixture.id, day: fixture.day, playerId: scorePlayerId, gross: score.gross });
          }
        });
      }
    }
    return rows;
  }

  function getPlayerStats(state, playerId, untilFixtureId = null) {
    const player = findPlayer(state, playerId);
    const baseline = player?.initialStats || { games: 0, pins: 0, high: 0 };
    const scores = getPlayerScores(state, playerId, untilFixtureId);
    const games = baseline.games + scores.length;
    const pins = baseline.pins + scores.reduce((sum, row) => sum + row.gross, 0);
    const average = games ? pins / games : 0;
    const valid = games >= 3;
    const league = state?.league || {};
    const rawHandicap = Math.round((league.handicapBase - average) * league.handicapFactor);
    const handicap = valid ? clamp(rawHandicap, league.handicapMin, league.handicapMax) : null;
    const high = scores.reduce((max, row) => Math.max(max, row.gross), baseline.high || 0);
    return { games, pins, average, valid, handicap, high };
  }

  function getPlayerRanking(state) {
    return getPlayers(state)
      .map((player) => ({ player, stats: getPlayerStats(state, player.id) }))
      .filter((row) => row.stats.valid)
      .sort((a, b) => b.stats.average - a.stats.average || a.player.name.localeCompare(b.player.name));
  }

  function getLeadersByGender(state, gender) {
    if (!state || typeof state !== "object") return [];
    const players = getPlayers(state).filter((player) => player.gender === gender);
    const average = players
      .map((player) => ({ player, team: window.HobbyligaPlayers.getTeam(state, player.id), stats: getPlayerStats(state, player.id) }))
      .filter((row) => row.stats.valid)
      .sort((a, b) => b.stats.average - a.stats.average);
    const highs = players
      .map((player) => ({ player, team: window.HobbyligaPlayers.getTeam(state, player.id), high: getPlayerStats(state, player.id).high }))
      .filter((row) => row.high > 0)
      .sort((a, b) => b.high - a.high);
    return { average, highs };
  }

  function getHighestGame(state) {
    return getPlayers(state)
      .map((player) => ({ player, team: window.HobbyligaPlayers.getTeam(state, player.id), high: getPlayerStats(state, player.id).high }))
      .filter((row) => row.high > 0)
      .sort((a, b) => b.high - a.high)[0] || null;
  }

  function getBestAverage(state) {
    return getPlayerRanking(state)[0] || null;
  }

  window.HobbyligaStatistics = {
    getPlayerStats,
    getPlayerScores,
    getPlayerRanking,
    getLeadersByGender,
    getHighestGame,
    getBestAverage,
  };
})();
