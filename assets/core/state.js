(function () {
  let currentState = null;
  let currentStorageKey = null;
  let initialized = false;

  function assertInitialized() {
    if (!initialized) {
      throw new Error("HobbyligaState wurde noch nicht initialisiert.");
    }
  }

  function assertStateObject(nextState) {
    if (!nextState || typeof nextState !== "object" || Array.isArray(nextState)) {
      throw new TypeError("HobbyligaState erwartet ein Zustandsobjekt.");
    }
  }

  function initialize(options) {
    const { storageKey, normalize, createInitialState } = options || {};
    if (typeof storageKey !== "string" || !storageKey.trim()) {
      throw new TypeError("HobbyligaState.initialize erwartet einen nicht leeren storageKey.");
    }
    if (typeof normalize !== "function") {
      throw new TypeError("HobbyligaState.initialize erwartet normalize als Funktion.");
    }
    if (typeof createInitialState !== "function") {
      throw new TypeError("HobbyligaState.initialize erwartet createInitialState als Funktion.");
    }

    currentStorageKey = storageKey;
    const storedState = window.HobbyligaStorage.getJson(storageKey, null);
    if (storedState) {
      currentState = normalize(storedState);
      window.HobbyligaStorage.setJson(storageKey, currentState);
    } else {
      currentState = createInitialState();
      window.HobbyligaStorage.setJson(storageKey, currentState);
    }
    initialized = true;
    return currentState;
  }

  function get() {
    assertInitialized();
    return currentState;
  }

  function replace(nextState) {
    assertStateObject(nextState);
    currentState = nextState;
    return currentState;
  }

  function persist() {
    assertInitialized();
    return window.HobbyligaStorage.setJson(currentStorageKey, currentState);
  }

  function update(mutator) {
    assertInitialized();
    if (typeof mutator !== "function") {
      throw new TypeError("HobbyligaState.update erwartet mutator als Funktion.");
    }
    const nextState = mutator(currentState);
    if (nextState !== undefined) {
      assertStateObject(nextState);
      currentState = nextState;
    }
    persist();
    return currentState;
  }

  window.HobbyligaState = {
    initialize,
    get,
    replace,
    persist,
    update,
  };
})();
