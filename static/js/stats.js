// Color-combination detail and Scryfall images
  const scryfallCardCache = new Map();

  function createScryfallCardTile(card, role) {
    const tile = document.createElement("article");
    tile.className = "color-combo-card";

    const heading = document.createElement("div");
    heading.className = "color-combo-card-heading";

    const nameLink = document.createElement("a");
    nameLink.className = "scryfall-card-link";
    nameLink.href = scryfallSearchUrl(card.name);
    nameLink.target = "_blank";
    nameLink.rel = "noopener noreferrer";
    nameLink.textContent = card.name;

    const roleLabel = document.createElement("span");
    roleLabel.className = "color-combo-card-role";
    roleLabel.textContent = role;
    heading.append(nameLink, roleLabel);

    const imageLink = document.createElement("a");
    imageLink.className = "color-combo-card-image-link";
    imageLink.href = scryfallSearchUrl(card.name);
    imageLink.target = "_blank";
    imageLink.rel = "noopener noreferrer";
    imageLink.hidden = true;

    const image = document.createElement("img");
    image.className = "color-combo-card-image";
    image.alt = `${card.name} card image`;
    image.loading = "lazy";
    imageLink.appendChild(image);

    const status = document.createElement("p");
    status.className = "color-combo-card-status";
    status.textContent = "Loading image from Scryfall...";
    image.addEventListener("error", () => {
      imageLink.hidden = true;
      status.hidden = false;
      status.textContent = `Scryfall image failed to load for ${card.name}.`;
    });

    tile.append(heading, imageLink, status);
    return { tile, image, imageLink, status };
  }

  async function loadScryfallCardImage(cardName, image, imageLink, status) {
    const cacheKey = cardName.toLowerCase();
    let request = scryfallCardCache.get(cacheKey);
    if (!request) {
      const fetchRequest = fetch(`https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`, {
        headers: { "Accept": "application/json" }
      }).then(async response => {
        const card = await response.json();
        if (!response.ok) {
          throw new Error(card.details || `Scryfall returned HTTP ${response.status}`);
        }
        return card;
      });
      request = fetchRequest.catch(error => {
        if (scryfallCardCache.get(cacheKey) === request) {
          scryfallCardCache.delete(cacheKey);
        }
        throw error;
      });
      scryfallCardCache.set(cacheKey, request);
    }

    try {
      const card = await request;
      const imageUris = card.image_uris || card.card_faces?.find(face => face.image_uris)?.image_uris;
      const imageUrl = imageUris?.normal || imageUris?.small;
      if (!imageUrl) {
        throw new Error("No card image was returned.");
      }

      imageLink.href = card.scryfall_uri || scryfallSearchUrl(cardName);
      image.src = imageUrl;
      imageLink.hidden = false;
      status.hidden = true;
    } catch (error) {
      status.hidden = false;
      status.textContent = `Scryfall image unavailable for ${cardName}: ${error.message}`;
    }
  }

  async function loadColorComboImages(cardTiles) {
    for (const cardTile of cardTiles) {
      await loadScryfallCardImage(
        cardTile.name,
        cardTile.image,
        cardTile.imageLink,
        cardTile.status
      );
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  function openColorCombinationPage(owner, colorKey) {
    const combo = ALL_32_COMBINATIONS.find(item => item.key === colorKey);
    if (!combo) return;

    const matchingDecks = commanders
      .filter(deck =>
        deck.owner === owner &&
        !deck.is_deleted &&
        getColorIdentityKey(deck.colors) === colorKey
      )
      .sort((a, b) => getDeckDisplayName(a).localeCompare(getDeckDisplayName(b)));

    const container = document.getElementById("playerProfileContent");
    container.replaceChildren();

    const page = document.createElement("section");
    page.className = "card color-combo-detail";

    const header = document.createElement("div");
    header.className = "color-combo-detail-header";

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "small secondary color-combo-back";
    backButton.textContent = "Back to player profile";
    backButton.addEventListener("click", renderPlayerProfile);

    const title = document.createElement("h2");
    title.textContent = `${combo.name} (${combo.key}) Commanders`;

    const subtitle = document.createElement("p");
    subtitle.textContent = `${owner} · ${matchingDecks.length} registered ${matchingDecks.length === 1 ? "deck" : "decks"}`;

    header.append(backButton, title, subtitle);
    page.appendChild(header);

    const cardTiles = [];
    if (!matchingDecks.length) {
      const empty = document.createElement("p");
      empty.className = "color-combo-empty";
      empty.textContent = "This player has no decks with this color identity.";
      page.appendChild(empty);
    }

    matchingDecks.forEach(deck => {
      const deckSection = document.createElement("section");
      deckSection.className = "color-combo-deck";

      const deckHeader = document.createElement("div");
      deckHeader.className = "color-combo-deck-header";

      const deckName = document.createElement("h3");
      deckName.textContent = getDeckDisplayName(deck);
      deckHeader.appendChild(deckName);

      if ((deck.is_active ?? 1) === 0) {
        const inactive = document.createElement("span");
        inactive.className = "inactive-badge";
        inactive.textContent = "Inactive";
        deckHeader.appendChild(inactive);
      }

      const cardsGrid = document.createElement("div");
      cardsGrid.className = "color-combo-cards";
      const deckCards = [
        { name: deck.commander_1, role: "Main commander" },
        ...(deck.commander_2 ? [{ name: deck.commander_2, role: "Partner / Background" }] : []),
        ...(deck.alternatives || []).map(alternative => ({
          name: alternative.name,
          role: "Alternative commander"
        }))
      ];

      deckCards.forEach(card => {
        const cardTile = createScryfallCardTile(card, card.role);
        cardsGrid.appendChild(cardTile.tile);
        cardTiles.push({ name: card.name, ...cardTile });
      });

      deckSection.append(deckHeader, cardsGrid);
      page.appendChild(deckSection);
    });

    container.appendChild(page);
    loadColorComboImages(cardTiles);
  }


// Stats navigation and player wins chart
  function switchStatsView(view) {
    document.getElementById("subBtnTotal").classList.toggle("active", view === "total");
    document.getElementById("subBtnPlayer").classList.toggle("active", view === "player");
    document.getElementById("stats-total").style.display = view === "total" ? "block" : "none";
    document.getElementById("stats-player").style.display = view === "player" ? "block" : "none";
  }

  function openPlayerProfile(owner) {
    const select = document.getElementById("playerProfileSelect");
    const option = Array.from(select.options).find(item => item.value === owner);
    if (!option) return;

    select.value = owner;
    switchStatsView("player");
    renderPlayerProfile();
  }

  function renderPlayerWinsPie(players) {
    const container = document.getElementById("playerWinsPieChart");
    container.replaceChildren();

    if (!players.length) {
      const empty = document.createElement("div");
      empty.className = "player-wins-empty";
      empty.textContent = "No player wins in this period.";
      container.appendChild(empty);
      return;
    }

    const svgNamespace = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNamespace, "svg");
    const center = 100;
    const radius = 88;
    const totalWins = players.reduce((sum, player) => sum + player.wins, 0);
    const playerColors = new Map(
      players.map((player, index) => [
        player.owner,
        PLAYER_WIN_CHART_COLORS[index % PLAYER_WIN_CHART_COLORS.length]
      ])
    );
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Player share of ${totalWins} total wins`);

    const clickableSlice = (element, player, percentage) => {
      const color = playerColors.get(player.owner);
      const openProfile = () => openPlayerProfile(player.owner);
      element.setAttribute("fill", color);
      element.setAttribute("stroke", "#0b0f17");
      element.setAttribute("stroke-width", "2");
      element.setAttribute("tabindex", "0");
      element.setAttribute("role", "button");
      element.setAttribute(
        "aria-label",
        `${player.owner}: ${player.wins} wins, ${percentage.toFixed(1)}% of total wins. Open player profile.`
      );
      element.classList.add("player-wins-slice");
      element.addEventListener("click", openProfile);
      element.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openProfile();
        }
      });

      const title = document.createElementNS(svgNamespace, "title");
      title.textContent = `${player.owner}: ${player.wins} wins (${percentage.toFixed(1)}%)`;
      element.appendChild(title);
    };

    const activePlayers = players.filter(player => player.wins > 0);
    if (totalWins === 0) {
      const emptyCircle = document.createElementNS(svgNamespace, "circle");
      emptyCircle.setAttribute("cx", center);
      emptyCircle.setAttribute("cy", center);
      emptyCircle.setAttribute("r", radius);
      emptyCircle.setAttribute("fill", "#1b2534");
      emptyCircle.setAttribute("stroke", "#4b5563");
      emptyCircle.setAttribute("stroke-width", "2");
      svg.appendChild(emptyCircle);

      const emptyText = document.createElementNS(svgNamespace, "text");
      emptyText.setAttribute("x", center);
      emptyText.setAttribute("y", center);
      emptyText.setAttribute("text-anchor", "middle");
      emptyText.setAttribute("dominant-baseline", "middle");
      emptyText.setAttribute("fill", "#a69f92");
      emptyText.textContent = "No wins";
      svg.appendChild(emptyText);
    } else if (activePlayers.length === 1) {
      const player = activePlayers[0];
      const circle = document.createElementNS(svgNamespace, "circle");
      circle.setAttribute("cx", center);
      circle.setAttribute("cy", center);
      circle.setAttribute("r", radius);
      clickableSlice(circle, player, 100);
      svg.appendChild(circle);
    } else {
      let startAngle = -Math.PI / 2;
      activePlayers.forEach(player => {
        const percentage = (player.wins / totalWins) * 100;
        const endAngle = startAngle + (percentage / 100) * Math.PI * 2;
        const startX = center + radius * Math.cos(startAngle);
        const startY = center + radius * Math.sin(startAngle);
        const endX = center + radius * Math.cos(endAngle);
        const endY = center + radius * Math.sin(endAngle);
        const largeArc = percentage > 50 ? 1 : 0;
        const path = document.createElementNS(svgNamespace, "path");
        path.setAttribute(
          "d",
          `M ${center} ${center} L ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY} Z`
        );
        clickableSlice(path, player, percentage);
        svg.appendChild(path);
        startAngle = endAngle;
      });
    }

    const pie = document.createElement("div");
    pie.className = "player-wins-pie";
    pie.appendChild(svg);
    const legend = document.createElement("div");
    legend.className = "player-wins-legend";

    players.forEach(player => {
      const percentage = totalWins ? (player.wins / totalWins) * 100 : 0;
      const item = document.createElement("button");
      item.type = "button";
      item.className = "player-wins-legend-item";
      item.addEventListener("click", () => openPlayerProfile(player.owner));

      const swatch = document.createElement("span");
      swatch.className = "player-wins-legend-swatch";
      swatch.style.backgroundColor = playerColors.get(player.owner);

      const name = document.createElement("span");
      name.className = "player-wins-legend-name";
      name.textContent = player.owner;

      const value = document.createElement("span");
      value.className = "player-wins-legend-value";
      value.textContent = `${player.wins} ${player.wins === 1 ? "win" : "wins"} · ${percentage.toFixed(1)}%`;

      item.append(swatch, name, value);
      legend.appendChild(item);
    });

    container.append(pie, legend);
  }


// Commander links and color-combination grid
function setStatsPodFilter(podVal) {
    statsPodFilter = podVal;
    ["all", "3", "4"].forEach(val => {
      const btn = document.getElementById(`podFilterBtn_${val}`);
      if (btn) btn.classList.toggle("active", val === podVal);
    });
    loadStats();
  }

function escapeHtml(value) {
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, character => entities[character]);
}

function scryfallSearchUrl(cardName) {
  return `https://scryfall.com/search?q=${encodeURIComponent(`!"${cardName}"`)}`;
}

