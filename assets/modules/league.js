(function () {
  function get(state) {
    if (!state || typeof state !== "object") return null;
    return state.league || null;
  }

  function getSeasonName(state) {
    const league = get(state);
    return typeof league?.season === "string" && league.season ? league.season : "Saison";
  }

  function getGamesPerMatch(state) {
    const league = get(state);
    return league?.gamesPerMatch || 1;
  }

  function update(state, changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new TypeError("HobbyligaLeague.update erwartet changes als Objekt.");
    }
    const league = get(state);
    if (!league) return null;
    Object.assign(league, changes);
    return league;
  }

  window.HobbyligaLeague = {
    get,
    getSeasonName,
    getGamesPerMatch,
    update,
  };
})();
