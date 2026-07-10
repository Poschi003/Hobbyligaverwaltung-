(function () {
  const SNAPSHOT_KEYS = [
    "gamesPerMatch",
    "playersPerTeam",
    "handicapEnabled",
    "handicapBase",
    "handicapFactor",
    "handicapMin",
    "handicapMax",
    "fineLimit",
    "fineAmount",
    "pointsPerGameWin",
    "pointsPerGameTie",
    "pointsTotalWin",
    "pointsTotalTie",
    "tableSort",
  ];

  function getLeagueRules(state) {
    return state?.league || null;
  }

  function getRulesSnapshot(fixture) {
    return fixture?.rulesSnapshot || null;
  }

  function setRulesSnapshot(fixture, snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError("HobbyligaRules.setRulesSnapshot erwartet snapshot als Objekt.");
    }
    if (!fixture || typeof fixture !== "object") return false;
    fixture.rulesSnapshot = snapshot;
    return true;
  }

  function createSnapshot(state) {
    const league = getLeagueRules(state);
    if (!league) return null;
    return SNAPSHOT_KEYS.reduce((snapshot, key) => {
      snapshot[key] = league[key];
      return snapshot;
    }, {});
  }

  function isAutoConfirmEnabled(state) {
    return state?.league?.autoConfirmResults === true;
  }

  window.HobbyligaRules = {
    getLeagueRules,
    getRulesSnapshot,
    setRulesSnapshot,
    createSnapshot,
    isAutoConfirmEnabled,
  };
})();
