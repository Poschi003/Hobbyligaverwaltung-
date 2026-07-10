(function () {
  function getGames(fixture) {
    return fixture && Array.isArray(fixture.games) ? fixture.games : [];
  }

  function getGame(fixture, gameNumber) {
    return getGames(fixture).find((game) => game.number === Number(gameNumber)) || null;
  }

  function getScore(fixture, gameNumber, playerId) {
    const game = getGame(fixture, gameNumber);
    return game?.scores?.[playerId] || null;
  }

  function setScore(fixture, gameNumber, playerId, score) {
    if (!score || typeof score !== "object" || Array.isArray(score)) {
      throw new TypeError("HobbyligaResults.setScore erwartet score als Objekt.");
    }
    const game = getGame(fixture, gameNumber);
    if (!fixture || !game) return false;
    game.scores ||= {};
    game.scores[playerId] = score;
    return true;
  }

  function clearScores(fixture) {
    const games = getGames(fixture);
    if (!fixture || !games.length) return false;
    games.forEach((game) => {
      game.scores = {};
    });
    return true;
  }

  function isSaved(fixture) {
    return fixture?.saved === true;
  }

  function isConfirmed(fixture) {
    return fixture?.confirmed === true;
  }

  window.HobbyligaResults = {
    getGames,
    getGame,
    getScore,
    setScore,
    clearScores,
    isSaved,
    isConfirmed,
  };
})();
