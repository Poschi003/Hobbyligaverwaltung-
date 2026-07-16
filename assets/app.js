const {
  STORAGE_KEY,
  AUTH_SESSION_KEY,
  BIOMETRIC_KEY,
  DEFAULT_VIEW,
  NAV_ITEMS: navItems,
  ROLE_LABELS: roleLabels,
  FIXTURE_STATUS_LABELS: fixtureStatusLabels,
} = window.HobbyligaConstants;

let currentView = DEFAULT_VIEW;
let state = window.HobbyligaState.initialize({
  storageKey: STORAGE_KEY,
  normalize: normalizeState,
  createInitialState: createSeedState,
});
let pendingFirstLoginUserId = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

async function hashSecret(secret) {
  const bytes = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function biometricAvailable() {
  return !!(window.PublicKeyCredential && navigator.credentials);
}

function randomChallenge(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuffer(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function normalizeState(data) {
  data.users ||= [];
  data.players ||= [];
  data.league = normalizeLeagueRules(data.league || {});
  const existingByPlayer = new Set(data.users.map((user) => user.playerId).filter(Boolean));
  data.users = data.users.map((user) => normalizeUser(user, data.players));

  data.players.forEach((player) => {
    if (!existingByPlayer.has(player.id)) {
      data.users.push(createPlayerUser(player));
    }
  });

  if (!data.users.some((user) => user.role === "admin")) {
    data.users.unshift({
      id: "user-admin",
      name: "Liga Admin",
      username: "admin",
      email: "admin@la-bowling.local",
      bootstrapPassword: "admin123",
      firstLoginCompleted: true,
      role: "admin",
    });
  }

  if (!data.users.some((user) => user.role === "cashier")) {
    data.users.push({
      id: "user-cashier",
      name: "Kasse",
      username: "kasse",
      email: "kasse@la-bowling.local",
      bootstrapPassword: "kasse123",
      firstLoginCompleted: true,
      role: "cashier",
    });
  }

  const primaryAdmin = data.users.find((user) => user.id === "user-admin") || data.users.find((user) => user.role === "admin");
  if (primaryAdmin) {
    primaryAdmin.username = "admin";
    primaryAdmin.email = primaryAdmin.email || "admin@la-bowling.local";
    primaryAdmin.bootstrapPassword ||= primaryAdmin.password || "admin123";
    primaryAdmin.firstLoginCompleted = true;
  }

  [
    ["user-anna", "anna2026"],
    ["user-lars", "lars2026"],
    ["user-mia", "mia2026"],
  ].forEach(([id, code]) => {
    const demoUser = data.users.find((user) => user.id === id);
    if (demoUser && !demoUser.firstLoginCompleted && !demoUser.passwordHash) {
      demoUser.tempPasswordHash = null;
      demoUser.bootstrapPassword = code;
    }
  });

  if (!data.activeUserId || !data.users.some((user) => user.id === data.activeUserId)) {
    data.activeUserId = data.users.find((user) => user.role === "admin")?.id || data.users[0]?.id;
  }

  data.fixtures ||= [];
  data.fixtures.forEach((fixture) => {
    fixture.confirmed = fixture.confirmed ?? !!fixture.saved;
    fixture.rulesSnapshot ||= fixture.saved ? { ...data.league } : null;
    fixture.games ||= Array.from({ length: data.league.gamesPerMatch }, (_, index) => ({ number: index + 1, scores: {} }));
    fixture.date ||= defaultFixtureDate(fixture.day);
    fixture.time ||= "19:00";
    fixture.venue ||= data.league.venue || "LA Bowlingcenter";
    fixture.status ||= fixture.saved ? "released" : "planned";
    fixture.teamSubmissions ||= {};
    fixture.blindPlayers ||= {};
    fixture.activationRequests ||= [];
    fixture.activation ||= null;
  });
  data.fines ||= [];

  return data;
}

function normalizeLeagueRules(league) {
  return {
    name: league.name || "LA Bowling Hobbyliga",
    season: league.season || "Saison 2026",
    venue: league.venue || "LA Bowlingcenter",
    mode: league.mode || "3 gegen 3",
    gamesPerMatch: Number(league.gamesPerMatch || 3),
    playersPerTeam: Number(league.playersPerTeam || 3),
    handicapEnabled: league.handicapEnabled !== false,
    handicapBase: Number(league.handicapBase || 200),
    handicapFactor: Number(league.handicapFactor || 0.75),
    handicapMin: Number(league.handicapMin ?? 0),
    handicapMax: Number(league.handicapMax ?? 60),
    fineLimit: Number(league.fineLimit && league.fineLimit <= 300 ? league.fineLimit : 150),
    fineAmount: Number(league.fineAmount ?? league.finePerPlayer ?? 1),
    finePerPlayer: Number(league.fineAmount ?? league.finePerPlayer ?? 1),
    pointsPerGameWin: Number(league.pointsPerGameWin || 2),
    pointsPerGameTie: Number(league.pointsPerGameTie ?? 1),
    pointsTotalWin: Number(league.pointsTotalWin || 2),
    pointsTotalTie: Number(league.pointsTotalTie ?? 1),
    tableSort: league.tableSort || "pointsThenPins",
    autoConfirmResults: league.autoConfirmResults !== false,
    provisionalResults: league.provisionalResults !== false,
  };
}

function normalizeUser(user, players = []) {
  const player = user.playerId ? players.find((item) => item.id === user.playerId) : null;
  const name = user.name || player?.name || "Benutzer";
  const role = user.role === "admin" ? "admin" : user.role === "cashier" ? "cashier" : "player";
  const username = user.username || slugify(name);
  return {
    ...user,
    name,
    username,
    email: user.email || `${username}@la-bowling.local`,
    passwordHash: user.passwordHash || null,
    tempPasswordHash: user.tempPasswordHash || null,
    bootstrapPassword: user.bootstrapPassword || user.password || null,
    firstLoginCompleted: user.firstLoginCompleted ?? role !== "player",
    role,
  };
}

function createPlayerUser(player) {
  const username = slugify(player.name);
  const startCode = `${username.replace(/\./g, "") || "spieler"}2026`;
  return {
    id: uid("user"),
    name: player.name,
    username,
    email: `${username}@la-bowling.local`,
    bootstrapPassword: startCode,
    firstLoginCompleted: false,
    role: "player",
    playerId: player.id,
  };
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function defaultFixtureDate(day) {
  const start = new Date("2026-09-01T12:00:00");
  start.setDate(start.getDate() + (Number(day) - 1) * 7);
  return start.toISOString().slice(0, 10);
}

function saveState(message = "Gespeichert") {
  window.HobbyligaState.persist();
  toast(message);
  render();
}

async function migrateCredentialStorage() {
  let changed = false;
  for (const user of state.users) {
    if (user.bootstrapPassword) {
      const target = user.firstLoginCompleted ? "passwordHash" : "tempPasswordHash";
      user[target] = await hashSecret(user.bootstrapPassword);
      delete user.bootstrapPassword;
      delete user.password;
      changed = true;
    } else if (user.password) {
      const target = user.firstLoginCompleted ? "passwordHash" : "tempPasswordHash";
      user[target] = await hashSecret(user.password);
      delete user.password;
      changed = true;
    }
  }
  if (changed) window.HobbyligaState.persist();
}

function createSeedState() {
  const teams = seasonTeams();
  const players = seasonPlayers();

  const users = [
    { id: "user-admin", name: "Liga Admin", username: "admin", email: "admin@la-bowling.local", bootstrapPassword: "admin123", firstLoginCompleted: true, role: "admin" },
    { id: "user-cashier", name: "Kasse", username: "kasse", email: "kasse@la-bowling.local", bootstrapPassword: "kasse123", firstLoginCompleted: true, role: "cashier" },
    ...players.map(createPlayerUser),
  ];

  return {
    activeUserId: "user-admin",
    league: {
      name: "LA Bowling Hobbyliga",
      season: "Saison 2025/26",
      venue: "LA Bowling",
      mode: "3 gegen 3",
      gamesPerMatch: 3,
      playersPerTeam: 3,
      handicapEnabled: true,
      handicapBase: 200,
      handicapFactor: 0.75,
      handicapMin: 0,
      handicapMax: 80,
      fineLimit: 150,
      fineAmount: 1,
      finePerPlayer: 1,
      pointsPerGameWin: 2,
      pointsPerGameTie: 1,
      pointsTotalWin: 2,
      pointsTotalTie: 1,
      tableSort: "pointsThenPins",
      autoConfirmResults: true,
      provisionalResults: true,
    },
    teams,
    players,
    users,
    fixtures: seasonFixtures(teams, 3),
    importedStandingsThroughDay: 16,
    importedStandings: seasonStandingsAfterWeek16(),
    news: [],
    fines: [],
  };
}

function seasonTeams() {
  return [
    { id: "team-splities", number: 1, name: "Splities", color: "#111111" },
    { id: "team-spare-bears", number: 2, name: "Spare-bears", color: "#ef4444" },
    { id: "team-la-bowling", number: 3, name: "LA Bowling", color: "#f59e0b" },
    { id: "team-crazy-balls", number: 4, name: "Crazy balls", color: "#3b82f6" },
    { id: "team-strike-hungry-wolves", number: 5, name: "Strike hungry wolves", color: "#10b981" },
    { id: "team-flying-pins", number: 6, name: "Flying Pins", color: "#8b5cf6" },
    { id: "team-zefix-foi-um", number: 7, name: "Zefix foi um", color: "#06b6d4" },
    { id: "team-pin-up-girls", number: 8, name: "Pin up girls", color: "#ec4899" },
    { id: "team-da-armando-pizza", number: 9, name: "Da Armando Pizza", color: "#f97316" },
    { id: "team-pin-breakers", number: 10, name: "Pin breakers", color: "#64748b" },
  ];
}

function seasonPlayers() {
  const rows = [
    ["christina-bachhuber", "Christina Bachhuber", "female", "team-splities", 0, 0, 0, 158],
    ["roland-seininger", "Roland Seininger", "male", "team-splities", 5165, 34, 179, 151],
    ["joerg-wunder", "Jörg Wunder", "male", "team-splities", 3691, 24, 216, 153],
    ["adin-kecic", "Adin Kecic", "male", "team-splities", 8182, 44, 256, 185],
    ["rene-stoeckl", "Rene Stöckl", "male", "team-splities", 6333, 42, 186, 150],
    ["verena-sollmann", "Verena Sollmann", "female", "team-spare-bears", 6122, 37, 198, 165],
    ["mario-sollmann", "Mario Sollmann", "male", "team-spare-bears", 5768, 34, 204, 169],
    ["dana-sollmann", "Dana Sollmann", "female", "team-spare-bears", 3621, 28, 177, 129],
    ["jule-heumos", "Jule Heumos", "female", "team-spare-bears", 2301, 15, 181, 153],
    ["roland-heumos", "Roland Heumos", "male", "team-spare-bears", 5402, 33, 213, 163],
    ["janina-ebenhardt", "Janina Ebenhardt", "female", "team-la-bowling", 0, 0, 0, 118],
    ["christian-poschenrieder", "Christian Poschenrieder", "male", "team-la-bowling", 1752, 12, 207, 146],
    ["dagmar-lehmann", "Dagmar Lehmann", "female", "team-la-bowling", 6002, 45, 178, 133],
    ["juergen-lehmann", "Jürgen Lehmann", "male", "team-la-bowling", 3359, 24, 196, 139],
    ["christian-reiss", "Christian Reiß", "male", "team-la-bowling", 5562, 36, 195, 154],
    ["kurt-ose", "Kurt Ose", "male", "team-la-bowling", 1578, 10, 222, 157],
    ["manuela-wunder", "Manuela Wunder", "female", "team-crazy-balls", 3406, 23, 188, 148],
    ["matthias-kuchling", "Matthias Kuchling", "male", "team-crazy-balls", 5684, 30, 252, 189],
    ["leoni-kuchling", "Leoni Kuchling", "female", "team-crazy-balls", 4964, 37, 188, 134],
    ["michael-schaefer", "Michael Schäfer", "male", "team-crazy-balls", 1793, 13, 160, 137],
    ["wolfgang-bauer", "Wolfgang Bauer", "male", "team-crazy-balls", 6268, 38, 212, 164],
    ["michael-ruppert", "Michael Ruppert", "male", "team-strike-hungry-wolves", 7438, 48, 198, 154],
    ["raja-ruppert", "Raja Ruppert", "female", "team-strike-hungry-wolves", 6494, 48, 191, 135],
    ["horst-werner-ruppert", "Horst-Werner Ruppert", "male", "team-strike-hungry-wolves", 6481, 48, 176, 135],
    ["irene-ruppert", "Irene Ruppert", "female", "team-strike-hungry-wolves", 0, 0, 0, 0],
    ["tamine-ruppert", "Tamine Ruppert", "female", "team-strike-hungry-wolves", 0, 0, 0, 0],
    ["maja-breuer", "Maja Breuer", "female", "team-flying-pins", 4059, 34, 148, 119],
    ["alex-dalli", "Alex Dalli", "male", "team-flying-pins", 2036, 12, 201, 169],
    ["florian-maulberger", "Florian Maulberger", "male", "team-flying-pins", 7099, 39, 227, 182],
    ["sebastian-oulton", "Sebastian Oulton", "male", "team-flying-pins", 2114, 14, 187, 151],
    ["marc-zettler", "Marc Zettler", "male", "team-flying-pins", 3598, 24, 176, 149],
    ["toni-d", "Toni D.", "male", "team-zefix-foi-um", 6126, 42, 188, 145],
    ["helmut-w", "Helmut W.", "male", "team-zefix-foi-um", 4920, 35, 181, 140],
    ["bastian-w", "Bastian W.", "male", "team-zefix-foi-um", 5421, 36, 205, 150],
    ["sibel-w-f", "Sibel W.-F.", "female", "team-zefix-foi-um", 758, 8, 133, 94],
    ["jens-j", "Jens J.", "male", "team-zefix-foi-um", 1556, 12, 156, 129],
    ["christoph-h", "Christoph H", "male", "team-zefix-foi-um", 288, 3, 118, 96],
    ["marc-w", "Marc W.", "male", "team-zefix-foi-um", 1046, 8, 151, 130],
    ["michaela-ose", "Michaela Ose", "female", "team-pin-up-girls", 2513, 23, 140, 109],
    ["beate-kaestner", "Beate Kästner", "female", "team-pin-up-girls", 3630, 25, 203, 145],
    ["bettina-theilmann", "Bettina Theilmann", "female", "team-pin-up-girls", 4029, 24, 202, 167],
    ["gerlinde-theilmann", "Gerlinde Theilmann", "female", "team-pin-up-girls", 622, 6, 121, 103],
    ["edda-zettler", "Edda Zettler", "female", "team-pin-up-girls", 3554, 27, 181, 131],
    ["regina-gahr", "Regina Gahr", "female", "team-pin-up-girls", 5646, 39, 178, 144],
    ["marc-saumer", "Marc Saumer", "male", "team-pin-breakers", 7987, 46, 235, 173],
    ["thomas-sager", "Thomas Sager", "male", "team-pin-breakers", 4351, 29, 205, 150],
    ["christian-saumer", "Christian Saumer", "male", "team-pin-breakers", 1169, 9, 155, 129],
    ["jan-heissenhuber", "Jan Heissenhuber", "male", "team-pin-breakers", 1747, 14, 166, 124],
    ["gina-einhellig", "Gina Einhellig", "female", "team-pin-breakers", 1499, 14, 122, 107],
    ["daniel-rogner", "Daniel Rogner", "male", "team-pin-breakers", 421, 3, 158, 140],
    ["florian-stauner", "Florian Stauner", "male", "team-pin-breakers", 4510, 29, 211, 155],
  ];
  return rows.map(([id, name, gender, teamId, pins, games, high, bookAverage]) => ({
    id: `pl-${id}`,
    name,
    gender,
    teamId,
    active: true,
    initialStats: { games, pins, high },
    importedAverage: games ? pins / games : bookAverage || null,
  }));
}

function seasonFixtures(teams, gamesPerMatch = 3) {
  const teamByNumber = new Map(teams.map((team) => [team.number, team.id]));
  const schedule = [
    ["2025-09-29", [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]],
    ["2025-10-15", [[7, 3], [1, 6], [2, 9], [5, 10], [8, 4]]],
    ["2025-10-27", [[4, 5], [9, 8], [10, 1], [3, 2], [6, 7]]],
    ["2025-11-10", [[9, 1], [5, 3], [4, 7], [8, 6], [10, 2]]],
    ["2025-11-24", [[10, 7], [6, 2], [8, 3], [4, 1], [5, 9]]],
    ["2025-12-08", [[5, 8], [4, 10], [7, 2], [6, 9], [1, 3]]],
    ["2026-01-19", [[6, 4], [7, 9], [1, 5], [10, 3], [2, 8]]],
    ["2026-02-02", [[3, 9], [8, 1], [6, 10], [2, 4], [7, 5]]],
    ["2026-03-02", [[8, 10], [2, 5], [9, 4], [1, 7], [3, 6]]],
    ["2026-03-16", [[4, 3], [10, 9], [2, 1], [6, 5], [8, 7]]],
    ["2026-04-13", [[6, 1], [4, 8], [3, 7], [9, 2], [10, 5]]],
    ["2026-04-27", [[8, 9], [7, 6], [5, 4], [1, 10], [2, 3]]],
    ["2026-05-11", [[3, 5], [2, 10], [1, 9], [7, 4], [6, 8]]],
    ["2026-05-25", [[2, 6], [9, 5], [7, 10], [3, 8], [1, 4]]],
    ["2026-06-08", [[10, 4], [3, 1], [8, 5], [2, 7], [9, 6]]],
    ["2026-06-22", [[9, 7], [8, 2], [4, 6], [5, 1], [3, 10]]],
    ["2026-07-06", [[1, 8], [5, 7], [9, 3], [10, 6], [4, 2]]],
    ["2026-07-20", [[5, 2], [6, 3], [10, 8], [4, 9], [7, 1]]],
  ];
  return schedule.flatMap(([date, pairings], dayIndex) =>
    pairings.map(([homeNumber, awayNumber], index) => ({
      id: `fix-${dayIndex + 1}-${index + 1}`,
      day: dayIndex + 1,
      round: dayIndex < 9 ? "Hinrunde" : "Rückrunde",
      lane: index * 2 + 1,
      date,
      time: "19:30",
      venue: "LA Bowling",
      status: dayIndex + 1 <= 16 ? "played" : "planned",
      homeTeamId: teamByNumber.get(homeNumber),
      awayTeamId: teamByNumber.get(awayNumber),
      saved: false,
      games: Array.from({ length: Math.max(1, Number(gamesPerMatch) || 3) }, (_, gameIndex) => ({ number: gameIndex + 1, scores: {} })),
      points: { home: 0, away: 0 },
      totals: { homeGross: 0, awayGross: 0, homeHandicap: 0, awayHandicap: 0, homeNet: 0, awayNet: 0 },
      confirmed: false,
      rulesSnapshot: null,
      teamSubmissions: {},
      blindPlayers: {},
      activationRequests: [],
      activation: null,
    }))
  );
}

function seasonStandingsAfterWeek16() {
  return [
    ["team-pin-breakers", 85, 43, 27355, 21684],
    ["team-spare-bears", 84, 44, 27488, 22719],
    ["team-crazy-balls", 79, 49, 27587, 22547],
    ["team-strike-hungry-wolves", 76, 52, 26896, 20413],
    ["team-splities", 67, 61, 27461, 23371],
    ["team-la-bowling", 67, 61, 26877, 20803],
    ["team-flying-pins", 65, 63, 26849, 22146],
    ["team-zefix-foi-um", 63, 65, 26603, 20115],
    ["team-pin-up-girls", 54, 74, 26487, 19994],
    ["team-da-armando-pizza", 0, 0, 0, 0],
  ].map(([teamId, points, pointsLost, pins, grossPins]) => ({
    teamId,
    played: teamId === "team-da-armando-pizza" ? 0 : 16,
    points,
    pointsLost,
    pins,
    grossPins,
    against: 0,
    gamesWon: 0,
    gamesLost: 0,
  }));
}

function generateSchedule(teams, gamesPerMatch = state?.league?.gamesPerMatch || 3) {
  const list = teams.map((team) => team.id);
  if (list.length % 2) list.push("bye");
  const rounds = list.length - 1;
  const half = list.length / 2;
  const firstLeg = [];
  let rotation = [...list];

  for (let round = 0; round < rounds; round += 1) {
    const pairings = [];
    for (let i = 0; i < half; i += 1) {
      const home = rotation[i];
      const away = rotation[rotation.length - 1 - i];
      if (home !== "bye" && away !== "bye") {
        pairings.push({ homeTeamId: round % 2 ? away : home, awayTeamId: round % 2 ? home : away });
      }
    }
    firstLeg.push(pairings);
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }

  const allRounds = [
    ...firstLeg.map((matches, idx) => ({ round: "Hinrunde", day: idx + 1, matches })),
    ...firstLeg.map((matches, idx) => ({
      round: "Rückrunde",
      day: firstLeg.length + idx + 1,
      matches: matches.map((match) => ({ homeTeamId: match.awayTeamId, awayTeamId: match.homeTeamId })),
    })),
  ];

  return allRounds.flatMap((round) =>
    round.matches.map((match, index) => ({
      id: uid("fix"),
      day: round.day,
      round: round.round,
      lane: index + 1,
      date: defaultFixtureDate(round.day),
      time: "19:00",
      venue: state?.league?.venue || "LA Bowlingcenter",
      status: "planned",
      homeTeamId: match.homeTeamId,
      awayTeamId: match.awayTeamId,
      saved: false,
      games: Array.from({ length: Math.max(1, Number(gamesPerMatch) || 3) }, (_, index) => ({ number: index + 1, scores: {} })),
      points: { home: 0, away: 0 },
      totals: { homeGross: 0, awayGross: 0, homeHandicap: 0, awayHandicap: 0, homeNet: 0, awayNet: 0 },
      confirmed: false,
      rulesSnapshot: null,
      teamSubmissions: {},
      blindPlayers: {},
      activationRequests: [],
      activation: null,
    }))
  );
}

function teamById(id) {
  return window.HobbyligaTeams.findById(state, id);
}

function playerById(id) {
  return window.HobbyligaPlayers.findById(state, id);
}

function sessionUserId() {
  return sessionStorage.getItem(AUTH_SESSION_KEY);
}

function isAuthenticated() {
  return !!state.users.find((user) => user.id === sessionUserId());
}

function activeUser() {
  return state.users.find((user) => user.id === sessionUserId()) || null;
}

function canAdmin() {
  return activeUser()?.role === "admin";
}

function canManageFines() {
  return ["admin", "cashier"].includes(activeUser()?.role);
}

function currentPlayer() {
  const user = activeUser();
  return user?.playerId ? playerById(user.playerId) : null;
}

function allowedNavItems() {
  const role = activeUser()?.role;
  return navItems.filter(([, , , roles]) => roles.includes(role));
}

function defaultViewForRole(role) {
  if (role === "admin") return "adminDashboard";
  if (role === "cashier") return "cashierDashboard";
  return "playerDashboard";
}

function guardView() {
  const allowed = allowedNavItems();
  const internalViews = {
    playerFixtureDay: ["player"],
  };
  const role = activeUser()?.role;
  if (internalViews[currentView]?.includes(role)) return;
  if (!allowed.some(([id]) => id === currentView)) {
    currentView = defaultViewForRole(activeUser()?.role);
  }
}

function playersForTeam(teamId) {
  return state.players.filter((player) => player.teamId === teamId && player.active);
}

function lineupForTeam(teamId, playersPerTeam = state.league.playersPerTeam || 3) {
  return playersForTeam(teamId).slice(0, playersPerTeam);
}

function allPlayerGameScores(untilFixtureId = null) {
  return window.HobbyligaStatistics.getPlayerScores(state, null, untilFixtureId);
}

function playerStats(playerId, untilFixtureId = null) {
  return window.HobbyligaStatistics.getPlayerStats(state, playerId, untilFixtureId);
}

function playerHandicapForRules(playerId, untilFixtureId, rules) {
  const player = playerById(playerId);
  const baseline = player?.initialStats || { games: 0, pins: 0 };
  const scores = allPlayerGameScores(untilFixtureId).filter((row) => row.playerId === playerId);
  const games = baseline.games + scores.length;
  if (games < 3) return null;
  const average = (baseline.pins + scores.reduce((sum, row) => sum + row.gross, 0)) / games;
  return clamp(Math.round((rules.handicapBase - average) * rules.handicapFactor), rules.handicapMin, rules.handicapMax);
}

function clamp(value, min, max) {
  return Math.min(Number(max), Math.max(Number(min), value));
}

function currentRulesSnapshot() {
  return window.HobbyligaRules.createSnapshot(state);
}

function rulesForFixture(fixture) {
  return window.HobbyligaResults.isConfirmed(fixture) && window.HobbyligaRules.getRulesSnapshot(fixture) ? window.HobbyligaRules.getRulesSnapshot(fixture) : window.HobbyligaRules.createSnapshot(state);
}

function scoreValue(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 300) return null;
  return number;
}

function calculateFixture(fixture, rules = rulesForFixture(fixture)) {
  const useHandicap = rules.handicapEnabled;
  const totals = { homeGross: 0, awayGross: 0, homeHandicap: 0, awayHandicap: 0, homeNet: 0, awayNet: 0 };
  const points = { home: 0, away: 0 };

  fixture.games.forEach((game) => {
    let homeNet = 0;
    let awayNet = 0;
    let homeGross = 0;
    let awayGross = 0;
    let homeHandicap = 0;
    let awayHandicap = 0;

    const homePlayers = playersForScoredGame(fixture, game, fixture.homeTeamId, rules.playersPerTeam);
    const awayPlayers = playersForScoredGame(fixture, game, fixture.awayTeamId, rules.playersPerTeam);

    homePlayers.forEach((player) => {
      const gross = game.scores[player.id]?.gross ?? 0;
      const hc = useHandicap ? playerHandicapForRules(player.id, fixture.id, rules) ?? 0 : 0;
      game.scores[player.id] = { gross, handicap: hc, net: gross + hc };
      homeGross += gross;
      homeHandicap += hc;
      homeNet += gross + hc;
    });

    awayPlayers.forEach((player) => {
      const gross = game.scores[player.id]?.gross ?? 0;
      const hc = useHandicap ? playerHandicapForRules(player.id, fixture.id, rules) ?? 0 : 0;
      game.scores[player.id] = { gross, handicap: hc, net: gross + hc };
      awayGross += gross;
      awayHandicap += hc;
      awayNet += gross + hc;
    });

    const homeBlind = fixture.blindPlayers?.[fixture.homeTeamId];
    if (homeBlind) {
      homeGross += homeBlind.gross;
      homeHandicap += homeBlind.handicap;
      homeNet += homeBlind.gross + homeBlind.handicap;
    }

    const awayBlind = fixture.blindPlayers?.[fixture.awayTeamId];
    if (awayBlind) {
      awayGross += awayBlind.gross;
      awayHandicap += awayBlind.handicap;
      awayNet += awayBlind.gross + awayBlind.handicap;
    }

    totals.homeGross += homeGross;
    totals.awayGross += awayGross;
    totals.homeHandicap += homeHandicap;
    totals.awayHandicap += awayHandicap;
    totals.homeNet += homeNet;
    totals.awayNet += awayNet;

    if (homeNet > awayNet) points.home += rules.pointsPerGameWin;
    else if (awayNet > homeNet) points.away += rules.pointsPerGameWin;
    else {
      points.home += rules.pointsPerGameTie;
      points.away += rules.pointsPerGameTie;
    }
  });

  if (totals.homeNet > totals.awayNet) points.home += rules.pointsTotalWin;
  else if (totals.awayNet > totals.homeNet) points.away += rules.pointsTotalWin;
  else {
    points.home += rules.pointsTotalTie;
    points.away += rules.pointsTotalTie;
  }

  fixture.totals = totals;
  fixture.points = points;
  return fixture;
}

function playersForScoredGame(fixture, game, teamId, playersPerTeam) {
  const teamPlayers = playersForTeam(teamId);
  const scored = teamPlayers.filter((player) => Number.isFinite(game.scores[player.id]?.gross));
  return scored.length ? scored : lineupForTeam(teamId, playersPerTeam);
}

function calculateBlindPlayer(fixture, teamId) {
  const candidates = playersForTeam(teamId)
    .map((player) => ({ player, stats: playerStats(player.id, fixture.id) }))
    .filter((row) => row.stats.games > 0)
    .sort((a, b) => b.stats.average - a.stats.average);
  const strongest = candidates[0] || playersForTeam(teamId).map((player) => ({ player, stats: playerStats(player.id, fixture.id) }))[0];
  if (!strongest) return null;
  const average = strongest.stats.average || 0;
  const gross = Math.max(0, Math.round(average * 0.9));
  const handicap = strongest.stats.valid ? strongest.stats.handicap : 0;
  return {
    sourcePlayerId: strongest.player.id,
    sourcePlayerName: strongest.player.name,
    gross,
    handicap,
    net: gross + handicap,
  };
}

function rebuildFines() {
  const paidMap = new Map(state.fines.map((fine) => [fine.key || `${fine.fixtureId}-${fine.playerId || fine.teamId}-${fine.gameNumber || "team"}`, fine]));
  state.fines = [];
  state.fixtures.filter((fixture) => fixture.saved && fixture.confirmed).forEach((fixture) => {
    const rules = rulesForFixture(fixture);
    [fixture.homeTeamId, fixture.awayTeamId].forEach((teamId) => {
      fixture.games.forEach((game) => {
        playersForScoredGame(fixture, game, teamId, rules.playersPerTeam).forEach((player) => {
          const score = game.scores[player.id];
          if (!score || !Number.isFinite(score.gross) || score.gross >= rules.fineLimit) return;
          const key = `${fixture.id}-${player.id}-${game.number}`;
          const previous = paidMap.get(key);
          state.fines.push({
            id: previous?.id || uid("fine"),
            key,
            fixtureId: fixture.id,
            day: fixture.day,
            gameNumber: game.number,
            playerId: player.id,
            teamId,
            gross: score.gross,
            limit: rules.fineLimit,
            amount: rules.fineAmount,
            total: rules.fineAmount,
            paid: previous?.paid || false,
            paidAt: previous?.paidAt || null,
            createdAt: previous?.createdAt || new Date().toISOString(),
          });
        });
      });
    });
  });
}

function finesForPlayer(playerId, onlyOpen = false) {
  rebuildFines();
  return state.fines.filter((fine) => fine.playerId === playerId && (!onlyOpen || !fine.paid));
}

function standings(includeSubmitted = false) {
  return window.HobbyligaStandings.calculate(state, includeSubmitted);
}

function leadersByGender(gender) {
  return window.HobbyligaStatistics.getLeadersByGender(state, gender);
}

function render() {
  if (!isAuthenticated()) {
    renderLogin();
    return;
  }
  const league = window.HobbyligaLeague.get(state);
  const isPlayerApp = activeUser()?.role === "player";
  document.body.classList.add("is-authenticated");
  document.body.classList.toggle("is-player-app", isPlayerApp);
  $(".app-shell").classList.remove("hidden");
  $("#loginScreen")?.classList.add("hidden");
  guardView();
  renderNav();
  renderPlayerBottomNav();
  renderUserPanel();
  const pageTitles = {
    playerFixtureDay: "Spieltag",
  };
  const title = pageTitles[currentView] || navItems.find(([id]) => id === currentView)?.[2] || "Dashboard";
  $("#pageTitle").textContent = title;
  $("#eyebrow").textContent = `${league.name} · ${window.HobbyligaLeague.getSeasonName(state)}`;
  const view = $("#view");
  view.innerHTML = "";
  const routes = {
    playerDashboard: renderPlayerDashboard,
    playerFixtureDay: renderPlayerFixtureDay,
    upcomingGames: renderUpcomingGames,
    playerStats: renderPlayerStats,
    playerSubmitResults: renderPlayerSubmitResults,
    adminDashboard: renderAdminDashboard,
    cashierDashboard: renderCashierDashboard,
    dashboard: renderAdminDashboard,
    league: renderLeague,
    schedule: renderSchedule,
    results: renderResults,
    table: renderTable,
    leaders: renderLeaders,
    fines: renderFines,
    news: renderNews,
    admin: renderAdmin,
  };
  view.append(routes[currentView]());
}

function renderLogin() {
  document.body.classList.remove("is-authenticated", "is-player-app", "nav-open");
  $(".app-shell").classList.add("hidden");
  let screen = $("#loginScreen");
  if (!screen) {
    screen = el("main", "login-screen");
    screen.id = "loginScreen";
    document.body.prepend(screen);
  }
  screen.classList.remove("hidden");
  const biometric = window.HobbyligaStorage.getJson(BIOMETRIC_KEY, null);
  screen.innerHTML = `
    <section class="login-panel">
      <div class="login-logo-frame"><img src="assets/la-bowling-hobbyliga-logo.png?v=19" alt="LA-Bowling Hobbyliga" /></div>
      <form id="loginForm" class="login-form">
        <div>
          <input id="loginPassword" type="password" autocomplete="current-password" placeholder="Passwort / Startcode" aria-label="Passwort oder Startcode" required />
        </div>
        <button class="primary-button" type="submit">Einloggen</button>
      </form>
      ${biometric && biometricAvailable() ? `<button class="ghost-button" type="button" data-action="biometric-login">Face-ID Login</button>` : ""}
    </section>
  `;
}

function renderFirstLogin(user) {
  document.body.classList.remove("is-authenticated", "is-player-app", "nav-open");
  $(".app-shell").classList.add("hidden");
  let screen = $("#loginScreen");
  if (!screen) {
    screen = el("main", "login-screen");
    screen.id = "loginScreen";
    document.body.prepend(screen);
  }
  screen.classList.remove("hidden");
  screen.innerHTML = `
    <section class="login-panel">
      <div class="login-logo-frame"><img src="assets/la-bowling-hobbyliga-logo.png?v=19" alt="LA-Bowling Hobbyliga" /></div>
      <form id="firstLoginForm" class="login-form">
        <div>
          <label for="newPassword">Neues Passwort</label>
          <input id="newPassword" type="password" autocomplete="new-password" minlength="6" placeholder="Neues Passwort" required />
        </div>
        <div>
          <label for="newPasswordRepeat">Wiederholen</label>
          <input id="newPasswordRepeat" type="password" autocomplete="new-password" minlength="6" placeholder="Wiederholen" required />
        </div>
        <button class="primary-button" type="submit">Passwort speichern</button>
      </form>
    </section>
  `;
}

function renderNav() {
  const nav = $("#mainNav");
  nav.innerHTML = allowedNavItems()
    .map(([id, icon, label]) => `<button class="${id === currentView ? "active" : ""}" data-view="${id}"><span class="nav-icon">${icon}</span>${label}</button>`)
    .join("");
}

function renderUserPanel() {
  const user = activeUser();
  const player = currentPlayer();
  $("#userPanel").innerHTML = `
    <span class="field-label">Angemeldet</span>
    <strong>${user.name}</strong>
    <small>${roleLabels[user.role]}${player ? ` · ${teamById(player.teamId)?.name || ""}` : ""}</small>
    ${biometricAvailable() ? `<button class="button" type="button" data-action="enable-biometric">Face-ID aktivieren</button>` : ""}
    <button class="ghost-button" type="button" data-action="logout">Abmelden</button>
  `;
}

function renderDashboard() {
  return renderAdminDashboard();
}

function renderAdminDashboard() {
  rebuildFines();
  const user = activeUser();
  const league = window.HobbyligaLeague.get(state);
  const todayFixtures = dashboardGameDayFixtures();
  const nextFixture = nextOpenFixture();
  const openFines = state.fines.filter((fine) => !fine.paid);
  const wrap = el("div");
  wrap.innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <p class="eyebrow">${window.HobbyligaLeague.getSeasonName(state)}</p>
        <h2>Hallo ${user.name}</h2>
        <p>${league.name} · ${league.venue}</p>
      </div>
    </div>
    <div class="section grid cols-2">
      <div class="panel">
        <h2>Heutiger Spieltag</h2>
        ${todayFixtures.length ? todayFixtures.map(matchSummaryHtml).join("") : emptyHtml("Kein Spieltag offen", "Der nächste offene Spieltag erscheint hier.")}
      </div>
      <div class="panel">
        <h2>Nächstes Spiel</h2>
        ${nextFixture ? matchSummaryHtml(nextFixture) : emptyHtml("Kein nächstes Spiel", "Der Spielplan ist aktuell vollständig gespielt.")}
      </div>
      <div class="panel">
        <h2>Newsfeed</h2>
        <div class="news-list">${visibleNews().slice(0, 4).map(newsHtml).join("")}</div>
      </div>
      <div class="panel">
        <h2>Offene Strafgelder</h2>
        ${openFines.length ? `<p class="scoreline"><strong>${openFines.length} offene Strafen</strong><span class="scorebox">${openFines.reduce((sum, fine) => sum + fine.total, 0).toFixed(2)} €</span><span class="mini">Details in Strafen/Kasse</span></p>` : emptyHtml("Keine offenen Strafgelder", "Aktuell ist nichts offen.")}
      </div>
    </div>
  `;
  return wrap;
}

function teamLogoFor(team) {
  if (!team) return "";
  if (typeof team.logo === "string" && team.logo.trim()) return team.logo;

  const logoPaths = {
    splities: "assets/team-logos/splittys.png?v=2",
    splittys: "assets/team-logos/splittys.png?v=2",
    sparebears: "assets/team-logos/spare-bears.png?v=2",
    labowling: "assets/team-logos/la-bowling.png?v=2",
    crazyballs: "assets/team-logos/crazy-balls.png?v=2",
    strikehungrywolves: "assets/team-logos/strike-hungry-wolves.png?v=2",
    flyingpins: "assets/team-logos/flying-pins.png?v=2",
    zefixfoium: "assets/team-logos/zefix-foi-um.png?v=2",
    pinupgirls: "assets/team-logos/pinup-girls.png?v=2",
    daarmandopizza: "assets/team-logos/da-armando-pizza.png?v=2",
    pinbreakers: "assets/team-logos/pinbreakers.png?v=2",
  };
  const normalizeLogoName = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  return [team.name, team.shortName, team.id]
    .map(normalizeLogoName)
    .map((key) => logoPaths[key])
    .find(Boolean) || "";
}

function playerBottomNavIcon(name) {
  const icons = {
    dashboard: `<path d="M4 11.5 12 5l8 6.5V20H4v-8.5Z"/><path d="M9 20v-5h6v5"/>`,
    matchday: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5"/>`,
    ranking: `<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6"/>`,
    team: `<circle cx="8.5" cy="8" r="3"/><circle cx="16.8" cy="9.2" r="2.4"/><path d="M3.6 19c.6-3.1 2.6-5 4.9-5s4.4 1.9 5 5M14.2 18.7c.4-2.3 1.8-3.9 3.9-3.9 1.1 0 2.1.4 2.8 1.1"/>`,
    profile: `<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-4 3.2-6 7-6s6.2 2 7 6"/>`,
  };
  const icon = icons[name];
  if (!icon) return "";
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icon}</svg>`;
}

function renderPlayerBottomNav() {
  const nav = $("#playerBottomNav");
  if (!nav) return;
  if (activeUser()?.role !== "player") {
    nav.hidden = true;
    nav.innerHTML = "";
    return;
  }

  const dashboardPanel = sessionStorage.getItem("playerDashboardPanel") || "";
  const activeId = currentView === "playerDashboard" && dashboardPanel === "ranking"
    ? "ranking"
    : ({ playerDashboard: "dashboard", playerFixtureDay: "matchday", upcomingGames: "team", playerStats: "profile" }[currentView] || "dashboard");
  const items = [
    { id: "dashboard", icon: "dashboard", label: "Dashboard", view: "playerDashboard" },
    { id: "matchday", icon: "matchday", label: "Spieltag", view: "playerFixtureDay" },
    { id: "ranking", icon: "ranking", label: "Rangliste", action: "dashboard-panel", panel: "ranking" },
    { id: "team", icon: "team", label: "Team", view: "upcomingGames" },
    { id: "profile", icon: "profile", label: "Profil", view: "playerStats" },
  ];
  nav.hidden = false;
  nav.innerHTML = items.map((item) => {
    const active = item.id === activeId ? " is-active" : "";
    const target = item.view
      ? `data-view="${item.view}"`
      : `data-action="${item.action}" data-panel="${item.panel}"`;
    return `<button class="player-bottom-nav-item${active}" type="button" ${target} aria-label="${item.label}"><span class="player-bottom-nav-icon">${playerBottomNavIcon(item.icon)}</span><span>${item.label}</span></button>`;
  }).join("");
}

function renderPlayerDashboard() {
  const player = currentPlayer();
  const wrap = el("div");
  if (!player) {
    wrap.innerHTML = emptyHtml("Kein Spielerprofil verknüpft", "Bitte den Admin, deinen Zugang einem Spieler zuzuweisen.");
    return wrap;
  }

  const team = teamById(player.teamId);
  const openFines = finesForPlayer(player.id, true);
  const openFineTotal = openFines.reduce((sum, fine) => sum + fine.total, 0);
  const nextFixture = nextOpenFixture(player.teamId);
  const table = standings();
  const teamRow = table.find((row) => row.team.id === player.teamId);
  const tablePlace = table.findIndex((row) => row.team.id === player.teamId) + 1;
  const stats = playerStats(player.id);
  const rank = playerRank(player.id);
  const rankingValue = rank ? String(rank) : "-";
  const teamPlaceValue = tablePlace ? String(tablePlace) : "-";
  const handicapValue = stats.valid ? String(stats.handicap) : "-";
  const averageValue = stats.valid ? stats.average.toFixed(1).replace(".", ",") : "n. v.";
  const fineValue = openFines.length ? `${openFineTotal.toFixed(2).replace(".", ",")} € offen` : "Keine offen";
  const dashboardPanel = sessionStorage.getItem("playerDashboardPanel") || "";
  const news = visibleNews().filter((item) => !["Handicap-Regel aktiv", "Saison 2025/26 importiert"].includes(item.title)).slice(0, 4);

  const profileInitials = player.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const playerNameParts = String(player.name || "").trim().split(/\s+/).filter(Boolean);
  const playerFirstName = playerNameParts[0] || "Spieler";
  const playerLastName = playerNameParts.slice(1).join(" ");
  const teamLabel = team?.name || "Ohne Team";
  const currentUserId = activeUser()?.id;
  const teamMembers = player.teamId
    ? playersForTeam(player.teamId)
      .slice()
      .filter((member) => state.users.find((user) => user.playerId === member.id)?.id !== currentUserId)
      .sort((first, second) => first.name.localeCompare(second.name, "de"))
    : [];
  const teamMembersHtml = player.teamId && teamMembers.length
    ? `<section class="team-members" aria-label="Team">
        <div class="team-members-row">
          ${teamMembers.map((member) => {
            const fullName = member.name || "Unbekannter Spieler";
            const shortName = fullName.trim().split(/\s+/)[0] || fullName;
            const initials = fullName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
            const imageUrl = member.avatar || member.profileImage || member.photo;
            const avatar = imageUrl
              ? `<img src="${escapeHtml(String(imageUrl))}" alt="Profil von ${escapeHtml(fullName)}" />`
              : `<span aria-hidden="true">${escapeHtml(initials || "?")}</span>`;
            return `<button class="team-member" type="button" data-action="open-player-profile" data-player-id="${escapeHtml(member.id)}" aria-label="Profil von ${escapeHtml(fullName)} öffnen" title="${escapeHtml(fullName)}">
              <span class="team-member-avatar ${imageUrl ? "has-image" : ""}">${avatar}</span>
              <span class="team-member-name">${escapeHtml(shortName)}</span>
            </button>`;
          }).join("")}
        </div>
      </section>`
    : `<section class="team-members team-members-empty" aria-labelledby="teamMembersTitle"><h2 id="teamMembersTitle">Team</h2><p>${player.teamId ? "Noch keine weiteren Teammitglieder." : "Noch keinem Team zugeordnet."}</p></section>`;
  const teamLogoUrl = teamLogoFor(team);
  const teamLogo = teamLogoUrl
    ? `<img class="player-team-logo" src="${escapeHtml(teamLogoUrl)}" alt="Teamlogo ${escapeHtml(teamLabel)}" />`
    : `<svg class="player-team-logo player-team-logo-placeholder" viewBox="0 0 240 240" aria-label="Bowling-Silhouette" role="img" focusable="false"><circle cx="74" cy="145" r="50" fill="currentColor" opacity=".72"/><circle cx="58" cy="128" r="6" fill="#050b15"/><circle cx="80" cy="117" r="6" fill="#050b15"/><circle cx="94" cy="139" r="6" fill="#050b15"/><path d="M145 45c15 0 24 12 24 29v48c0 18-9 30-24 30s-24-12-24-30V74c0-17 9-29 24-29Zm38 14c13 0 21 11 21 26v37c0 16-8 26-21 26s-21-10-21-26V85c0-15 8-26 21-26Zm-28 101h43l14 41h-71l14-41Z" fill="currentColor" opacity=".9"/></svg>`;

  wrap.innerHTML = `
    <div class="player-dashboard-screen">
      <section class="player-dashboard-head" aria-label="Spielerprofil von ${escapeHtml(player.name)}, Team ${escapeHtml(teamLabel)}">
        <img class="player-header-league-logo" src="assets/branding/la-bowling-hobbyliga-2026-27.png" alt="LA-Bowling Hobbyliga &ndash; Saison 2026/27" onerror="this.hidden=true" />
        <div class="player-profile-placeholder" aria-label="Profilbild-Platzhalter">${profileInitials || "?"}</div>
        <p class="player-profile-name" title="${escapeHtml(player.name)}">${escapeHtml(player.name)}</p>
        <div class="player-team-logo-wrap">${teamLogo}</div>
      </section>
      ${teamMembersHtml}
      <section class="player-stat-grid" aria-label="Persönliche Statistik">
        <button class="player-stat-tile player-stat-tile--orange" type="button" data-action="dashboard-panel" data-panel="ranking" aria-label="Ranglistenplatz: ${rankingValue}. Rangliste öffnen.">
          <span class="player-stat-label">Ranglistenplatz</span>
          ${dashboardStatIcon("trophy", "orange")}
          <strong class="player-stat-value player-stat-value--placement">${rankingValue}</strong>
        </button>
        <button class="player-stat-tile player-stat-tile--blue" type="button" data-action="dashboard-panel" data-panel="table" aria-label="Teamplatz: ${teamPlaceValue}. Tabelle öffnen.">
          <span class="player-stat-label">Teamplatz</span>
          ${dashboardStatIcon("team", "blue")}
          <strong class="player-stat-value player-stat-value--placement">${teamPlaceValue}</strong>
        </button>
        <div class="player-stat-tile player-stat-tile--orange" aria-label="Handicap: ${handicapValue}">
          <span class="player-stat-label">Handicap</span>
          ${dashboardStatIcon("bowling-pin", "orange")}
          <strong class="player-stat-value">${handicapValue}</strong>
        </div>
        <button class="player-stat-tile player-stat-tile--blue player-stat-tile--wide" type="button" data-action="dashboard-panel" data-panel="bestAverage" aria-label="Schnitt: ${averageValue}. Schnittwertung öffnen.">
          <span class="player-stat-label">Schnitt</span>
          ${dashboardStatIcon("trend-up", "blue")}
          <strong class="player-stat-value">${averageValue}</strong>
        </button>
        <button class="player-stat-tile player-stat-tile--orange player-stat-tile--fine player-stat-tile--wide ${openFines.length ? "has-open-fines" : ""}" type="button" data-action="dashboard-panel" data-panel="fines" aria-label="Offene Strafen: ${fineValue}. Strafgeld-Details öffnen.">
          <span class="player-stat-label">Strafe</span>
          ${dashboardStatIcon("alert-circle", "orange")}
          <strong class="player-stat-value ${openFines.length ? "" : "is-text"}">${fineValue}</strong>
        </button>
      </section>
    <div class="section dashboard-grid player-dashboard-lower-grid">
      ${playerDashboardNextFixtureHtml(nextFixture, player.teamId)}
      <div class="panel dashboard-card player-newsfeed">
        <h2>Newsfeed</h2>
        <div class="news-list">${news.length ? news.map(newsHtml).join("") : `<p class="player-newsfeed-empty">Aktuell gibt es keine neuen Meldungen.</p>`}</div>
      </div>
    </div>
    ${dashboardPanel ? playerDashboardPanelHtml(dashboardPanel, player, nextFixture, openFines, table) : ""}
    </div>
  `;
  return wrap;
}

function teamVisualHtml(team, variant = "") {
  if (!team) return `<span class="team-visual ${variant}">?</span>`;
  const label = team.shortName || team.name || "?";
  const initials = label.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const style = team.logo ? ` style="background-image:url('${team.logo}')"` : "";
  return `<span class="team-visual ${variant} ${team.logo ? "has-logo" : ""}"${style}><span>${team.logo ? "" : initials}</span></span>`;
}

function renderPlayerFixtureDay() {
  const player = currentPlayer();
  const wrap = el("div");
  if (!player) {
    wrap.innerHTML = emptyHtml("Kein Spielerprofil verknüpft", "Bitte den Admin, deinen Zugang einem Spieler zuzuweisen.");
    return wrap;
  }

  const selectedId = sessionStorage.getItem("playerFixtureDayId");
  const fixture = window.HobbyligaSchedule.findById(state, selectedId) || nextOpenFixture(player.teamId);
  if (!fixture) {
    wrap.innerHTML = `
      <section class="fixture-page-hero">
        <div class="fixture-page-top"><button class="ghost-button" type="button" data-action="back-player-dashboard">Zurück</button></div>
        ${emptyHtml("Kein Spieltag offen", "")}
      </section>
    `;
    return wrap;
  }

  sessionStorage.setItem("playerFixtureDayId", fixture.id);
  const ownTeam = teamById(player.teamId);
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  const opponent = fixture.homeTeamId === player.teamId ? away : home;
  const ownLane = fixtureTeamLane(fixture, player.teamId);
  const opponentLane = fixtureTeamLane(fixture, opponent?.id);
  const matchdayDate = fixtureDashboardDate(fixture.date);
  const matchdayTime = fixture.time || "-";
  const matchdayTeamVisual = (team, lane, tone, fallbackName) => {
    const name = team?.name || fallbackName;
    const logoUrl = teamLogoFor(team);
    const fallback = `<span class="fixture-matchday-team-fallback"${logoUrl ? " hidden" : ""}>${escapeHtml(name)}</span>`;
    const logo = logoUrl
      ? `<img class="fixture-matchday-team-logo" src="${escapeHtml(logoUrl)}" alt="Teamlogo ${escapeHtml(name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false" />`
      : "";
    return `<div class="fixture-matchday-team fixture-matchday-team--${tone}">
      <div class="fixture-matchday-logo-wrap">${logo}${fallback}</div>
      <strong aria-label="Bahn ${escapeHtml(String(lane))}">${escapeHtml(String(lane))}</strong>
    </div>`;
  };
  const matchdayAriaLabel = `Spieltag ${fixture.day} am ${matchdayDate} um ${matchdayTime} Uhr. ${ownTeam?.name || "Eigenes Team"} auf Bahn ${ownLane} gegen ${opponent?.name || "Gegner"} auf Bahn ${opponentLane}.`;
  const pendingForOwnTeam = pendingActivationRequestForTeam(fixture, player.teamId);
  const latestOwn = latestActivationRequest(fixture, player.teamId);
  const enterAllowed = canEnterFixture(fixture);
  const statusClass = enterAllowed ? "good" : latestOwn?.status === "pending" ? "warn" : "";
  const matchdayStatus = playerFixtureStatusInfo(fixture, player.teamId);
  const matchdayActions = [];
  const canReschedule = !window.HobbyligaResults.isConfirmed(fixture) && !fixture.saved && fixture.status !== "played";

  if (pendingForOwnTeam) {
    matchdayActions.push(`<button class="matchday-action-button matchday-action-button--primary" data-action="approve-fixture-request" data-id="${fixture.id}" data-request-id="${pendingForOwnTeam.id}">Freigeben</button>`);
  } else if (enterAllowed) {
    matchdayActions.push(`<button class="matchday-action-button matchday-action-button--primary" data-action="start-result" data-id="${fixture.id}">Ergebnisse erfassen</button>`);
  } else if (!latestOwn || latestOwn.status !== "pending") {
    matchdayActions.push(`<button class="matchday-action-button matchday-action-button--primary" data-action="request-fixture-activation" data-id="${fixture.id}">Spieltag aktivieren</button>`);
  }

  if (canReschedule) {
    matchdayActions.push(`
      <details class="matchday-reschedule">
        <summary>Spieltag verschieben</summary>
        <form class="activation-option compact-reschedule" data-form="fixture-request" data-id="${fixture.id}">
          <input type="hidden" name="type" value="reschedule" />
          <input name="proposedDate" type="date" value="${fixture.date || ""}" aria-label="Datum" required />
          <input name="proposedTime" type="time" value="${fixture.time || "19:00"}" aria-label="Uhrzeit" required />
          <button class="matchday-action-button matchday-action-button--primary" type="submit">Vorschlag senden</button>
        </form>
      </details>
    `);
  }

  wrap.innerHTML = `
    <div class="fixture-page">
      <section class="fixture-page-hero">
        <div class="fixture-page-top">
          <button class="ghost-button" type="button" data-action="back-player-dashboard">Zurück</button>
          <span class="pill ${statusClass}">${fixtureActivationLabel(fixture)}</span>
        </div>
        <div class="fixture-scorecard fixture-matchday-card" aria-label="${escapeHtml(matchdayAriaLabel)}">
          <div class="fixture-matchday-meta">
            <span>Spieltag ${fixture.day}</span>
            <strong>${escapeHtml(matchdayDate)} <i aria-hidden="true">&middot;</i> ${escapeHtml(matchdayTime)} Uhr</strong>
          </div>
          <div class="fixture-matchday-duel">
            ${matchdayTeamVisual(ownTeam, ownLane, "own", "Eigenes Team")}
            <b aria-hidden="true">VS</b>
            ${matchdayTeamVisual(opponent, opponentLane, "opponent", "Gegner")}
          </div>
        </div>
      </section>

      <section class="matchday-control-area">
        <article class="matchday-status-card matchday-status-card--${matchdayStatus.tone}" aria-label="Status: ${escapeHtml(matchdayStatus.title)}">
          <span class="matchday-status-icon" aria-hidden="true">${matchdayStatusIcon(matchdayStatus.icon)}</span>
          <div>
            <h2>${escapeHtml(matchdayStatus.title)}</h2>
            <p>${escapeHtml(matchdayStatus.description)}</p>
            ${matchdayStatus.meta ? `<small>${escapeHtml(matchdayStatus.meta)}</small>` : ""}
          </div>
        </article>
        ${matchdayActions.length ? `<section class="matchday-actions"><span class="field-label">Aktionen</span><div>${matchdayActions.join("")}</div></section>` : ""}
      </section>

      ${fixtureDetailsContentHtml(fixture, player)}
    </div>
  `;
  return wrap;
}

function statInner(label, value) {
  return `<span>${label}</span><strong>${value}</strong>`;
}

function dashboardStatIcon(name, tone) {
  const icons = {
    trophy: `<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M12 13v4M9 20h6"/>`,
    team: `<circle cx="8.5" cy="8" r="3"/><circle cx="16.8" cy="9.2" r="2.4"/><path d="M3.6 19c.6-3.1 2.6-5 4.9-5s4.4 1.9 5 5M14.2 18.7c.4-2.3 1.8-3.9 3.9-3.9 1.1 0 2.1.4 2.8 1.1"/>`,
    "bowling-pin": `<path d="M12 3.5c-1.1 1.2-1.5 2.4-1.2 3.6.2.8.8 1.5.6 2.5-.2 1.2-.9 2.3-1.1 3.5L9.2 19h5.6l-1.1-5.4c-.2-1.2-.9-2.3-1.1-3.5-.2-1 .4-1.7.6-2.5.3-1.2-.1-2.4-1.2-3.6Z"/><path d="M10.8 8h2.4M4 6.5h3M5.5 5v3M17 18h3"/>`,
    "trend-up": `<path d="M4 19V5M4 19h16"/><path d="m7 15 4-4 3 2 5-6M15 7h4v4"/>`,
    "alert-circle": `<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>`,
  };
  const icon = icons[name];
  if (!icon) return "";
  const toneClass = tone === "blue" ? " stat-icon--blue" : " stat-icon--orange";
  return `<span class="stat-icon${toneClass}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">${icon}</svg></span>`;
}

