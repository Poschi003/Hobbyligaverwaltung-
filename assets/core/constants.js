(function () {
  const STORAGE_KEY = "la-bowling-hobbyliga-v4-season-2526";
  const AUTH_SESSION_KEY = "la-bowling-hobbyliga-session";
  const BIOMETRIC_KEY = "la-bowling-hobbyliga-biometric";

  const DEFAULT_VIEW = "playerDashboard";

  const NAV_ITEMS = [
    ["playerDashboard", "H", "Mein Dashboard", ["player"]],
    ["upcomingGames", ">", "Kommende Spiele", ["player"]],
    ["playerStats", "%", "Statistiken", ["player"]],
    ["playerSubmitResults", "+", "Ergebnisse erfassen", ["player"]],
    ["adminDashboard", "A", "Admin-Dashboard", ["admin"]],
    ["cashierDashboard", "E", "Kasse", ["cashier"]],
    ["league", "L", "Liga-Details", ["admin"]],
    ["schedule", "#", "Spielplan", ["admin", "player"]],
    ["results", "+", "Ergebnisse", ["admin"]],
    ["table", "=", "Tabelle", ["admin"]],
    ["leaders", "*", "Bestenlisten", ["admin"]],
    ["fines", "E", "Strafen", ["admin", "cashier"]],
    ["news", "!", "News", ["admin"]],
    ["admin", "@", "Verwaltung", ["admin"]],
  ];

  const ROLE_LABELS = {
    admin: "Admin",
    cashier: "Kassierer",
    player: "Spieler",
  };

  const FIXTURE_STATUS_LABELS = {
    open: "Offen",
    planned: "geplant",
    postponed: "verschoben",
    makeup: "Nachholspiel",
    submitted: "Eingereicht",
    released: "Freigegeben",
    rejected: "Abgelehnt",
    played: "gespielt",
  };

  window.HobbyligaConstants = {
    STORAGE_KEY,
    AUTH_SESSION_KEY,
    BIOMETRIC_KEY,
    DEFAULT_VIEW,
    NAV_ITEMS,
    ROLE_LABELS,
    FIXTURE_STATUS_LABELS,
  };
})();