function renderScryfallCommanderLinks(commanderName) {
  return String(commanderName || "").split(" & ").map(cardName => `
    <a class="scryfall-card-link" href="${scryfallSearchUrl(cardName)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(cardName)}
    </a>
  `).join(' <span class="commander-pair-separator">&amp;</span> ');
}

function getColorIdentityKey(colors) {
  const identity = new Set(colors || []);
  const coloredKey = WUBRG_ORDER.filter(color => identity.has(color)).join("");
  return coloredKey || "C";
}

function renderColorComboGrid(owner, activeIds, inactiveIds, activeCounts = {}, inactiveCounts = {}) {
  const activeSet = new Set(activeIds || []);
  const inactiveSet = new Set(inactiveIds || []);

  const tilesHtml = ALL_32_COMBINATIONS.map(combo => {
    const activeCount = activeCounts[combo.key] || 0;
    const inactiveCount = inactiveCounts[combo.key] || 0;
    const hasActive = activeSet.has(combo.key) || activeCount > 0;
    const hasInactiveOnly = !hasActive && (inactiveSet.has(combo.key) || inactiveCount > 0);

    let stateClass = "missing";
    let statusLabel = "0 decks";
    if (hasActive) {
      stateClass = "owned";
      const count = activeCount || 1;
      statusLabel = `${count} ${count === 1 ? "deck" : "decks"}`;
    } else if (hasInactiveOnly) {
      stateClass = "owned-inactive";
      const count = inactiveCount || 1;
      statusLabel = `${count} non-actief`;
    }

    return `
      <button type="button" class="combo-tile ${stateClass}" data-color-key="${combo.key}"
              title="${combo.name} (${combo.key}) - ${statusLabel}"
              aria-label="Show ${combo.name} commanders for ${escapeHtml(owner)}">
        <span class="combo-pips">${renderPips(combo.colors, 18)}</span>
        <span class="combo-name">${combo.name}</span>
        <span class="combo-status-tag">${statusLabel}</span>
      </button>
    `;
  }).join("");

  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <h2 style="margin:0;">Kleurencombinaties</h2>
        <span style="font-family:var(--font-display); font-size:0.85rem; color:var(--gold-bright); font-weight:700;">
          ${activeSet.size} / 32
        </span>
      </div>
      <div class="combo-grid">${tilesHtml}</div>
    </div>
  `;
}


// Stats data and player profile rendering
  async function loadStats() {
    const minGames = document.getElementById("minGamesFilter").value || 1;
    const period = document.getElementById("timePeriodFilter").value || "all";
    const res = await fetch(`/api/stats?min_games=${minGames}&period=${period}&pod_size=${statsPodFilter}`);
    statsData = await res.json();

    document.getElementById("headerGameCount").textContent = `${statsData.total_games} Games`;
    document.getElementById("kpiTotalGames").textContent = statsData.total_games;
    document.getElementById("kpiAvgTurns").textContent = statsData.avg_turns;

    const leaderboard = document.getElementById("playerLeaderboardBody");
    leaderboard.innerHTML = statsData.player_stats.map((p, index) => `
      <tr>
        <td><button type="button" class="player-leaderboard-link" data-player-index="${index}">${p.owner}</button></td>
        <td>${p.games_played}</td>
        <td>${p.wins}</td>
        <td><strong>${p.winrate}%</strong></td>
      </tr>
    `).join("") || `<tr><td colspan="4" style="color:var(--muted);">No games in this period.</td></tr>`;
    leaderboard.querySelectorAll(".player-leaderboard-link").forEach(button => {
      button.addEventListener("click", () => {
        const player = statsData.player_stats[Number(button.dataset.playerIndex)];
        if (player) openPlayerProfile(player.owner);
      });
    });

    document.getElementById("topPlayedBody").innerHTML = statsData.top_played.map(c => `
      <tr>
        <td>${c.display_name}</td>
        <td>${c.owner}</td>
        <td>${c.games_played}</td>
        <td>${c.wins}</td>
      </tr>
    `).join("") || `<tr><td colspan="4" style="color:var(--muted);">No data for this period.</td></tr>`;

    document.getElementById("topWinrateBody").innerHTML = statsData.top_winrate.map(c => `
      <tr>
        <td>${c.display_name} <span style="color:var(--muted); font-size:0.9rem;">(${c.owner})</span></td>
        <td>${c.wins}W - ${c.games_played - c.wins}L</td>
        <td><strong>${c.winrate}%</strong></td>
      </tr>
    `).join("") || `<tr><td colspan="3" style="color:var(--muted);">No commanders meet minimum games.</td></tr>`;

    document.getElementById("actualCommanderStatsBody").innerHTML = statsData.actual_commander_stats.map(c => `
      <tr>
        <td>${renderScryfallCommanderLinks(c.actual_commander)}</td>
        <td>${c.games_played}</td>
        <td>${c.wins}</td>
        <td><strong>${c.winrate}%</strong></td>
      </tr>
    `).join("") || `<tr><td colspan="4" style="color:var(--muted);">No games in this period.</td></tr>`;

    document.getElementById("seatStatsBody").innerHTML = statsData.seat_stats.map(s => `
      <tr>
        <td>Seat ${s.seat_order}</td>
        <td>${s.games}</td>
        <td>${s.wins}</td>
        <td>${s.winrate}%</td>
      </tr>
    `).join("") || `<tr><td colspan="4" style="color:var(--muted);">No data for this period.</td></tr>`;

    const totalG = statsData.total_games || 1;
    document.getElementById("winconBreakdown").innerHTML = statsData.wincon_stats.map(w => {
      const pct = Math.round((w.count / totalG) * 100);
      return `
        <div style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:0.96rem;">
            <span>${w.win_condition}</span>
            <span>${w.count} (${pct}%)</span>
          </div>
          <div class="bar-wrap"><div class="bar-fill" style="width:${pct}%;"></div></div>
        </div>
      `;
    }).join("") || `<span style="color:var(--muted); font-size:0.96rem;">No games in this period.</span>`;

    document.getElementById("recentGamesList").innerHTML = statsData.recent_games.map(g => {
      const playersHtml = g.participants.map(p => {
        const deckName = p.commander_2 ? `${p.commander_1} & ${p.commander_2}` : p.commander_1;
        const cmd = p.is_alternative
          ? `${deckName} <span style="color:var(--gold-bright);">(played ${p.played_commander})</span>`
          : deckName;
        return `<div style="font-size:0.96rem; ${p.is_winner ? 'color:var(--success); font-weight:700;' : 'color:var(--muted);'}">
          #${p.seat_order} ${cmd} (${p.owner}) ${p.is_winner ? '🏆' : ''}
        </div>`;
      }).join("");
      return `
        <div style="background:rgba(12, 18, 28, 0.56); border:1px solid var(--border-subtle); border-radius:10px; padding:10px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <span style="font-size:0.9rem; color:var(--gold-bright);">${g.played_date} • Turn ${g.turns} (${g.win_condition})</span>
            <div style="display:flex; gap:6px;">
              <button type="button" class="small secondary" style="padding:3px 10px; font-size:0.72rem; margin:0;" onclick="startEditGame(${g.id})">Edit</button>
              <button type="button" class="small danger" style="padding:3px 10px; font-size:0.72rem; margin:0;" onclick="deleteGame(${g.id})">Del</button>
            </div>
          </div>
          ${playersHtml}
        </div>
      `;
    }).join("") || `<span style="color:var(--muted); font-size:0.96rem;">No recent games in this period.</span>`;

    const owners = Object.keys(statsData.player_profiles);
    const select = document.getElementById("playerProfileSelect");
    const currentSelection = select.value;
    select.innerHTML = owners.map(o => `<option value="${o}">${o}</option>`).join("");
    if (owners.includes(currentSelection)) select.value = currentSelection;
    renderPlayerProfile();
    renderPlayerWinsPie(statsData.player_stats);
  }

  function setPlayerSort(column) {
    if (playerDeckSortBy === column) {
      playerDeckSortDir = playerDeckSortDir === "asc" ? "desc" : "asc";
    } else {
      playerDeckSortBy = column;
      playerDeckSortDir = "desc";
    }
    renderPlayerProfile();
  }

  function handlePlayerSearchInput(val) {
    playerDeckSearch = val.toLowerCase();
    renderPlayerProfile();
  }

  function renderPlayerProfile() {
    const owner = document.getElementById("playerProfileSelect").value;
    const container = document.getElementById("playerProfileContent");
    if (!owner || !statsData || !statsData.player_profiles[owner]) {
      container.innerHTML = `<div class="card">No player data available yet.</div>`;
      return;
    }
    const p = statsData.player_profiles[owner];
    const comboGridCardHtml = renderColorComboGrid(
      owner,
      p.active_identities,
      p.inactive_identities,
      p.active_identity_counts,
      p.inactive_identity_counts
    );

    const colorNames = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colorless" };
    const maxCol = Math.max(...Object.values(p.color_counts), 1);

    const colorBarsHtml = ["W", "U", "B", "R", "G", "C"].map(col => {
      const count = p.color_counts[col] || 0;
      const pct = Math.round((count / maxCol) * 100);
      return `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="display:inline-flex; align-items:center;">${getManaImgHtml(col, 22)}</span>
          <span style="width:76px; font-size:0.96rem;">${colorNames[col]}</span>
          <div class="bar-wrap" style="flex:1; margin:0;">
            <div class="bar-fill" style="width:${pct}%;"></div>
          </div>
          <span style="width:24px; text-align:right; font-size:0.96rem;">${count}</span>
        </div>
      `;
    }).join("");

    let decks = [...p.commanders];
    if (playerDeckSearch) {
      decks = decks.filter(c => c.display_name.toLowerCase().includes(playerDeckSearch));
    }

    decks.sort((a, b) => {
      let valA, valB;
      if (playerDeckSortBy === "name") {
        valA = a.display_name.toLowerCase();
        valB = b.display_name.toLowerCase();
        return playerDeckSortDir === "asc" ? valA.localeCompare(valB) : valB.localeCompare(valA);
      } else if (playerDeckSortBy === "games_played") {
        valA = a.games_played;
        valB = b.games_played;
      } else if (playerDeckSortBy === "wins") {
        valA = a.wins;
        valB = b.wins;
      } else if (playerDeckSortBy === "winrate") {
        valA = a.winrate;
        valB = b.winrate;
      }
      return playerDeckSortDir === "asc" ? valA - valB : valB - valA;
    });

    const getSortIndicator = (col) => {
      if (playerDeckSortBy !== col) return "";
      return playerDeckSortDir === "asc" ? " ▲" : " ▼";
    };

    const decksHtml = decks.map(c => `
      <tr>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            ${renderPowerBadge(c.power_level)}
            <div>
              <div>${c.display_name}</div>
              <div style="margin-top:2px;">${renderPips(c.colors, 20)}</div>
            </div>
          </div>
        </td>
        <td>${c.games_played}</td>
        <td>${c.wins}</td>
        <td><strong>${c.winrate}%</strong></td>
      </tr>
    `).join("");

    const actualCommandersHtml = p.actual_commanders.map(c => `
      <tr>
        <td>${renderScryfallCommanderLinks(c.actual_commander)}</td>
        <td>${c.games_played}</td>
        <td>${c.wins}</td>
        <td><strong>${c.winrate}%</strong></td>
      </tr>
    `).join("");

    container.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-box">
          <div class="kpi-val">${p.games_played}</div>
          <div class="kpi-lbl">Games Played</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-val">${p.winrate}%</div>
          <div class="kpi-lbl">Winrate (${p.wins}W)</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-val">${p.avg_win_turns || '-'}</div>
          <div class="kpi-lbl">Avg. Turn on Win</div>
        </div>
        <div class="kpi-box">
          <div class="kpi-val" style="font-size:1.05rem; padding-top:6px;">${p.favorite_wincon}</div>
          <div class="kpi-lbl">Signature Wincon</div>
        </div>
      </div>

      <div class="card">
        <h2>Color Preference</h2>
        ${colorBarsHtml}
      </div>

      ${comboGridCardHtml}

      <div class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <h2 style="margin:0;">${p.owner}'s Commanders</h2>
          <input type="text" placeholder="Zoek op decknaam..." value="${playerDeckSearch}"
                 autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
                 oninput="handlePlayerSearchInput(this.value)" 
                 style="width:auto; flex:1; min-width:160px; max-width:220px; padding:6px 10px; font-size:0.92rem;" />
        </div>
        <table>
          <thead>
            <tr>
              <th style="cursor:pointer;" onclick="setPlayerSort('name')">Commander${getSortIndicator('name')}</th>
              <th style="cursor:pointer;" onclick="setPlayerSort('games_played')">Played${getSortIndicator('games_played')}</th>
              <th style="cursor:pointer;" onclick="setPlayerSort('wins')">Wins${getSortIndicator('wins')}</th>
              <th style="cursor:pointer;" onclick="setPlayerSort('winrate')">Winrate${getSortIndicator('winrate')}</th>
            </tr>
          </thead>
          <tbody>${decksHtml || `<tr><td colspan="4" style="color:var(--muted);">Geen decks gevonden.</td></tr>`}</tbody>
        </table>
      </div>

      <div class="card">
        <h2>Actual Commander Stats</h2>
        <table>
          <thead>
            <tr>
              <th>Played</th>
              <th>Games</th>
              <th>Wins</th>
              <th>Winrate</th>
            </tr>
          </thead>
          <tbody>${actualCommandersHtml || `<tr><td colspan="4" style="color:var(--muted);">No games in this period.</td></tr>`}</tbody>
        </table>
      </div>
    `;

    container.querySelectorAll(".combo-tile").forEach(tile => {
      tile.addEventListener("click", () => openColorCombinationPage(owner, tile.dataset.colorKey));
    });
  }