function playerRank(playerId) {
  const ranking = window.HobbyligaStatistics.getPlayerRanking(state);
  const index = ranking.findIndex((row) => row.player.id === playerId);
  return index >= 0 ? index + 1 : null;
}

function dashboardFixtureIcon(name, tone = "neutral") {
  const icons = {
    calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16M8 14h3M8 17h5"/>`,
    lane: `<path d="M5 21 8.5 9h7L19 21M7 21h10M8.4 17h7.2M9.4 13h5.2"/><path d="M12 3c-1 .9-1.5 1.7-1.4 2.7.1.7.5 1 .5 1.8 0 .6-.3 1.2-.9 1.8h3.6c-.6-.6-.9-1.2-.9-1.8 0-.8.4-1.1.5-1.8.1-1-.4-1.8-1.4-2.7Z"/>`,
    "ranking-star": `<path d="m12 3 2.2 4.5 5 .7-3.6 3.5.8 5-4.4-2.3-4.4 2.3.8-5-3.6-3.5 5-.7L12 3Z"/>`,
    "chevron-right": `<path d="m9 5 7 7-7 7"/>`,
  };
  const icon = icons[name];
  if (!icon) return "";
  const toneClass = ["blue", "orange", "neutral"].includes(tone) ? tone : "neutral";
  return `<span class="fixture-icon fixture-icon--${toneClass} fixture-icon--${name}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">${icon}</svg></span>`;
}

function fixtureDashboardDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return formatDate(value);
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, month - 1, day));
}

function fixtureDashboardLane(fixture, teamId) {
  const lane = fixtureTeamLane(fixture, teamId);
  return lane === "-" || lane === null || lane === undefined || lane === "" ? "noch offen" : lane;
}

function playerDashboardNextFixtureHtml(fixture, teamId) {
  if (!fixture) {
    return `<article class="player-next-fixture player-next-fixture--empty" aria-label="Nächster Spieltag. Aktuell ist kein weiterer Spieltag geplant.">
      <span class="player-next-fixture-icon">${dashboardFixtureIcon("calendar", "blue")}</span>
      <div class="player-next-fixture-content"><h2>Nächster Spieltag</h2><p>Aktuell ist kein weiterer Spieltag geplant.</p></div>
    </article>`;
  }

  const ownTeam = teamById(teamId);
  const opponentTeamId = fixture.homeTeamId === teamId ? fixture.awayTeamId : fixture.homeTeamId;
  const opponent = teamById(opponentTeamId);
  const ownLane = fixtureDashboardLane(fixture, teamId);
  const opponentLane = fixtureDashboardLane(fixture, opponentTeamId);
  const dateLabel = fixtureDashboardDate(fixture.date);
  const timeLabel = fixture.time || "noch offen";
  const ownName = ownTeam?.name || "Eigenes Team";
  const opponentName = opponent?.name || "Gegner";
  const teamVisual = (team, name, lane, tone, laneLabel) => {
    const logoUrl = teamLogoFor(team);
    const fallback = `<span class="player-next-fixture-team-fallback"${logoUrl ? " hidden" : ""}>${escapeHtml(name)}</span>`;
    const logo = logoUrl
      ? `<img class="player-next-fixture-team-logo" src="${escapeHtml(logoUrl)}" alt="Teamlogo ${escapeHtml(name)}" onerror="this.hidden=true;this.nextElementSibling.hidden=false" />`
      : "";
    return `<span class="player-next-fixture-team player-next-fixture-team--${tone}">
      ${logo}${fallback}
      <small aria-label="${escapeHtml(laneLabel)} ${escapeHtml(String(lane))}">${escapeHtml(String(lane))}</small>
    </span>`;
  };
  const matchAriaLabel = `N\u00e4chster Spieltag am ${dateLabel} um ${timeLabel}. ${ownName} gegen ${opponentName}. Eigene Bahn ${ownLane}, Gegner-Bahn ${opponentLane}. Spieltag \u00f6ffnen.`;

  return `<button class="player-next-fixture" type="button" data-action="open-fixture-day" data-id="${escapeHtml(fixture.id)}" aria-label="${escapeHtml(matchAriaLabel)}">
    <span class="player-next-fixture-heading"><strong>N\u00e4chster Spieltag</strong><span class="player-next-fixture-date">${escapeHtml(dateLabel)} <small>&middot; ${escapeHtml(timeLabel)} Uhr</small></span></span>
    <span class="player-next-fixture-match">
      ${teamVisual(ownTeam, ownName, ownLane, "own", "Eigene Bahn")}
      <em>VS</em>
      ${teamVisual(opponent, opponentName, opponentLane, "opponent", "Gegner-Bahn")}
    </span>
    ${dashboardFixtureIcon("chevron-right", "neutral")}
  </button>`;
  const ariaLabel = `Nächster Spieltag am ${dateLabel} um ${timeLabel}. ${ownName} gegen ${opponentName}. Eigene Bahn ${ownLane}, Gegner-Bahn ${opponentLane}. Spieltag öffnen.`;

  return `<button class="player-next-fixture" type="button" data-action="open-fixture-day" data-id="${escapeHtml(fixture.id)}" aria-label="${escapeHtml(ariaLabel)}">
    <span class="player-next-fixture-icon">${dashboardFixtureIcon("calendar", "blue")}</span>
    <span class="player-next-fixture-content">
      <span class="player-next-fixture-heading"><strong>Nächster Spieltag</strong><span class="player-next-fixture-date">${escapeHtml(dateLabel)}<small>${escapeHtml(timeLabel)} Uhr</small></span></span>
      <span class="player-next-fixture-match">
        <span class="player-next-fixture-team player-next-fixture-team--own"><strong>${escapeHtml(ownName)}</strong><small aria-label="Eigene Bahn ${escapeHtml(String(ownLane))}">${escapeHtml(String(ownLane))}</small></span>
        <em>vs.</em>
        <span class="player-next-fixture-team player-next-fixture-team--opponent"><strong>${escapeHtml(opponentName)}</strong><small aria-label="Gegner-Bahn ${escapeHtml(String(opponentLane))}">${escapeHtml(String(opponentLane))}</small></span>
      </span>
    </span>
    ${dashboardFixtureIcon("chevron-right", "neutral")}
  </button>`;
}

