// Shared state and feature configuration
  let commanders = [];
  let winConditions = [];
  let statsData = null;
  let pendingCommanderDeleteId = null;

  let playerDeckSearch = "";
  let playerDeckSortBy = "games_played";
  let playerDeckSortDir = "desc";

  let selectedScryfallCards = { 1: null, 2: null, 3: null };
  let scryfallTimers = { 1: null, 2: null, 3: null };
  let scryfallResultsCache = { 1: [], 2: [], 3: [] };
  let selectedAlternativeCards = [];

  const WUBRG_ORDER = ["W", "U", "B", "R", "G"];
  const PLAYER_WIN_CHART_COLORS = [
    "#02ABA1", "#6B27B4", "#3A42A7", "#F88802"
  ];

  let statsPodFilter = "all";

    const ALL_32_COMBINATIONS = [
      { key: "C", name: "Colorless", colors: ["C"] },
      { key: "W", name: "Mono White", colors: ["W"] },
      { key: "U", name: "Mono Blue", colors: ["U"] },
      { key: "B", name: "Mono Black", colors: ["B"] },
      { key: "R", name: "Mono Red", colors: ["R"] },
      { key: "G", name: "Mono Green", colors: ["G"] },
      { key: "WU", name: "Azorius", colors: ["W", "U"] },
      { key: "UB", name: "Dimir", colors: ["U", "B"] },
      { key: "BR", name: "Rakdos", colors: ["B", "R"] },
      { key: "RG", name: "Gruul", colors: ["R", "G"] },
      { key: "WG", name: "Selesnya", colors: ["W", "G"] },
      { key: "WB", name: "Orzhov", colors: ["W", "B"] },
      { key: "UR", name: "Izzet", colors: ["U", "R"] },
      { key: "BG", name: "Golgari", colors: ["B", "G"] },
      { key: "WR", name: "Boros", colors: ["W", "R"] },
      { key: "UG", name: "Simic", colors: ["U", "G"] },
      { key: "WUB", name: "Esper", colors: ["W", "U", "B"] },
      { key: "UBR", name: "Grixis", colors: ["U", "B", "R"] },
      { key: "BRG", name: "Jund", colors: ["B", "R", "G"] },
      { key: "WRG", name: "Naya", colors: ["W", "R", "G"] },
      { key: "WUG", name: "Bant", colors: ["W", "U", "G"] },
      { key: "WBG", name: "Abzan", colors: ["W", "B", "G"] },
      { key: "WUR", name: "Jeskai", colors: ["W", "U", "R"] },
      { key: "UBG", name: "Sultai", colors: ["U", "B", "G"] },
      { key: "WBR", name: "Mardu", colors: ["W", "B", "R"] },
      { key: "URG", name: "Temur", colors: ["U", "R", "G"] },
      { key: "WUBR", name: "Yore-Tiller", colors: ["W", "U", "B", "R"] },
      { key: "UBRG", name: "Glint-Eye", colors: ["U", "B", "R", "G"] },
      { key: "WBRG", name: "Dune-Brood", colors: ["W", "B", "R", "G"] },
      { key: "WURG", name: "Ink-Treader", colors: ["W", "U", "R", "G"] },
      { key: "WUBG", name: "Witch-Maw", colors: ["W", "U", "B", "G"] },
      { key: "WUBRG", name: "Five-Color", colors: ["W", "U", "B", "R", "G"] }
    ];

  const POWER_LEVELS = {
    1: { label: "LV. 1", desc: "Casual", text: "#cbd5e1" },
    2: { label: "LV. 2", desc: "Upgraded", text: "#5eead4" },
    3: { label: "LV. 3", desc: "Tuned", text: "#d8b4fe" },
    4: { label: "LV. 4", desc: "Optimized", text: "#fcd34d" },
    5: { label: "LV. 5", desc: "cEDH", text: "#fde047" }
  };

  // Losse mana-icoontjes: /static/icons/mana/mana-<token>.png (bijv. mana-W.png, mana-G.png, mana-1.png, mana-5.png)
