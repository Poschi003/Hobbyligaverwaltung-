(function () {
  function getAll(state) {
    if (!state || typeof state !== "object") return [];
    return Array.isArray(state.fixtures) ? state.fixtures : [];
  }

  function findById(state, fixtureId) {
    return getAll(state).find((fixture) => fixture.id === fixtureId) || null;
  }

  function exists(state, fixtureId) {
    return Boolean(findById(state, fixtureId));
  }

  function getDays(state) {
    return [...new Set(getAll(state).map((fixture) => Number(fixture.day)).filter(Number.isFinite))].sort((a, b) => a - b);
  }

  function getByDay(state, day) {
    const targetDay = Number(day);
    if (!Number.isFinite(targetDay)) return [];
    return getAll(state).filter((fixture) => Number(fixture.day) === targetDay);
  }

  function getByTeam(state, teamId) {
    return getAll(state).filter((fixture) => fixture.homeTeamId === teamId || fixture.awayTeamId === teamId);
  }

  function getNextOpen(state) {
    return getAll(state)
      .filter((fixture) => !(fixture.saved === true && fixture.confirmed === true))
      .slice()
      .sort((a, b) => {
        const dayDiff = Number(a.day || 0) - Number(b.day || 0);
        if (dayDiff) return dayDiff;
        const dateDiff = String(a.date || "").localeCompare(String(b.date || ""));
        if (dateDiff) return dateDiff;
        return String(a.time || "").localeCompare(String(b.time || ""));
      })[0] || null;
  }

  function update(state, fixtureId, changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw new TypeError("HobbyligaSchedule.update erwartet changes als Objekt.");
    }
    const fixture = findById(state, fixtureId);
    if (!fixture) return null;
    const { id, ...safeChanges } = changes;
    Object.assign(fixture, safeChanges);
    return fixture;
  }

  function remove(state, fixtureId) {
    const fixtures = getAll(state);
    const index = fixtures.findIndex((fixture) => fixture.id === fixtureId);
    if (index < 0) return false;
    fixtures.splice(index, 1);
    return true;
  }

  window.HobbyligaSchedule = {
    getAll,
    findById,
    exists,
    getDays,
    getByDay,
    getByTeam,
    getNextOpen,
    update,
    remove,
  };
})();