function playerNextFixtureCard(fixture, teamId) {
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  const opponent = fixture.homeTeamId === teamId ? away : home;
  const request = latestActivationRequest(fixture);
  return `
    <div class="fixture-preview">
      <div class="dashboard-versus">
        <div><strong>${home.name}</strong><small>Bahn ${fixtureTeamLane(fixture, fixture.homeTeamId)}</small></div>
        <span>vs.</span>
        <div><strong>${away.name}</strong><small>Bahn ${fixtureTeamLane(fixture, fixture.awayTeamId)}</small></div>
      </div>
      <div class="fixture-meta">
        <span>Nächste Begegnung: ${opponent.name}</span>
        <span>${formatDate(fixture.date)} · ${fixture.time || "-"}</span>
        ${request ? `<span>Anfrage: ${requestLabel(request.type)} · ${request.status === "approved" ? "bestätigt" : "wartet auf Gegner"}</span>` : ""}
      </div>
    </div>
  `;
}

function fixtureTeamLane(fixture, teamId) {
  const baseLane = Number.parseInt(fixture?.lane, 10);
  if (!Number.isFinite(baseLane)) return fixture?.lane || "-";
  return fixture.homeTeamId === teamId ? baseLane : baseLane + 1;
}

function playerDashboardPanelHtml(panel, player, fixture, openFines, table) {
  if (panel === "table") {
    return `<div class="section panel dashboard-detail"><div class="match-title"><h2>Vollständige Tabelle</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div>${standingsTableHtml(table)}</div>`;
  }
  if (panel === "fines") {
    return `<div class="section panel dashboard-detail"><div class="match-title"><h2>Strafgeld-Details</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div>${openFines.length ? openFines.map(fineDetailHtml).join("") : emptyHtml("Keine offenen Strafgelder", "Für dich ist aktuell nichts offen.")}</div>`;
  }
  if (panel === "ranking") {
    const rows = window.HobbyligaStatistics
      .getPlayerRanking(state)
      .map((row) => ({ ...row, team: teamById(row.player.teamId) }))
      .slice(0, 12);
    return `<div class="section panel dashboard-detail"><div class="match-title"><h2>Rangliste Schnitt</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div><div class="table-wrap"><table><thead><tr><th>Platz</th><th>Spieler</th><th>Team</th><th>Schnitt</th><th>Bestes Spiel</th></tr></thead><tbody>${rows.map((row, index) => `<tr class="${row.player.id === player.id ? "highlight-row" : ""}"><td>${index + 1}</td><td>${row.player.name}</td><td>${row.team?.name || "-"}</td><td>${row.stats.average.toFixed(1)}</td><td>${row.stats.high || "-"}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  if (panel === "bestAverage") {
    const stats = playerStats(player.id);
    return `<div class="section panel dashboard-detail"><div class="match-title"><h2>Bester Schnitt</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div><div class="grid cols-3">${stat("Schnitt", stats.valid ? stats.average.toFixed(1) : "n.v.")}${stat("Spiele", stats.games)}${stat("Bestes Spiel", stats.high || "-")}</div></div>`;
  }
  if (panel === "fixture" && fixture) {
    return fixtureDetailsHtml(fixture, player);
  }
  if (panel === "request" && fixture) {
    return fixtureRequestHtml(fixture, player);
  }
  return "";
}

function fineDetailHtml(fine) {
  const fixture = window.HobbyligaSchedule.findById(state, fine.fixtureId);
  return `<article class="fine-item"><strong>${fine.total.toFixed(2)} €</strong><span>Spieltag ${fine.day}, Spiel ${fine.gameNumber} · ${formatDate(fixture?.date)} · ${fine.gross} Pins unter Strafgrenze ${fine.limit}</span><span class="mini">Grund: Ergebnis unter Strafgrenze</span></article>`;
}

function fixtureDetailsHtml(fixture, player) {
  return `
    <div class="section panel dashboard-detail">
      <div class="match-title"><h2>Spieltag-Details</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div>
      ${fixtureDetailsContentHtml(fixture, player)}
    </div>
  `;
}

function fixtureDetailsContentHtml(fixture, player) {
  const opponentTeamId = fixture.homeTeamId === player.teamId ? fixture.awayTeamId : fixture.homeTeamId;
  const opponent = teamById(opponentTeamId);
  const previous = state.fixtures
    .filter((item) => item.id !== fixture.id)
    .filter((item) => [item.homeTeamId, item.awayTeamId].includes(player.teamId) && [item.homeTeamId, item.awayTeamId].includes(opponentTeamId))
    .filter((item) => item.date < fixture.date || item.saved || item.status === "played")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const ownRows = playerScoreRows(player.id).filter((row) => row.opponent === opponent?.name);
  const ownAvg = ownRows.length ? (ownRows.reduce((sum, row) => sum + row.gross, 0) / ownRows.length).toFixed(1) : "-";
  const ownHigh = ownRows.reduce((max, row) => Math.max(max, row.gross), 0);
  return `
    <section class="section panel sport-panel fixture-history">
      <div class="match-title"><h2>Spieltag-Details</h2></div>
      <div class="grid cols-3">
        ${stat("Begegnungen", previous.length)}
        ${stat("Mein Schnitt vs. Team", ownAvg)}
        ${stat("Mein bestes Spiel vs. Team", ownHigh || "-")}
      </div>
      <div class="section">
        <h3>Bisherige Begegnungen gegen ${opponent?.name || "-"}</h3>
        <div class="news-list">${previous.length ? previous.map((item) => `<article class="news-item"><time>${formatDate(item.date)} · Spieltag ${item.day}</time><h3>${teamById(item.homeTeamId).name} vs. ${teamById(item.awayTeamId).name}</h3><p class="mini">${item.saved ? `${item.points.home}:${item.points.away} Punkte` : fixtureStatusLabels[item.status] || item.status}</p></article>`).join("") : emptyHtml("Noch keine direkten Ergebnisse", "")}</div>
      </div>
    </section>
  `;
}

function fixtureRequestHtml(fixture, player) {
  const ownTeamId = player.teamId;
  const pendingForOwnTeam = pendingActivationRequestForTeam(fixture, ownTeamId);
  const latestOwn = latestActivationRequest(fixture, ownTeamId);
  return `
    <div class="section panel dashboard-detail">
      <div class="match-title"><h2>Spieltag aktivieren</h2><button class="ghost-button" data-action="dashboard-panel" data-panel="">Schließen</button></div>
      ${pendingForOwnTeam ? `<div class="section empty-state"><strong>Anfrage vom Gegner</strong><span>${requestLabel(pendingForOwnTeam.type)}${pendingForOwnTeam.proposedDate ? ` · Vorschlag ${formatDate(pendingForOwnTeam.proposedDate)}` : ""}</span><button class="primary-button" data-action="approve-fixture-request" data-id="${fixture.id}" data-request-id="${pendingForOwnTeam.id}">Freigeben</button></div>` : ""}
      ${latestOwn && latestOwn.status === "pending" ? `<div class="section empty-state"><strong>Anfrage gesendet</strong><span>${requestLabel(latestOwn.type)} wartet auf Bestätigung des Gegners.</span></div>` : ""}
      <div class="section activation-options">
        <form class="activation-option" data-form="fixture-request" data-id="${fixture.id}">
          <input type="hidden" name="type" value="early" />
          <label>Vorspielen</label>
          <input name="proposedDate" type="date" value="${fixture.date || ""}" />
          <button class="primary-button" type="submit">Freigabe bitten</button>
        </form>
        <form class="activation-option" data-form="fixture-request" data-id="${fixture.id}">
          <input type="hidden" name="type" value="late" />
          <label>Nachspielen</label>
          <input name="proposedDate" type="date" value="${fixture.date || ""}" />
          <button class="primary-button" type="submit">Freigabe bitten</button>
        </form>
      </div>
    </div>
  `;
}

function renderPlayerStats() {
  const player = currentPlayer();
  const wrap = el("div");
  if (!player) {
    wrap.innerHTML = emptyHtml("Kein Spielerprofil verknüpft", "Bitte den Admin, deinen Zugang einem Spieler zuzuweisen.");
    return wrap;
  }

  const team = teamById(player.teamId);
  const table = standings();
  const teamRow = table.find((row) => row.team.id === player.teamId);
  const place = table.findIndex((row) => row.team.id === player.teamId) + 1;
  const stats = playerStats(player.id);
  const ownScores = playerScoreRows(player.id);
  const best = ownScores.reduce((max, row) => Math.max(max, row.gross), 0);
  const profileInitials = player.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const profileImage = player.avatar || player.profileImage || player.photo;
  const teamLogoUrl = teamLogoFor(team);
  const averageValue = stats.valid ? stats.average.toFixed(1).replace(".", ",") : "-";
  const handicapValue = stats.valid ? String(stats.handicap) : "-";
  const historyContent = ownScores.length
    ? playerHistoryHtml(ownScores)
    : `<div class="profile-history-empty"><strong>Persönliche Entwicklung</strong><span>Nach dem ersten gespeicherten Spieltag siehst du hier deine Entwicklung.</span></div>`;

  wrap.innerHTML = `
    <div class="player-profile-page">
      <section class="player-profile-hero" aria-label="Profil von ${escapeHtml(player.name)}">
        <div class="player-profile-avatar ${profileImage ? "has-image" : ""}">
          ${profileImage ? `<img src="${escapeHtml(String(profileImage))}" alt="Profil von ${escapeHtml(player.name)}" />` : `<span aria-hidden="true">${escapeHtml(profileInitials || "?")}</span>`}
        </div>
        <div class="player-profile-identity">
          <span>Saisonstatistik</span>
          <h1>${escapeHtml(player.name)}</h1>
          <p>${teamLogoUrl ? `<img src="${escapeHtml(teamLogoUrl)}" alt="" onerror="this.hidden=true" />` : ""}${escapeHtml(team?.name || "Ohne Team")}</p>
        </div>
      </section>

      <section class="player-profile-section" aria-labelledby="profilePrimaryStats">
        <h2 id="profilePrimaryStats">Deine Kennzahlen</h2>
        <div class="profile-primary-stats">
          <article><span>Schnitt</span><strong>${averageValue}</strong></article>
          <article><span>Handicap</span><strong>${handicapValue}</strong></article>
          <article><span>Tabellenplatz</span><strong>${place || "-"}</strong></article>
          <article><span>Bestes Spiel</span><strong>${best || "-"}</strong></article>
        </div>
      </section>

      <section class="player-profile-section" aria-labelledby="profileSeasonStats">
        <h2 id="profileSeasonStats">Saisonübersicht</h2>
        <div class="profile-secondary-stats">
          <article><span>Team</span><strong>${escapeHtml(team?.name || "-")}</strong></article>
          <article><span>Gespielte Spiele</span><strong>${stats.games}</strong></article>
          <article><span>Siege</span><strong>${teamRow?.gamesWon || 0}</strong></article>
          <article><span>Niederlagen</span><strong>${teamRow?.gamesLost || 0}</strong></article>
          <article><span>Pins gesamt</span><strong>${stats.pins}</strong></article>
        </div>
      </section>

      <section class="player-profile-section profile-history-section" aria-labelledby="profileHistory">
        <h2 id="profileHistory">Persönliche Entwicklung</h2>
        <div class="profile-history-card">${historyContent}</div>
      </section>
    </div>
  `;
  return wrap;
}

function renderPlayerSubmitResults() {
  const player = currentPlayer();
  const wrap = el("div");
  if (!player) {
    wrap.innerHTML = emptyHtml("Kein Spielerprofil verknüpft", "Bitte den Admin, deinen Zugang einem Spieler zuzuweisen.");
    return wrap;
  }
  const teamFixtures = window.HobbyligaSchedule
    .getByTeam(state, player.teamId)
    .filter((fixture) => !fixture.confirmed && fixture.status !== "played")
    .sort((a, b) => a.date.localeCompare(b.date) || a.day - b.day || a.lane - b.lane);
  const selectedId = sessionStorage.getItem("playerSubmitFixtureId") || teamFixtures[0]?.id;
  const fixture = teamFixtures.find((item) => item.id === selectedId) || teamFixtures[0];
  if (!fixture) {
    wrap.innerHTML = emptyHtml("Keine Erfassung offen", "Aktuell gibt es keinen offenen Spieltag für dein Team.");
    return wrap;
  }
  if (!canEnterFixture(fixture)) {
    wrap.innerHTML = `
      <div class="dashboard-welcome"><div><p class="eyebrow">Spieltag ${fixture.day}</p><h2>Erfassung gesperrt</h2><p>Der Spieltag ist noch nicht freigegeben.</p></div></div>
      <div class="section panel">
        ${playerNextFixtureCard(fixture, player.teamId)}
        <div class="section empty-state"><strong>Abstimmung erforderlich</strong><span>Freigabe des Gegners erforderlich.</span><button class="primary-button" data-action="open-fixture-day" data-id="${fixture.id}">Freigabe bitten</button></div>
      </div>
    `;
    return wrap;
  }
  sessionStorage.setItem("playerSubmitFixtureId", fixture.id);
  const ownTeamId = player.teamId;
  const opponent = teamById(fixture.homeTeamId === ownTeamId ? fixture.awayTeamId : fixture.homeTeamId);
  wrap.innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <p class="eyebrow">Spieltag ${fixture.day} · ${fixture.round}</p>
        <h2>Ergebnisse erfassen</h2>
        <p>Gegner: ${opponent?.name || "-"} · ${formatDate(fixture.date)} · ${fixture.time || "-"}</p>
      </div>
    </div>
    <div class="section panel">
      <div class="form-row">
        <div>
          <label for="playerSubmitFixture">Spieltag</label>
          <select id="playerSubmitFixture">${teamFixtures.map((item) => `<option value="${item.id}">ST ${item.day}: ${teamById(item.homeTeamId).name} vs. ${teamById(item.awayTeamId).name} · ${fixtureStatusLabels[item.status] || item.status}</option>`).join("")}</select>
        </div>
        <div>
          <span class="field-label">Status</span>
          <p><span class="pill ${fixture.status === "submitted" ? "warn" : ""}">${fixtureStatusLabels[fixture.status] || fixture.status}</span></p>
        </div>
      </div>
    </div>
    ${fixture.status === "submitted" ? `<div class="section panel"><h2>Eingereicht</h2><p>Deine Ergebnisse warten auf die Freigabe des Ligaleiters</p></div>` : ""}
    <div class="section panel">
      <div class="match-title">
        <div>
          <h2>Blindspieler</h2>
          <p class="mini">Falls nur zwei Spieler antreten, wird der Blindspieler automatisch berechnet und in die Teamwertung übernommen.</p>
        </div>
        <button class="button" data-action="calculate-blind" data-id="${fixture.id}" data-team-id="${ownTeamId}">Blindspieler berechnen</button>
      </div>
      ${fixture.blindPlayers?.[ownTeamId] ? blindPlayerHtml(fixture.blindPlayers[ownTeamId]) : ""}
    </div>
    <form id="playerResultForm" class="section panel">
      <h2>${teamById(ownTeamId).name}</h2>
      <p class="mini">Erfasst werden Spiel 1, Spiel 2 und Spiel 3. Serie, Schnitt und Handicap werden automatisch berechnet.</p>
      <div class="section">
        <label for="scorePhoto">Foto vom Bowlingcomputer</label>
        <input id="scorePhoto" type="file" accept="image/*" capture="environment" />
        <p class="mini">Foto-Upload ist vorbereitet. Automatisches Auslesen per OCR kann als nächster Schritt ergänzt werden; erkannte Werte sollten vor dem Speichern bestätigt werden.</p>
      </div>
      <div class="section table-wrap">
        <table>
          <thead><tr><th>Spieler</th><th>Spiel 1</th><th>Spiel 2</th><th>Spiel 3</th><th>Serie</th><th>Schnitt</th><th>Handicap</th></tr></thead>
          <tbody>${lineupForTeam(ownTeamId).map((teamPlayer) => playerResultRowHtml(fixture, teamPlayer)).join("")}</tbody>
        </table>
      </div>
      <div class="section actions">
        <button class="primary-button" type="submit">Ergebnisse einreichen</button>
      </div>
    </form>
  `;
  $("#playerSubmitFixture", wrap).value = fixture.id;
  return wrap;
}

function playerResultRowHtml(fixture, player) {
  const scores = [1, 2, 3].map((number) => window.HobbyligaResults.getScore(fixture, number, player.id)?.gross ?? "");
  const numeric = scores.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  const series = numeric.reduce((sum, value) => sum + value, 0);
  const average = numeric.length ? (series / numeric.length).toFixed(1) : "-";
  const stats = playerStats(player.id, fixture.id);
  return `
    <tr>
      <td><strong>${player.name}</strong></td>
      ${[1, 2, 3].map((gameNumber, index) => `<td><input name="${fixture.id}|${gameNumber}|${player.id}" type="number" inputmode="numeric" min="0" max="300" value="${scores[index]}" required /></td>`).join("")}
      <td>${series || "-"}</td>
      <td>${average}</td>
      <td>${stats.valid ? stats.handicap : "n.v."}</td>
    </tr>
  `;
}

function blindPlayerHtml(blind) {
  return `<div class="section empty-state"><strong>Blindspieler: ${blind.gross} Pins + ${blind.handicap} HCP = ${blind.net} Netto</strong><span>Basis: ${blind.sourcePlayerName}. Der Blindspieler muss bei Spielbeginn im Bowlingcomputer eingetragen werden.</span></div>`;
}

function renderUpcomingGames() {
  const player = currentPlayer();
  const wrap = el("div");
  if (!player) {
    wrap.innerHTML = emptyHtml("Kein Spielerprofil verknüpft", "Bitte den Admin, deinen Zugang einem Spieler zuzuweisen.");
    return wrap;
  }

  const team = teamById(player.teamId);
  const games = window.HobbyligaSchedule
    .getByTeam(state, player.teamId)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.time || "").localeCompare(b.time || "") || a.day - b.day);

  wrap.innerHTML = `
    <div class="dashboard-welcome">
      <div>
        <p class="eyebrow">${team?.name || "Ohne Team"}</p>
        <h2>Kommende Spiele</h2>
        <p>${player.name}</p>
      </div>
    </div>
    <div class="section panel">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Gegner</th><th>Datum</th><th>Uhrzeit</th><th>Spielort</th><th>Status</th></tr></thead>
          <tbody>
            ${games.length ? games.map((fixture) => upcomingGameRowHtml(fixture, player.teamId)).join("") : `<tr><td colspan="5">Keine Spiele geplant.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return wrap;
}

function upcomingGameRowHtml(fixture, teamId) {
  const opponent = teamById(fixture.homeTeamId === teamId ? fixture.awayTeamId : fixture.homeTeamId);
  const status = window.HobbyligaResults.isConfirmed(fixture) ? "released" : fixture.status || "planned";
  return `<tr><td><strong>${opponent?.name || "-"}</strong><br><span class="mini">Spieltag ${fixture.day} · Bahn ${fixture.lane}</span></td><td>${formatDate(fixture.date)}</td><td>${fixture.time || "-"}</td><td>${fixture.venue || state.league.venue}</td><td><span class="pill ${status === "released" ? "good" : status === "postponed" || status === "submitted" ? "warn" : ""}">${fixtureStatusLabels[status] || status}</span></td></tr>`;
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function dashboardGameDayFixtures(teamId = null) {
  const today = new Date().toISOString().slice(0, 10);
  return state.fixtures
    .filter((fixture) => !fixture.saved && fixture.date === today && (!teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId))
    .sort((a, b) => a.lane - b.lane);
}

function nextOpenFixture(teamId = null) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = state.fixtures.filter((fixture) => !fixture.saved && fixture.date >= today && (!teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId));
  if (upcoming.length) return upcoming.sort((a, b) => a.date.localeCompare(b.date) || a.day - b.day || a.lane - b.lane)[0];
  return state.fixtures
    .filter((fixture) => !fixture.saved && (!teamId || fixture.homeTeamId === teamId || fixture.awayTeamId === teamId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.day - b.day || a.lane - b.lane)[0];
}

function canEnterFixture(fixture) {
  if (!fixture || window.HobbyligaResults.isConfirmed(fixture) || fixture.status === "played") return false;
  return !!fixture.activation?.approved;
}

function fixtureActivationLabel(fixture) {
  if (canEnterFixture(fixture)) return "aktiviert";
  const request = latestActivationRequest(fixture);
  if (request?.status === "pending") return "Warten auf Bestätigung";
  return fixtureStatusLabels[fixture.status] || "geplant";
}

function latestActivationRequest(fixture, requesterTeamId = null) {
  const requests = fixture.activationRequests || [];
  return requests
    .filter((request) => !requesterTeamId || request.requesterTeamId === requesterTeamId)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""))[0] || null;
}

function pendingActivationRequestForTeam(fixture, teamId) {
  return (fixture.activationRequests || []).find((request) => request.status === "pending" && request.targetTeamId === teamId) || null;
}

function requestLabel(type) {
  if (type === "early") return "Vorspielen";
  if (type === "late") return "Nachspielen";
  if (type === "activate") return "Spieltag aktivieren";
  if (type === "reschedule") return "Spieltag verschieben";
  return "Anfrage";
}

function matchdayStatusIcon(name) {
  const icons = {
    calendar: `<path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 5Z"/>`,
    clock: `<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v5l3.3 2"/>`,
    check: `<circle cx="12" cy="12" r="8.5"/><path d="m8.2 12.1 2.4 2.5 5.2-5.4"/>`,
    arrows: `<path d="M7 7h10M14 4l3 3-3 3M17 17H7M10 14l-3 3 3 3"/>`,
    alert: `<circle cx="12" cy="12" r="8.5"/><path d="M12 8v4.5M12 16h.01"/>`,
  };
  const icon = icons[name] || icons.calendar;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">${icon}</svg>`;
}

function playerFixtureStatusInfo(fixture, teamId) {
  const incoming = pendingActivationRequestForTeam(fixture, teamId);
  const ownRequest = latestActivationRequest(fixture, teamId);
  const requestMeta = (request) => request?.proposedDate ? `Vorschlag: ${formatDate(request.proposedDate)}${request.proposedTime ? ` · ${request.proposedTime} Uhr` : ""}` : request?.createdAt ? `Anfrage gesendet am ${formatDate(request.createdAt.slice(0, 10))}` : "";

  if (window.HobbyligaResults.isConfirmed(fixture) || fixture.status === "played" || fixture.status === "released") {
    return { tone: "complete", icon: "check", title: "Abgeschlossen", description: "Dieser Spieltag ist abgeschlossen.", meta: "" };
  }
  if (fixture.status === "submitted") {
    return { tone: "waiting", icon: "clock", title: "Ergebnis wartet auf Freigabe", description: "Die eingereichten Ergebnisse werden vom Ligaleiter geprüft.", meta: "" };
  }
  if (canEnterFixture(fixture)) {
    return { tone: "active", icon: "check", title: "Spieltag aktiv", description: "Der Spieltag ist freigegeben. Ergebnisse können jetzt erfasst werden.", meta: "" };
  }
  if (incoming) {
    return { tone: "waiting", icon: "clock", title: "Anfrage des Gegners", description: `${requestLabel(incoming.type)} wurde angefragt. Bitte prüfe und bestätige den Vorschlag.`, meta: requestMeta(incoming) };
  }
  if (ownRequest?.status === "pending") {
    const requestTitles = { activate: "Wartet auf Gegner", early: "Vorspiel angefragt", late: "Nachspiel angefragt", reschedule: "Verschiebung angefragt" };
    const requestDescriptions = { activate: "Deine Aktivierungsanfrage wurde gesendet. Der Spieltag startet, sobald das Gegnerteam bestätigt.", early: "Dein Vorschlag zum Vorspielen wartet auf die Bestätigung des Gegnerteams.", late: "Dein Vorschlag zum Nachspielen wartet auf die Bestätigung des Gegnerteams.", reschedule: "Dein Terminwunsch wartet auf die Bestätigung des Gegnerteams." };
    return { tone: "waiting", icon: ownRequest.type === "activate" ? "clock" : "arrows", title: requestTitles[ownRequest.type] || "Wartet auf Gegner", description: requestDescriptions[ownRequest.type] || "Deine Anfrage wartet auf die Bestätigung des Gegnerteams.", meta: requestMeta(ownRequest) };
  }
  if (ownRequest?.status === "rejected" || fixture.status === "rejected") {
    return { tone: "rejected", icon: "alert", title: "Abgelehnt", description: "Die letzte Anfrage wurde abgelehnt. Bitte stimme einen neuen Termin mit dem Gegnerteam ab.", meta: requestMeta(ownRequest) };
  }
  if (fixture.status === "postponed") {
    return { tone: "waiting", icon: "arrows", title: "Verschoben", description: "Für diesen Spieltag wurde ein neuer Termin vereinbart.", meta: "" };
  }
  if (fixture.status === "makeup") {
    return { tone: "waiting", icon: "calendar", title: "Nachholspiel", description: "Dieser Spieltag wird als Nachholspiel ausgetragen.", meta: "" };
  }
  return { tone: "planned", icon: "calendar", title: "Geplant", description: "Der Spieltag kann aktiviert werden, sobald beide Teams bereit sind.", meta: "" };
}

function matchSummaryHtml(fixture) {
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  return `<article class="news-item"><time>${formatDate(fixture.date)} · Spieltag ${fixture.day} · ${fixture.round} · Bahn ${fixture.lane}</time><h3>${home.name} vs. ${away.name}</h3><p class="mini">${window.HobbyligaResults.isSaved(fixture) ? "gespielt" : "offen"}</p></article>`;
}

function playerScoreRows(playerId) {
  const player = playerById(playerId);
  if (!player) return [];
  const rows = [];
  state.fixtures.filter((fixture) => fixture.saved).forEach((fixture) => {
    const isHome = fixture.homeTeamId === player.teamId;
    const isAway = fixture.awayTeamId === player.teamId;
    if (!isHome && !isAway) return;
    const opponentTeam = teamById(isHome ? fixture.awayTeamId : fixture.homeTeamId);
    fixture.games.forEach((game) => {
      const score = game.scores[playerId];
      if (!score) return;
      rows.push({
        day: fixture.day,
        opponent: opponentTeam?.name || "-",
        game: game.number,
        gross: score.gross,
        handicap: score.handicap || 0,
        net: score.net || score.gross,
      });
    });
  });
  return rows.sort((a, b) => a.day - b.day || a.game - b.game);
}

function playerFixtureHtml(fixture, teamId) {
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  const opponent = fixture.homeTeamId === teamId ? away : home;
  return `<article class="news-item"><time>${formatDate(fixture.date)} · Spieltag ${fixture.day} · ${fixture.round}</time><h3>${home.name} vs. ${away.name}</h3><p class="mini">Gegner: ${opponent.name} · Bahn ${fixture.lane}</p></article>`;
}

function playerHistoryHtml(scores) {
  if (!scores.length) return emptyHtml("Noch kein Verlauf", "Nach dem ersten gespeicherten Spieltag siehst du hier deine Entwicklung.");
  const latest = scores.slice(-9);
  const max = Math.max(...latest.map((row) => row.gross), 1);
  return `<div class="history-bars">${latest.map((row) => `<div><span>${row.gross}</span><i style="height:${Math.max(18, (row.gross / max) * 100)}%"></i><small>ST ${row.day}.${row.game}</small></div>`).join("")}</div>`;
}

function renderLeague() {
  const league = window.HobbyligaLeague.get(state);
  const wrap = el("div");
  wrap.innerHTML = `
    <div class="grid cols-3">
      ${stat("Liga", league.name)}
      ${stat("Saison", window.HobbyligaLeague.getSeasonName(state))}
      ${stat("Spielmodus", league.mode)}
    </div>
    <div class="section panel">
      <h2>Liga bearbeiten</h2>
      <form id="leagueForm" class="grid">
        <div class="form-row">
          ${field("Name", "leagueName", league.name)}
          ${field("Saison", "leagueSeason", league.season)}
          ${field("Center", "leagueVenue", league.venue)}
        </div>
        <div class="form-row">
          ${field("Handicap Basis", "handicapBase", state.league.handicapBase, "number")}
          ${field("Handicap Faktor", "handicapFactor", state.league.handicapFactor, "number", "0.01")}
          ${field("Min. Handicap", "handicapMin", state.league.handicapMin, "number")}
          ${field("Max. Handicap", "handicapMax", state.league.handicapMax, "number")}
        </div>
        <div class="form-row">
          ${field("Strafgrenze Spieler-Pins", "fineLimit", state.league.fineLimit, "number")}
          ${field("Strafbetrag (€)", "fineAmount", state.league.fineAmount, "number", "0.01")}
          ${field("Spiele pro Spieltag", "gamesPerMatch", window.HobbyligaLeague.getGamesPerMatch(state), "number")}
          ${field("Spieler pro Team", "playersPerTeam", state.league.playersPerTeam, "number")}
        </div>
        <div class="form-row">
          ${field("Punkte je Spiel-Sieg", "pointsPerGameWin", state.league.pointsPerGameWin, "number")}
          ${field("Punkte je Spiel-Unentschieden", "pointsPerGameTie", state.league.pointsPerGameTie, "number")}
          ${field("Punkte Gesamtholz-Sieg", "pointsTotalWin", state.league.pointsTotalWin, "number")}
          ${field("Punkte Gesamtholz-Unentschieden", "pointsTotalTie", state.league.pointsTotalTie, "number")}
        </div>
        <label class="actions"><input id="handicapEnabled" type="checkbox" ${state.league.handicapEnabled ? "checked" : ""} /> Handicap bei Netto-Ergebnis berücksichtigen</label>
        <label class="actions"><input id="autoConfirmResults" type="checkbox" ${state.league.autoConfirmResults ? "checked" : ""} /> Ergebnisse beim Speichern automatisch bestätigen</label>
        <label class="actions"><input id="provisionalResults" type="checkbox" ${state.league.provisionalResults ? "checked" : ""} /> Vorläufige Ergebnisse erlauben</label>
        <div>
          <label for="tableSort">Wertung für Tabelle</label>
          <select id="tableSort">
            <option value="pointsThenPins" ${state.league.tableSort === "pointsThenPins" ? "selected" : ""}>Punkte, dann Pins</option>
            <option value="pointsThenDiff" ${state.league.tableSort === "pointsThenDiff" ? "selected" : ""}>Punkte, dann Differenz</option>
          </select>
        </div>
        <p class="mini">Hinweis: Bestätigte Ergebnisse behalten ihren Regel-Snapshot. Änderungen gelten für neue und vorläufige Ergebnisse.</p>
        <button class="primary-button" type="submit">Liga speichern</button>
      </form>
    </div>
    <div class="section panel">
      <h2>Teams und Spieler</h2>
      ${teamRosterHtml()}
    </div>
  `;
  return wrap;
}

function renderSchedule() {
  const days = window.HobbyligaSchedule.getDays(state);
  const wrap = el("div");
  wrap.innerHTML = canAdmin()
    ? `<div class="toolbar"><button class="primary-button" data-action="regen-schedule">Spielplan neu erstellen</button><span class="pill warn">Hinrunde und Rückrunde mit Heim-/Auswärtstausch</span></div>`
    : `<div class="dashboard-welcome"><div><p class="eyebrow">${window.HobbyligaLeague.getSeasonName(state)}</p><h2>Spielplan</h2><p>Alle Teams, alle Begegnungen, Ergebnisse und Status.</p></div></div>`;
  days.forEach((day) => {
    const fixtures = window.HobbyligaSchedule.getByDay(state, day);
    const section = el("section", "section");
    section.innerHTML = `<h2>Spieltag ${day} · ${fixtures[0]?.round || ""}</h2><div class="grid cols-2">${fixtures.map((fixture) => (canAdmin() ? matchCardHtml(fixture) : scheduleOverviewCardHtml(fixture))).join("")}</div>`;
    wrap.append(section);
  });
  return wrap;
}

function renderResults() {
  const selectedId = sessionStorage.getItem("selectedFixtureId") || state.fixtures.find((fixture) => !window.HobbyligaResults.isSaved(fixture) && fixture.status !== "played")?.id || state.fixtures.find((fixture) => !window.HobbyligaResults.isSaved(fixture))?.id || state.fixtures[0]?.id;
  const fixture = window.HobbyligaSchedule.findById(state, selectedId) || state.fixtures[0];
  if (fixture) sessionStorage.setItem("selectedFixtureId", fixture.id);
  const wrap = el("div");
  if (!fixture) {
    wrap.innerHTML = emptyHtml("Kein Spielplan vorhanden", "Lege zuerst Teams an und erstelle den Spielplan.");
    return wrap;
  }
  wrap.innerHTML = `
    <div class="panel">
      <div class="form-row">
        <div>
          <label for="fixturePicker">Begegnung</label>
          <select id="fixturePicker">${state.fixtures.map((item) => `<option value="${item.id}">ST ${item.day}: ${teamById(item.homeTeamId).name} vs. ${teamById(item.awayTeamId).name}${item.saved ? " · gespeichert" : ""}</option>`).join("")}</select>
        </div>
        <div>
          <span class="field-label">Status</span>
          <p><span class="pill ${window.HobbyligaResults.isSaved(fixture) ? "good" : "warn"}">${window.HobbyligaResults.isSaved(fixture) ? (window.HobbyligaResults.isConfirmed(fixture) ? "Bestätigt" : "Vorläufig") : "Offen"}</span></p>
        </div>
      </div>
    </div>
    <form id="resultForm" class="section panel">
      <h2>${teamById(fixture.homeTeamId).name} gegen ${teamById(fixture.awayTeamId).name}</h2>
      <p class="mini">Erfasst werden Brutto-Pins. Handicap und Netto-Ergebnis werden beim Speichern je Spieler und Spiel berechnet.</p>
      <div class="section grid cols-2">
        ${resultTeamHtml(fixture, fixture.homeTeamId)}
        ${resultTeamHtml(fixture, fixture.awayTeamId)}
      </div>
      <div class="section actions">
        <button class="primary-button" type="submit">Ergebnis speichern</button>
        ${window.HobbyligaResults.isSaved(fixture) ? `<button class="button" type="button" data-action="toggle-confirm" data-id="${fixture.id}">${window.HobbyligaResults.isConfirmed(fixture) ? "Auf vorläufig setzen" : "Freigeben"}</button><button class="danger-button" type="button" data-action="reject-result" data-id="${fixture.id}">Ablehnen</button>` : ""}
        <button class="ghost-button" type="button" data-action="clear-fixture" data-id="${fixture.id}">Ergebnis leeren</button>
      </div>
    </form>
    ${window.HobbyligaResults.isSaved(fixture) ? `<div class="section grid cols-3">${stat("Punkte Heim", fixture.points.home)}${stat("Punkte Auswärts", fixture.points.away)}${stat("Netto gesamt", `${fixture.totals.homeNet}:${fixture.totals.awayNet}`)}</div>` : ""}
  `;
  $("#fixturePicker", wrap).value = fixture.id;
  return wrap;
}

function renderTable() {
  const rows = standings();
  const provisionalRows = standings(true);
  const hasSubmitted = state.fixtures.some((fixture) => fixture.status === "submitted" && !fixture.confirmed);
  const wrap = el("div");
  wrap.innerHTML = `
    <div class="panel">
      <h2>Offizielle Tabelle</h2>
      ${standingsTableHtml(rows)}
    </div>
    ${hasSubmitted ? `<div class="section panel"><h2>Vorläufige Tabelle</h2><p class="mini">Vorläufig - noch nicht vom Ligaleiter bestätigt.</p>${standingsTableHtml(provisionalRows)}</div>` : ""}
  `;
  return wrap;
}

function standingsTableHtml(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Platz</th><th>Team</th><th>Spieltage</th><th>Punkte</th><th>Spiele +</th><th>Spiele -</th><th>Gesamtpins</th><th>Differenz</th></tr></thead>
        <tbody>${rows.map((row, index) => `<tr><td>${index + 1}</td><td><strong>${row.team.name}</strong></td><td>${row.played}</td><td>${row.points}</td><td>${row.gamesWon}</td><td>${row.gamesLost}</td><td>${row.pins}</td><td>${row.pins - row.against}</td></tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderLeaders() {
  const wrap = el("div", "grid cols-2");
  wrap.innerHTML = leaderBlock("Frauen", leadersByGender("female")) + leaderBlock("Männer", leadersByGender("male"));
  return wrap;
}

function renderCashierDashboard() {
  rebuildFines();
  const open = state.fines.filter((fine) => !fine.paid);
  const byPlayer = state.players
    .map((player) => {
      const fines = open.filter((fine) => fine.playerId === player.id);
      return { player, team: teamById(player.teamId), fines, total: fines.reduce((sum, fine) => sum + fine.total, 0) };
    })
    .filter((row) => row.fines.length)
    .sort((a, b) => b.total - a.total || a.player.name.localeCompare(b.player.name));
  const wrap = el("div");
  wrap.innerHTML = `
    <div class="grid cols-3">
      ${stat("Spieler mit offenen Strafen", byPlayer.length)}
      ${stat("Offene Einzelstrafen", open.length)}
      ${stat("Gesamtsumme offen", `${open.reduce((sum, fine) => sum + fine.total, 0).toFixed(2)} €`)}
    </div>
    <div class="section panel">
      <h2>Kasse</h2>
      <p class="mini">Strafen entstehen automatisch pro Spieler, wenn ein Einzelspiel unter ${state.league.fineLimit} Pins liegt.</p>
      <div class="section fine-list">
        ${byPlayer.length ? byPlayer.map(cashierPlayerHtml).join("") : emptyHtml("Keine offenen Strafgelder", "Aktuell ist die Kasse ausgeglichen.")}
      </div>
    </div>
  `;
  return wrap;
}

function renderFines() {
  rebuildFines();
  const wrap = el("div", "panel");
  const open = state.fines.filter((fine) => !fine.paid);
  wrap.innerHTML = `
    <h2>Strafen</h2>
    <p class="mini">Wenn ein Spieler in einem Einzelspiel unter ${state.league.fineLimit} Pins bleibt, entstehen ${state.league.fineAmount.toFixed(2)} € Strafe.</p>
    <div class="section fine-list">
      ${state.fines.length ? state.fines.map(fineHtml).join("") : emptyHtml("Keine Strafen", "Aktuell sind keine Strafen gespeichert.")}
    </div>
    <div class="section grid cols-3">
      ${stat("Offene Strafen", open.length)}
      ${stat("Offener Betrag", `${open.reduce((sum, fine) => sum + fine.total, 0).toFixed(2)} €`)}
      ${stat("Gesamt erfasst", `${state.fines.reduce((sum, fine) => sum + fine.total, 0).toFixed(2)} €`)}
    </div>
  `;
  return wrap;
}

function renderNews() {
  const wrap = el("div");
  wrap.innerHTML = `
    <div class="panel">
      <h2>News veröffentlichen</h2>
      <form id="newsForm" class="grid">
        ${field("Titel", "newsTitle", "")}
        <div><label for="newsBody">Nachricht</label><textarea id="newsBody" required></textarea></div>
        <div class="form-row">
          <div><label for="newsAudience">Empfänger</label><select id="newsAudience"><option value="league">Gesamte Liga</option><option value="team">Team</option><option value="player">Einzelner Spieler</option></select></div>
          <div><label for="newsTarget">Ziel</label><select id="newsTarget"><option value="">Alle</option>${state.teams.map((team) => `<option value="team:${team.id}">${team.name}</option>`).join("")}${state.players.map((player) => `<option value="player:${player.id}">${player.name}</option>`).join("")}</select></div>
        </div>
        <button class="primary-button" type="submit" ${canAdmin() ? "" : "disabled"}>News speichern</button>
      </form>
    </div>
    <div class="section news-list">${visibleNews().map(newsHtml).join("")}</div>
  `;
  return wrap;
}

function renderAdmin() {
  const disabled = canAdmin() ? "" : "disabled";
  const wrap = el("div", "grid");
  wrap.innerHTML = `
    <div class="panel">
      <h2>Team anlegen</h2>
      <form id="teamForm" class="form-row">
        ${field("Teamname", "teamName", "")}
        <button class="primary-button" type="submit" ${disabled}>Team hinzufügen</button>
      </form>
    </div>
    <div class="panel">
      <h2>Spieler anlegen</h2>
      <form id="playerForm" class="form-row">
        ${field("Name", "playerName", "")}
        ${field("Benutzername", "playerUsername", "")}
        ${field("E-Mail", "playerEmail", "", "email")}
        ${field("Startcode", "playerPassword", "", "text")}
        <div><label for="playerGender">Geschlecht</label><select id="playerGender"><option value="female">Frauen</option><option value="male">Männer</option></select></div>
        <div><label for="playerTeam">Team</label><select id="playerTeam">${state.teams.map((team) => `<option value="${team.id}">${team.name}</option>`).join("")}</select></div>
        <button class="primary-button" type="submit" ${disabled}>Spieler hinzufügen</button>
      </form>
    </div>
    <div class="panel">
      <h2>Spieler bearbeiten</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Team</th><th>Geschlecht</th><th>Zugang</th><th>Aktionen</th></tr></thead>
          <tbody>${state.players.map(playerAdminRowHtml).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <h2>Zugänge und Rollen</h2>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Benutzer</th><th>Login</th><th>Rolle</th><th>Erstlogin</th><th>Spieler</th><th>Aktion</th></tr></thead>
          <tbody>${state.users.map((user) => `<tr><td>${user.name}</td><td>${user.username}<br><span class="mini">${user.email}</span></td><td><select data-action="role-change" data-id="${user.id}" ${disabled}>${Object.entries(roleLabels).map(([role, label]) => `<option value="${role}" ${user.role === role ? "selected" : ""}>${label}</option>`).join("")}</select></td><td><span class="pill ${user.firstLoginCompleted ? "good" : "warn"}">${user.firstLoginCompleted ? "abgeschlossen" : "offen"}</span></td><td>${user.playerId ? playerById(user.playerId)?.name || "-" : "-"}</td><td><button class="button" data-action="reset-password" data-id="${user.id}" ${disabled}>Startcode zurücksetzen</button></td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <h2>Daten</h2>
      <div class="actions">
        <button class="ghost-button" data-action="export-json">JSON exportieren</button>
        <button class="danger-button" data-action="reset-demo" ${disabled}>Demo-Daten zurücksetzen</button>
      </div>
    </div>
  `;
  return wrap;
}

function stat(label, value) {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}

function field(label, id, value, type = "text", step = "1") {
  return `<div><label for="${id}">${label}</label><input id="${id}" type="${type}" step="${step}" value="${escapeHtml(String(value))}" required /></div>`;
}

function matchCardHtml(fixture) {
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  const score = window.HobbyligaResults.isSaved(fixture) ? `${fixture.points.home}:${fixture.points.away}` : "offen";
  return `
    <article class="match-card">
      <div class="match-title"><span class="pill">Bahn ${fixture.lane}</span><span class="pill ${window.HobbyligaResults.isConfirmed(fixture) ? "good" : fixture.status === "submitted" ? "warn" : ""}">${window.HobbyligaResults.isConfirmed(fixture) ? "Freigegeben" : fixtureStatusLabels[fixture.status] || "offen"}</span></div>
      <div class="scoreline"><strong>${home.name}</strong><span class="scorebox">${score}</span><strong>${away.name}</strong></div>
      <p class="mini">${formatDate(fixture.date)} · ${fixture.time || "-"} · ${fixture.venue || state.league.venue} · ${fixtureStatusLabels[window.HobbyligaResults.isConfirmed(fixture) ? "released" : fixture.status] || fixture.status}</p>
      <div class="form-row">
        <div><label>Datum</label><input type="date" value="${fixture.date || ""}" data-fixture-field="date" data-id="${fixture.id}" /></div>
        <div><label>Uhrzeit</label><input type="time" value="${fixture.time || ""}" data-fixture-field="time" data-id="${fixture.id}" /></div>
      </div>
      <div class="form-row">
        <div><label>Spielort</label><input value="${escapeHtml(fixture.venue || state.league.venue)}" data-fixture-field="venue" data-id="${fixture.id}" /></div>
        <div><label>Status</label><select data-fixture-field="status" data-id="${fixture.id}">${Object.entries(fixtureStatusLabels).filter(([status]) => status !== "played").map(([status, label]) => `<option value="${status}" ${fixture.status === status ? "selected" : ""}>${label}</option>`).join("")}</select></div>
      </div>
      <p class="mini">Netto: ${fixture.totals.homeNet || 0}:${fixture.totals.awayNet || 0} · Brutto: ${fixture.totals.homeGross || 0}:${fixture.totals.awayGross || 0}</p>
      <button class="button" data-action="save-fixture-meta" data-id="${fixture.id}">Spiel speichern</button>
      <button class="button" data-action="open-result" data-id="${fixture.id}">Ergebnis öffnen</button>
    </article>
  `;
}

function scheduleOverviewCardHtml(fixture) {
  const home = teamById(fixture.homeTeamId);
  const away = teamById(fixture.awayTeamId);
  const status = window.HobbyligaResults.isConfirmed(fixture) ? "released" : fixture.status || "planned";
  const result = window.HobbyligaResults.isSaved(fixture) ? `${fixture.points.home}:${fixture.points.away}` : "offen";
  return `
    <article class="match-card">
      <div class="match-title"><span class="pill">Bahn ${fixture.lane}</span><span class="pill ${status === "released" ? "good" : status === "postponed" || status === "submitted" ? "warn" : ""}">${fixtureStatusLabels[status] || status}</span></div>
      <div class="scoreline"><strong>${home.name}</strong><span class="scorebox">${result}</span><strong>${away.name}</strong></div>
      <p class="mini">${formatDate(fixture.date)} · ${fixture.time || "-"} · ${fixture.venue || state.league.venue}</p>
      <p class="mini">Netto: ${fixture.totals.homeNet || 0}:${fixture.totals.awayNet || 0} · Brutto: ${fixture.totals.homeGross || 0}:${fixture.totals.awayGross || 0}</p>
    </article>
  `;
}

function resultTeamHtml(fixture, teamId) {
  const team = teamById(teamId);
  const players = lineupForTeam(teamId);
  return `
    <div>
      <h3>${team.name}</h3>
      <div class="result-grid section">
        <span class="field-label">Spieler</span><span class="field-label">Spiel 1</span><span class="field-label">Spiel 2</span><span class="field-label">Spiel 3</span>
        ${players.map((player) => {
          const stats = playerStats(player.id, fixture.id);
          return `
            <span>${player.name}<br><span class="mini">${stats.valid ? `Schnitt ${stats.average.toFixed(1)} · HC ${stats.handicap}` : "Schnitt/HC noch nicht verfügbar"}</span></span>
            ${window.HobbyligaResults.getGames(fixture).map((game) => `<input name="${fixture.id}|${game.number}|${player.id}" inputmode="numeric" type="number" min="0" max="300" value="${window.HobbyligaResults.getScore(fixture, game.number, player.id)?.gross ?? ""}" required />`).join("")}
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function teamRosterHtml() {
  return `<div class="grid cols-2">${state.teams.map((team) => `
    <div class="match-card">
      <div class="match-title"><h3>${team.name}</h3><span class="pill">${playersForTeam(team.id).length} Spieler</span></div>
      ${playersForTeam(team.id).map((player) => {
        const stats = playerStats(player.id);
        return `<p>${player.name} <span class="pill">${player.gender === "female" ? "Frauen" : "Männer"}</span> <span class="pill ${stats.valid ? "good" : "warn"}">${stats.valid ? `Ø ${stats.average.toFixed(1)} · HC ${stats.handicap}` : "noch nicht verfügbar"}</span></p>`;
      }).join("")}
    </div>`).join("")}</div>`;
}

function playerAdminRowHtml(player) {
  const user = state.users.find((item) => item.playerId === player.id);
  return `
    <tr>
      <td><input value="${escapeHtml(player.name)}" data-player-field="name" data-id="${player.id}" /></td>
      <td><select data-player-field="teamId" data-id="${player.id}">${state.teams.map((team) => `<option value="${team.id}" ${player.teamId === team.id ? "selected" : ""}>${team.name}</option>`).join("")}</select></td>
      <td><select data-player-field="gender" data-id="${player.id}"><option value="female" ${player.gender === "female" ? "selected" : ""}>Frauen</option><option value="male" ${player.gender === "male" ? "selected" : ""}>Männer</option></select></td>
      <td>${user ? `${user.username}<br><span class="mini">${user.email}</span>` : "Kein Zugang"}</td>
      <td class="actions"><button class="button" data-action="save-player" data-id="${player.id}">Speichern</button><button class="danger-button" data-action="delete-player" data-id="${player.id}">Löschen</button></td>
    </tr>
  `;
}

function leaderBlock(title, leaders) {
  return `
    <div class="panel">
      <h2>${title}</h2>
      <h3>Bester Schnitt</h3>
      <div class="table-wrap section">
        <table><thead><tr><th>Platz</th><th>Spieler</th><th>Team</th><th>Spiele</th><th>Schnitt</th></tr></thead><tbody>
          ${leaders.average.length ? leaders.average.map((row, index) => `<tr><td>${index + 1}</td><td>${row.player.name}</td><td>${row.team.name}</td><td>${row.stats.games}</td><td>${row.stats.average.toFixed(1)}</td></tr>`).join("") : `<tr><td colspan="5">Noch keine Spieler mit mindestens 3 Spielen.</td></tr>`}
        </tbody></table>
      </div>
      <h3 class="section">Höchstes Einzelspiel</h3>
      <div class="table-wrap section">
        <table><thead><tr><th>Platz</th><th>Spieler</th><th>Team</th><th>Pins</th></tr></thead><tbody>
          ${leaders.highs.length ? leaders.highs.map((row, index) => `<tr><td>${index + 1}</td><td>${row.player.name}</td><td>${row.team.name}</td><td>${row.high}</td></tr>`).join("") : `<tr><td colspan="4">Noch keine Ergebnisse gespeichert.</td></tr>`}
        </tbody></table>
      </div>
    </div>
  `;
}

function cashierPlayerHtml(row) {
  return `
    <div class="fine-item">
      <div class="match-title">
        <div><strong>${row.player.name}</strong><p class="mini">${row.team?.name || "Ohne Team"} · ${row.fines.length} offene Strafe(n)</p></div>
        <span class="scorebox">${row.total.toFixed(2)} €</span>
      </div>
      <div class="section fine-list">
        ${row.fines.map(fineHtml).join("")}
      </div>
      <button class="primary-button" data-action="pay-player-fines" data-id="${row.player.id}">Alle offenen Strafen bezahlen</button>
    </div>
  `;
}

function fineHtml(fine) {
  const fixture = window.HobbyligaSchedule.findById(state, fine.fixtureId);
  const player = playerById(fine.playerId);
  const team = teamById(fine.teamId);
  return `
    <div class="fine-item">
      <div class="match-title"><strong>${player?.name || "Spieler"} · ${team?.name || "-"}</strong><span class="pill ${fine.paid ? "good" : "bad"}">${fine.paid ? "bezahlt" : "offen"}</span></div>
      <p class="mini">Spieltag ${fine.day}, Spiel ${fine.gameNumber}, ${fixture ? `${teamById(fixture.homeTeamId).name} vs. ${teamById(fixture.awayTeamId).name}` : ""} · ${fine.gross} Pins unter Grenze ${fine.limit} · ${fine.total.toFixed(2)} €</p>
      ${canManageFines() ? `<button class="button" data-action="toggle-fine" data-id="${fine.id}">${fine.paid ? "Als offen markieren" : "Als bezahlt markieren"}</button>` : ""}
    </div>
  `;
}

function newsHtml(item) {
  return `<article class="news-item"><time>${item.date}</time><h3>${item.title}</h3><p class="mini">${item.body}</p></article>`;
}

function addSystemNews(title, body, audience = "league", targetId = "") {
  state.news.unshift({ id: uid("news"), title, body, audience, targetId, date: new Date().toISOString().slice(0, 10) });
}

function visibleNews() {
  const user = activeUser();
  const player = currentPlayer();
  return state.news
    .filter((item) => item.title !== "Handicap-Regel aktiv")
    .filter((item) => {
      if (canAdmin()) return true;
      if (!item.audience || item.audience === "league") return true;
      if (item.audience === "team") return player && item.targetId === player.teamId;
      if (item.audience === "player") return player && item.targetId === player.id;
      return false;
    })
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}

function emptyHtml(title, text) {
  return `<div class="empty-state"><strong>${title}</strong><span>${text}</span></div>`;
}

function el(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function toast(message) {
  $(".toast")?.remove();
  const node = el("div", "toast");
  node.textContent = message;
  document.body.append(node);
  setTimeout(() => node.remove(), 1800);
}

async function handlePasswordLogin(password) {
  const hash = await hashSecret(password);
  const tempMatches = state.users.filter((user) => user.tempPasswordHash === hash);
  if (tempMatches.length === 1) {
    pendingFirstLoginUserId = tempMatches[0].id;
    renderFirstLogin(tempMatches[0]);
    return;
  }
  const matches = state.users.filter((user) => user.passwordHash === hash && user.firstLoginCompleted);
  if (matches.length !== 1) {
    return toast("Login fehlgeschlagen");
  }
  completeLogin(matches[0]);
}

async function handleFirstLoginPassword() {
  const user = state.users.find((item) => item.id === pendingFirstLoginUserId);
  if (!user) return renderLogin();
  const password = $("#newPassword").value;
  const repeat = $("#newPasswordRepeat").value;
  if (password !== repeat) return toast("Passwörter stimmen nicht überein");
  user.passwordHash = await hashSecret(password);
  user.tempPasswordHash = null;
  user.firstLoginCompleted = true;
  pendingFirstLoginUserId = null;
  window.HobbyligaState.persist();
  completeLogin(user);
}

function completeLogin(user) {
  sessionStorage.setItem(AUTH_SESSION_KEY, user.id);
  state.activeUserId = user.id;
  window.HobbyligaState.persist();
  currentView = defaultViewForRole(user.role);
  render();
}

async function enableBiometricLogin() {
  const user = activeUser();
  if (!user || !biometricAvailable()) return toast("Face-ID nicht verfügbar");
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: "LA Bowling Hobbyliga" },
        user: {
          id: new TextEncoder().encode(user.id),
          name: user.name,
          displayName: user.name,
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { userVerification: "preferred" },
        timeout: 60000,
      },
    });
    window.HobbyligaStorage.setJson(BIOMETRIC_KEY, { userId: user.id, credentialId: bufferToBase64(credential.rawId) });
    toast("Face-ID aktiviert");
    render();
  } catch {
    toast("Face-ID konnte nicht aktiviert werden");
  }
}

async function loginWithBiometric() {
  const stored = window.HobbyligaStorage.getJson(BIOMETRIC_KEY, null);
  if (!stored || !biometricAvailable()) return toast("Face-ID nicht verfügbar");
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ type: "public-key", id: base64ToBuffer(stored.credentialId) }],
        userVerification: "preferred",
        timeout: 60000,
      },
    });
    const user = state.users.find((item) => item.id === stored.userId && item.firstLoginCompleted);
    if (!user) return toast("Face-ID Zugang ungültig");
    completeLogin(user);
  } catch {
    toast("Face-ID abgebrochen");
  }
}

