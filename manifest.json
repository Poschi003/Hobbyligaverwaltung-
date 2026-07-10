(function () {
  function get(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }

  function getJson(key, fallback = null) {
    const value = get(key, null);
    if (value === null) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  function setJson(key, value) {
    try {
      return set(key, JSON.stringify(value));
    } catch {
      return false;
    }
  }

  window.HobbyligaStorage = {
    get,
    set,
    remove,
    getJson,
    setJson,
  };
})();
