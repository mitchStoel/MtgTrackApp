// Initialize the page after all feature scripts are loaded
  (async function init() {
    setTodayDate();
    renderPowerSelector();
    await checkAuth();
    await loadWinConditions();
    await loadCommanders();
    await loadStats();
  })();