document.addEventListener("click", (event) => {
  const navButton = event.target.closest("[data-view]");
  if (navButton) {
    const isPlayerFixtureView = navButton.dataset.view === "playerFixtureDay" && activeUser()?.role === "player";
    if (!isPlayerFixtureView && !allowedNavItems().some(([id]) => id === navButton.dataset.view)) return;
    currentView = navButton.dataset.view;
    document.body.classList.remove("nav-open");
    render();
    return;
  }

  const action = event.target.closest("[data-action]");
  if (!action) return;
  const id = action.dataset.id;
  if (action.dataset.action === "enable-biometric") {
    enableBiometricLogin();
  }
  if (action.dataset.action === "biometric-login") {
    loginWithBiometric();
  }
  if (action.dataset.action === "dashboard-panel") {
    sessionStorage.setItem("playerDashboardPanel", action.dataset.panel || "");
    currentView = "playerDashboard";
    render();
  }
  if (action.dataset.action === "open-fixture-day") {
    if (id) sessionStorage.setItem("playerFixtureDayId", id);
    sessionStorage.removeItem("playerDashboardPanel");
    currentView = "playerFixtureDay";
    render();
  }
  if (action.dataset.action === "back-player-dashboard") {
    currentView = "playerDashboard";
    render();
  }
  if (action.dataset.action === "start-result") {
    const fixture = window.HobbyligaSchedule.findById(state, id);
    if (!fixture || !canEnterFixture(fixture)) return toast("Spieltag noch nicht freigegeben");
    sessionStorage.setItem("playerSubmitFixtureId", id);
    currentView = "playerSubmitResults";
    render();
  }
  if (action.dataset.action === "request-fixture-activation") {
    const player = currentPlayer();
    const fixture = window.HobbyligaSchedule.findById(state, id);
    if (!player || !fixture || ![fixture.homeTeamId, fixture.awayTeamId].includes(player.teamId)) return toast("Aktivierung nicht möglich");
    const targetTeamId = fixture.homeTeamId === player.teamId ? fixture.awayTeamId : fixture.homeTeamId;
    fixture.activationRequests ||= [];
    const existing = fixture.activationRequests.find((request) => request.status === "pending" && request.type === "activate" && request.requesterTeamId === player.teamId);
    if (!existing) {
      fixture.activationRequests.push({
        id: uid("req"),
        requesterTeamId: player.teamId,
        targetTeamId,
        type: "activate",
        proposedDate: fixture.date,
        proposedTime: fixture.time,
        status: "pending",
        createdAt: new Date().toISOString(),
        createdBy: activeUser().id,
      });
      addSystemNews("Spieltag aktivieren", `${teamById(player.teamId).name} möchte Spieltag ${fixture.day} aktivieren.`, "team", targetTeamId);
    }
    sessionStorage.setItem("playerFixtureDayId", fixture.id);
    currentView = "playerFixtureDay";
    saveState("Warten auf Bestätigung des Gegners");
  }
  if (action.dataset.action === "approve-fixture-request") {
    const player = currentPlayer();
    const fixture = window.HobbyligaSchedule.findById(state, id);
    const request = fixture?.activationRequests?.find((item) => item.id === action.dataset.requestId);
    if (!player || !fixture || !request || request.targetTeamId !== player.teamId) return toast("Freigabe nicht möglich");
    request.status = "approved";
    request.approvedBy = player.teamId;
    request.approvedAt = new Date().toISOString();
    if (request.type === "activate") {
      fixture.activation = { approved: true, requestId: request.id, type: request.type, proposedDate: request.proposedDate || fixture.date, proposedTime: request.proposedTime || fixture.time };
    }
    if (request.proposedDate) fixture.date = request.proposedDate;
    if (request.proposedTime) fixture.time = request.proposedTime;
    fixture.status = request.type === "reschedule" ? "postponed" : "planned";
    addSystemNews("Spieltag freigegeben", `Spieltag ${fixture.day}: ${teamById(fixture.homeTeamId).name} vs. ${teamById(fixture.awayTeamId).name} wurde für die Ergebniserfassung freigegeben.`, "team", request.requesterTeamId);
    saveState("Spieltag freigegeben");
  }
  if (action.dataset.action === "calculate-blind") {
    const player = currentPlayer();
    const fixture = window.HobbyligaSchedule.findById(state, id);
    const teamId = action.dataset.teamId;
    if (!player || !fixture || player.teamId !== teamId) return toast("Blindspieler nicht möglich");
    fixture.blindPlayers ||= {};
    fixture.blindPlayers[teamId] = calculateBlindPlayer(fixture, teamId);
    calculateFixture(fixture, window.HobbyligaRules.createSnapshot(state));
    window.HobbyligaState.persist();
    toast("Blindspieler berechnet und für den Bowlingcomputer vormerken");
    render();
  }
  if (action.dataset.action === "logout") {
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    state.activeUserId = null;
    window.HobbyligaState.persist();
    currentView = "playerDashboard";
    render();
  }
  if (action.dataset.action === "open-result") {
    if (!canAdmin()) return toast("Nur Admins dürfen Ergebnisse öffnen");
    sessionStorage.setItem("selectedFixtureId", id);
    currentView = "results";
    render();
  }
  if (action.dataset.action === "save-fixture-meta") {
    if (!canAdmin()) return;
    const fixture = window.HobbyligaSchedule.findById(state, id);
    if (!fixture) return;
    fixture.date = $(`[data-fixture-field="date"][data-id="${id}"]`).value;
    fixture.time = $(`[data-fixture-field="time"][data-id="${id}"]`).value;
    fixture.venue = $(`[data-fixture-field="venue"][data-id="${id}"]`).value.trim();
    fixture.status = $(`[data-fixture-field="status"][data-id="${id}"]`).value;
    saveState("Spiel aktualisiert");
  }
  if (action.dataset.action === "clear-fixture") {
    if (!canAdmin()) return toast("Nur Admins dürfen Ergebnisse löschen");
    const fixture = window.HobbyligaSchedule.findById(state, id);
    fixture.saved = false;
    fixture.confirmed = false;
    fixture.rulesSnapshot = null;
    fixture.games = Array.from({ length: state.league.gamesPerMatch }, (_, index) => ({ number: index + 1, scores: {} }));
    calculateFixture(fixture);
    rebuildFines();
    saveState("Ergebnis geleert");
  }
  if (action.dataset.action === "toggle-confirm") {
    if (!canAdmin()) return;
    const fixture = window.HobbyligaSchedule.findById(state, id);
    if (!fixture || !window.HobbyligaResults.isSaved(fixture)) return;
    fixture.confirmed = !fixture.confirmed;
    if (fixture.confirmed) {
      window.HobbyligaRules.setRulesSnapshot(fixture, window.HobbyligaRules.createSnapshot(state));
    } else {
      fixture.rulesSnapshot = null;
    }
    fixture.status = fixture.confirmed ? "released" : "submitted";
    calculateFixture(fixture, rulesForFixture(fixture));
    rebuildFines();
    if (fixture.confirmed) addSystemNews("Ergebnis freigegeben", `Spieltag ${fixture.day}: ${teamById(fixture.homeTeamId).name} vs. ${teamById(fixture.awayTeamId).name} wurde freigegeben.`, "league");
    saveState(fixture.confirmed ? "Ergebnis bestätigt" : "Ergebnis vorläufig");
  }
  if (action.dataset.action === "reject-result") {
    if (!canAdmin()) return;
    const fixture = window.HobbyligaSchedule.findById(state, id);
    if (!fixture) return;
    fixture.confirmed = false;
    fixture.saved = false;
    fixture.status = "rejected";
    fixture.teamSubmissions = {};
    addSystemNews("Ergebnis abgelehnt", `Spieltag ${fixture.day}: ${teamById(fixture.homeTeamId).name} vs. ${teamById(fixture.awayTeamId).name} wurde zur Korrektur abgelehnt.`, "league");
    rebuildFines();
    saveState("Ergebnis abgelehnt");
  }
  if (action.dataset.action === "regen-schedule") {
    if (!canAdmin()) return toast("Nur Ligaleiter dürfen den Spielplan ändern");
    state.fixtures = generateSchedule(state.teams, state.league.gamesPerMatch);
    state.fines = [];
    saveState("Spielplan neu erstellt");
  }
  if (action.dataset.action === "toggle-fine") {
    const fine = state.fines.find((item) => item.id === id);
    if (fine && canManageFines()) {
      fine.paid = !fine.paid;
      fine.paidAt = fine.paid ? new Date().toISOString() : null;
      saveState("Strafe aktualisiert");
    }
  }
  if (action.dataset.action === "pay-player-fines") {
    if (!canManageFines()) return;
    rebuildFines();
    state.fines.filter((fine) => fine.playerId === id && !fine.paid).forEach((fine) => {
      fine.paid = true;
      fine.paidAt = new Date().toISOString();
    });
    saveState("Spieler-Strafen bezahlt");
  }
  if (action.dataset.action === "export-json") {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "la-bowling-hobbyliga-backup.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  if (action.dataset.action === "reset-demo") {
    if (!canAdmin()) return;
    state = window.HobbyligaState.replace(createSeedState());
    sessionStorage.removeItem(AUTH_SESSION_KEY);
    saveState("Demo-Daten zurückgesetzt");
  }
  if (action.dataset.action === "reset-password") {
    if (!canAdmin()) return;
    const user = state.users.find((item) => item.id === id);
    if (!user) return;
    const startCode = user.role === "admin" ? "admin123" : user.role === "cashier" ? "kasse123" : `${slugify(user.name).split(".")[0] || "start"}2026`;
    hashSecret(startCode).then((hash) => {
      user.tempPasswordHash = hash;
      user.passwordHash = null;
      user.firstLoginCompleted = false;
      window.HobbyligaState.persist();
      toast(`Startcode gesetzt: ${startCode}`);
      render();
    });
  }
  if (action.dataset.action === "save-player") {
    if (!canAdmin()) return;
    const player = playerById(id);
    if (!player) return;
    player.name = $(`[data-player-field="name"][data-id="${id}"]`).value.trim();
    player.teamId = $(`[data-player-field="teamId"][data-id="${id}"]`).value;
    player.gender = $(`[data-player-field="gender"][data-id="${id}"]`).value;
    const user = state.users.find((item) => item.playerId === id);
    if (user) user.name = player.name;
    saveState("Spieler gespeichert");
  }
  if (action.dataset.action === "delete-player") {
    if (!canAdmin()) return;
    state.players = state.players.filter((player) => player.id !== id);
    state.users = state.users.filter((user) => user.playerId !== id);
    state.fixtures.forEach((fixture) => fixture.games.forEach((game) => delete game.scores[id]));
    state.fixtures.forEach((fixture) => fixture.saved && calculateFixture(fixture));
    rebuildFines();
    saveState("Spieler gelöscht");
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "userSelect") {
    state.activeUserId = event.target.value;
    saveState("Benutzer gewechselt");
  }
  if (event.target.id === "fixturePicker") {
    sessionStorage.setItem("selectedFixtureId", event.target.value);
    render();
  }
  if (event.target.id === "playerSubmitFixture") {
    sessionStorage.setItem("playerSubmitFixtureId", event.target.value);
    render();
  }
  if (event.target.dataset.action === "role-change") {
    if (!canAdmin()) return;
    const user = state.users.find((item) => item.id === event.target.dataset.id);
    if (user.id === activeUser().id && event.target.value !== "admin") {
      event.target.value = "admin";
      return toast("Der aktive Admin bleibt Admin");
    }
    user.role = event.target.value;
    saveState("Rolle geändert");
  }
});

