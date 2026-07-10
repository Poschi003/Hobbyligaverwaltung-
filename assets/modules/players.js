(function () {
  function getAll(state) {
    if (!state || typeof state !== "object") return [];
    return Array.isArray(state.players) ? state.players : [];
  }

  function findById(state, playerId) {
    return getAll(state).find((player) => player.id === playerId) || null;
  }

  function exists(state, playerId) {
    return !!findById(state, playerId);
  }

  function getName(state, playerId, fallback = "Unbekannter Spieler") {
    const player = findById(state, playerId);
    return typeof player?.name === "string" && player.name ? player.name : fallback;
  }

  function getTeam(state, playerId) {
    const player = findById(state, playerId);
    if (!player) return null;
    return window.HobbyligaTeams.findById(state, player.teamId);
  }

  function update(state, playerId, changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new TypeError("HobbyligaPlayers.update erwartet changes als Objekt.");
    }
    const player = findById(state, playerId);
    if (!player) return null;
    const { id, ...safeChanges } = changes;
    Object.assign(player, safeChanges);
    return player;
  }

  function remove(state, playerId) {
    const players = getAll(state);
    const index = players.findIndex((player) => player.id === playerId);
    if (index < 0) return false;
    players.splice(index, 1);
    return true;
  }

  window.HobbyligaPlayers = {
    getAll,
    findById,
    exists,
    getName,
    getTeam,
    update,
    remove,
  };
})();
