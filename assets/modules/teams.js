(function () {
  function getAll(state) {
    if (!state || typeof state !== "object") return [];
    return Array.isArray(state.teams) ? state.teams : [];
  }

  function findById(state, teamId) {
    return getAll(state).find((team) => team.id === teamId) || null;
  }

  function getName(state, teamId, fallback = "Unbekanntes Team") {
    const team = findById(state, teamId);
    return typeof team?.name === "string" && team.name ? team.name : fallback;
  }

  function exists(state, teamId) {
    return !!findById(state, teamId);
  }

  function update(state, teamId, changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new TypeError("HobbyligaTeams.update erwartet changes als Objekt.");
    }
    const team = findById(state, teamId);
    if (!team) return null;
    const { id, ...safeChanges } = changes;
    Object.assign(team, safeChanges);
    return team;
  }

  function remove(state, teamId) {
    const teams = getAll(state);
    const index = teams.findIndex((team) => team.id === teamId);
    if (index < 0) return false;
    teams.splice(index, 1);
    return true;
  }

  window.HobbyligaTeams = {
    getAll,
    findById,
    getName,
    exists,
    update,
    remove,
  };
})();