document.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "loginForm") {
    handlePasswordLogin($("#loginPassword").value);
    return;
  }
  if (event.target.id === "firstLoginForm") {
    handleFirstLoginPassword();
    return;
  }
  if (event.target.id === "leagueForm") {
    if (!canAdmin()) return toast("Nur Ligaleiter dürfen Liga-Daten ändern");
    const fineAmount = Number($("#fineAmount").value);
    window.HobbyligaLeague.update(state, {
      name: $("#leagueName").value.trim(),
      season: $("#leagueSeason").value.trim(),
      venue: $("#leagueVenue").value.trim(),
      handicapBase: Number($("#handicapBase").value),
      handicapFactor: Number($("#handicapFactor").value),
      handicapMin: Number($("#handicapMin").value),
      handicapMax: Number($("#handicapMax").value),
      fineLimit: Number($("#fineLimit").value),
      fineAmount,
      finePerPlayer: fineAmount,
      gamesPerMatch: Number($("#gamesPerMatch").value),
      playersPerTeam: Number($("#playersPerTeam").value),
      pointsPerGameWin: Number($("#pointsPerGameWin").value),
      pointsPerGameTie: Number($("#pointsPerGameTie").value),
      pointsTotalWin: Number($("#pointsTotalWin").value),
      pointsTotalTie: Number($("#pointsTotalTie").value),
      tableSort: $("#tableSort").value,
      handicapEnabled: $("#handicapEnabled").checked,
      autoConfirmResults: $("#autoConfirmResults").checked,
      provisionalResults: $("#provisionalResults").checked,
    });
    state.fixtures.forEach((fixture) => fixture.saved && !fixture.confirmed && calculateFixture(fixture, window.HobbyligaRules.createSnapshot(state)));
    rebuildFines();
    saveState("Liga gespeichert");
  }
  if (event.target.id === "resultForm") {
    if (!canAdmin()) return toast("Nur Admins dürfen Ergebnisse speichern");
    const fixtureId = $("#fixturePicker")?.value || sessionStorage.getItem("selectedFixtureId");
    sessionStorage.setItem("selectedFixtureId", fixtureId);
    const fixture = window.HobbyligaSchedule.findById(state, fixtureId);
    const form = new FormData(event.target);
    for (const [key, value] of form.entries()) {
      const parsed = scoreValue(value);
      if (parsed === null) return toast("Bitte nur Pins von 0 bis 300 eintragen");
      const [, gameNumber, playerId] = key.split("|");
      window.HobbyligaResults.setScore(fixture, gameNumber, playerId, { gross: parsed, handicap: 0, net: parsed });
    }
    fixture.saved = true;
    fixture.confirmed = window.HobbyligaRules.isAutoConfirmEnabled(state);
    fixture.status = fixture.confirmed ? "released" : "submitted";
    window.HobbyligaRules.setRulesSnapshot(fixture, window.HobbyligaRules.createSnapshot(state));
    calculateFixture(fixture, window.HobbyligaRules.getRulesSnapshot(fixture));
    rebuildFines();
    saveState("Ergebnis gespeichert");
  }
  if (event.target.dataset.form === "fixture-request") {
    const player = currentPlayer();
    const fixture = window.HobbyligaSchedule.findById(state, event.target.dataset.id);
    if (!player || !fixture || ![fixture.homeTeamId, fixture.awayTeamId].includes(player.teamId)) return toast("Anfrage nicht möglich");
    const form = new FormData(event.target);
    const targetTeamId = fixture.homeTeamId === player.teamId ? fixture.awayTeamId : fixture.homeTeamId;
    const type = form.get("type");
    const proposedDate = form.get("proposedDate");
    const proposedTime = form.get("proposedTime");
    fixture.activationRequests ||= [];
    fixture.activationRequests.push({
      id: uid("req"),
      requesterTeamId: player.teamId,
      targetTeamId,
      type,
      proposedDate,
      proposedTime,
      status: "pending",
      createdAt: new Date().toISOString(),
      createdBy: activeUser().id,
    });
    addSystemNews("Spieltag-Anfrage", `${teamById(player.teamId).name} bittet ${teamById(targetTeamId).name} um ${requestLabel(type).toLowerCase()} für Spieltag ${fixture.day}.`, "team", targetTeamId);
    sessionStorage.setItem("playerFixtureDayId", fixture.id);
    sessionStorage.removeItem("playerDashboardPanel");
    currentView = "playerFixtureDay";
    saveState("Anfrage an Gegner gesendet");
  }
  if (event.target.id === "playerResultForm") {
    const player = currentPlayer();
    if (!player) return toast("Kein Spielerprofil verknüpft");
    const fixtureId = sessionStorage.getItem("playerSubmitFixtureId");
    const fixture = window.HobbyligaSchedule.findById(state, fixtureId);
    if (!fixture || (fixture.homeTeamId !== player.teamId && fixture.awayTeamId !== player.teamId)) return toast("Spieltag nicht gefunden");
    if (!canEnterFixture(fixture)) return toast("Spieltag noch nicht freigegeben");
    const form = new FormData(event.target);
    for (const [key, value] of form.entries()) {
      const parsed = scoreValue(value);
      if (parsed === null) return toast("Bitte nur Pins von 0 bis 300 eintragen");
      const [, gameNumber, playerId] = key.split("|");
      const teamPlayer = playerById(playerId);
      if (!teamPlayer || teamPlayer.teamId !== player.teamId) return toast("Nur dein Team darf eingereicht werden");
      window.HobbyligaResults.setScore(fixture, gameNumber, playerId, { gross: parsed, handicap: 0, net: parsed });
    }
    fixture.saved = true;
    fixture.confirmed = false;
    fixture.status = "submitted";
    fixture.teamSubmissions ||= {};
    fixture.teamSubmissions[player.teamId] = { submittedBy: activeUser().id, submittedAt: new Date().toISOString() };
    fixture.submittedBy = activeUser().id;
    fixture.submittedAt = new Date().toISOString();
    window.HobbyligaRules.setRulesSnapshot(fixture, window.HobbyligaRules.createSnapshot(state));
    calculateFixture(fixture, window.HobbyligaRules.getRulesSnapshot(fixture));
    addSystemNews("Neue Ergebnisse eingereicht", `${teamById(player.teamId).name} hat Ergebnisse für Spieltag ${fixture.day} eingereicht.`, "league");
    window.HobbyligaState.persist();
    const bothSubmitted = fixture.teamSubmissions[fixture.homeTeamId] && fixture.teamSubmissions[fixture.awayTeamId];
    if (bothSubmitted) {
      const ownPoints = fixture.homeTeamId === player.teamId ? fixture.points.home : fixture.points.away;
      const oppPoints = fixture.homeTeamId === player.teamId ? fixture.points.away : fixture.points.home;
      toast(ownPoints >= oppPoints ? `Glückwunsch! Vorläufiges Ergebnis: ${ownPoints}:${oppPoints}` : `Kopf hoch! Vorläufiges Ergebnis: ${ownPoints}:${oppPoints}`);
    } else {
      toast("Deine Ergebnisse warten auf die Freigabe des Ligaleiters");
    }
    render();
  }
  if (event.target.id === "newsForm") {
    if (!canAdmin()) return toast("Nur Ligaleiter dürfen News veröffentlichen");
    const audience = $("#newsAudience").value;
    const targetRaw = $("#newsTarget").value;
    const targetId = targetRaw.includes(":") ? targetRaw.split(":")[1] : "";
    state.news.unshift({ id: uid("news"), title: $("#newsTitle").value.trim(), body: $("#newsBody").value.trim(), audience, targetId, date: new Date().toISOString().slice(0, 10) });
    saveState("News veröffentlicht");
  }
  if (event.target.id === "teamForm") {
    if (!canAdmin()) return;
    state.teams.push({ id: uid("team"), name: $("#teamName").value.trim(), color: "#f7c948" });
    state.fixtures = generateSchedule(state.teams, state.league.gamesPerMatch);
    state.fines = [];
    saveState("Team hinzugefügt, Spielplan neu erstellt");
  }
  if (event.target.id === "playerForm") {
    if (!canAdmin()) return;
    const name = $("#playerName").value.trim();
    const username = ($("#playerUsername").value.trim() || slugify(name)).toLowerCase();
    const email = $("#playerEmail").value.trim() || `${username}@la-bowling.local`;
    const startCode = $("#playerPassword").value.trim() || `${username.split(".")[0] || "start"}2026`;
    if (state.users.some((user) => user.username === username || user.email === email)) return toast("Login existiert bereits");
    const player = { id: uid("pl"), name, gender: $("#playerGender").value, teamId: $("#playerTeam").value, active: true };
    hashSecret(startCode).then((hash) => {
      state.players.push(player);
      state.users.push({ id: uid("user"), name, username, email, tempPasswordHash: hash, passwordHash: null, firstLoginCompleted: false, role: "player", playerId: player.id });
      saveState(`Spieler hinzugefügt · Startcode: ${startCode}`);
    });
  }
});

$("#menuToggle").addEventListener("click", () => document.body.classList.toggle("nav-open"));
$("#saveSnapshot").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `la-bowling-hobbyliga-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

async function initApp() {
  await migrateCredentialStorage();
  render();
}

initApp();
