// Mana icon helper
  function getManaImgHtml(token, size = 22) {
    const cleanToken = String(token || "").trim();
    return `
      <img
        src="/static/icons/mana/mana-${cleanToken}.png"
        alt="Mana ${cleanToken}"
        title="Mana ${cleanToken}"
        width="${size}"
        height="${size}"
        class="icon-img icon-mana"
        style="width:${size}px; height:${size}px;"
        onerror="this.style.opacity='0.35';"
      />
    `;
  }


// Shared color, deck, mana, and power display helpers
  function renderPips(colors, size = 22) {
    const list = colors && colors.length ? colors : ["C"];
    return list.map(c => getManaImgHtml(c, size)).join("");
  }

  const COLOR_COMBO_ORDER = [
    "C", "W", "U", "B", "R", "G",
    "WU", "UB", "BR", "RG", "WG", "WB", "UR", "BG", "WR", "UG",
    "WUB", "UBR", "BRG", "WRG", "WUG", "WBG", "WUR", "UBG", "WBR", "URG",
    "WUBR", "UBRG", "WBRG", "WURG", "WUBG", "WUBRG"
  ];

  function getDeckDisplayName(c) {
    return c.commander_2 ? `${c.commander_1} & ${c.commander_2}` : c.commander_1;
  }

  function getColorSortRank(colors) {
    const key = (!colors || !colors.length || (colors.length === 1 && colors[0] === "C"))
      ? "C"
      : (WUBRG_ORDER.filter(col => colors.includes(col)).join("") || "C");
    const idx = COLOR_COMBO_ORDER.indexOf(key);
    return idx === -1 ? 999 : idx;
  }

  function renderInactiveBadge() {
    return `
      <span class="inactive-badge" title="Deck is uit elkaar gehaald (non-actief)">
        <img src="/static/icons/inactive.png" alt="inactive" class="icon-inactive" onerror="this.style.display='none';" />
        inactive
      </span>
    `;
  }

  function toggleDeckHeaderSort() {
    const sortEl = document.getElementById("deckSortBy");
    sortEl.value = sortEl.value === "alpha_asc" ? "alpha_desc" : "alpha_asc";
    renderDecksTable();
  }

  // Parses strings like "{2}{G}{U}" or "2GU" into mana-<token>.png icons
  function renderManaCostSymbols(manaStr, size = 20) {
    if (!manaStr) return "";
    const braceMatches = manaStr.match(/\{([^}]+)\}/g);
    if (braceMatches && braceMatches.length) {
      return braceMatches
        .map(raw => raw.replace(/[{}]/g, "").trim())
        .filter(Boolean)
        .map(tok => getManaImgHtml(tok, size))
        .join("");
    }
    return manaStr
      .trim()
      .split("")
      .filter(ch => /[WUBRGC0-9]/i.test(ch))
      .map(ch => getManaImgHtml(/[WUBRGC]/i.test(ch) ? ch.toUpperCase() : ch, size))
      .join("");
  }

  // Losse powerlevel-icoontjes: /static/icons/power/powerlevel-1.png t/m powerlevel-5.png
  function getPowerImgHtml(level, size = 34) {
    const lvl = Math.min(5, Math.max(1, parseInt(level, 10) || 3));
    const cfg = POWER_LEVELS[lvl] || POWER_LEVELS[3];
    return `
      <img
        src="/static/icons/power/powerlevel-${lvl}.png"
        alt="${cfg.label} - ${cfg.desc}"
        title="${cfg.label} - ${cfg.desc}"
        width="${size}"
        height="${size}"
        class="icon-img icon-power"
        style="width:${size}px; height:${size}px;"
        onerror="this.style.opacity='0.35';"
      />
    `;
  }

  function renderPowerBadge(level) {
    const lvl = parseInt(level, 10) || 3;
    const cfg = POWER_LEVELS[lvl] || POWER_LEVELS[3];
    return `
      <div class="shield-cell" title="${cfg.label} - ${cfg.desc}">
        ${getPowerImgHtml(lvl, 34)}
        <span class="shield-lv-tag" style="color:${cfg.text};">${cfg.label}</span>
      </div>
    `;
  }


// Shared date, feedback, and tab navigation
  function setTodayDate() {
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("gameDate").value = today;
  }

  function showToast(msg, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = isError ? "toast error" : "toast";
    t.style.display = "block";
    setTimeout(() => { t.style.display = "none"; }, 2600);
  }

  function switchTab(tab) {
    document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
    document.querySelectorAll("nav.bottom-nav button").forEach(el => el.classList.remove("active"));

    document.getElementById(`tab-${tab}`).classList.add("active");
    const navBtn = document.getElementById(`nav-${tab}`);
    if (navBtn) navBtn.classList.add("active");

    if (tab === "stats") loadStats();
    if (tab === "decks") loadCommanders();
  }

