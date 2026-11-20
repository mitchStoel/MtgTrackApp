// Commander selection, Scryfall search, and deck form
  function renderPowerSelector() {
    const current = parseInt(document.getElementById("deckPowerLevel").value, 10) || 3;
    const grid = document.getElementById("powerSelectorGrid");
    grid.innerHTML = [1, 2, 3, 4, 5].map(lvl => {
      const cfg = POWER_LEVELS[lvl];
      const isSelected = lvl === current;
      return `
        <div class="power-option ${isSelected ? 'selected' : ''}" onclick="selectPowerLevel(${lvl})">
          ${getPowerImgHtml(lvl, 34)}
          <span class="pl-label" style="color:${cfg.text};">${cfg.label}</span>
          <span class="pl-desc">${cfg.desc}</span>
        </div>
      `;
    }).join("");
  }

  function selectPowerLevel(lvl) {
    document.getElementById("deckPowerLevel").value = lvl;
    renderPowerSelector();
  }

  function updateManaCostPreview() {
    const raw = document.getElementById("deckMana").value || "";
    const el = document.getElementById("manaCostIconsPreview");
    if (!el) return;
    el.innerHTML = renderManaCostSymbols(raw, 20);
  }

  function onCommanderInput(slot, query) {
    selectedScryfallCards[slot] = null;
    clearTimeout(scryfallTimers[slot]);

    const listEl = document.getElementById(`cmdSuggestions_${slot}`);
    const q = query.trim();
    if (q.length < 2) {
      listEl.style.display = "none";
      listEl.innerHTML = "";
      return;
    }

    scryfallTimers[slot] = setTimeout(() => {
      fetchScryfallCommanders(slot, q);
    }, 260);
  }

  async function fetchScryfallCommanders(slot, query) {
    const listEl = document.getElementById(`cmdSuggestions_${slot}`);
    try {
      const searchQuery = encodeURIComponent(`is:commander ${query}`);
      const res = await fetch(`https://api.scryfall.com/cards/search?q=${searchQuery}&order=edhrec`, {
        headers: { "Accept": "application/json" }
      });

      if (!res.ok) {
        listEl.style.display = "none";
        return;
      }

      const data = await res.json();
      const cards = (data.data || []).slice(0, 8);
      scryfallResultsCache[slot] = cards;

      if (!cards.length) {
        listEl.style.display = "none";
        return;
      }

      listEl.innerHTML = cards.map((card, idx) => {
        const mana = card.mana_cost || (card.card_faces && card.card_faces[0] ? card.card_faces[0].mana_cost : "") || "";
        const identity = card.color_identity || [];
        return `
          <div class="autocomplete-item" onclick="selectScryfallCard(${slot}, ${idx})">
            <div>
              <div class="autocomplete-name">${card.name}</div>
              <div class="autocomplete-sub">${card.type_line || ""} ${mana ? `• ${mana}` : ""}</div>
            </div>
            <div style="flex-shrink:0;">${renderPips(identity, 20)}</div>
          </div>
        `;
      }).join("");

      listEl.style.display = "block";
    } catch (err) {
      listEl.style.display = "none";
    }
  }

  function selectScryfallCard(slot, idx) {
    const card = scryfallResultsCache[slot][idx];
    if (!card) return;

    const inputId = slot === 1
      ? "deckCmd1"
      : slot === 2
        ? "deckCmd2"
        : "alternativeCommanderSearch";
    const inputEl = document.getElementById(inputId);
    const listEl = document.getElementById(`cmdSuggestions_${slot}`);

    inputEl.value = card.name;
    listEl.style.display = "none";

    const mana = card.mana_cost || (card.card_faces && card.card_faces[0] ? card.card_faces[0].mana_cost : "") || "";
    if (slot === 3) {
      const identity = card.color_identity || [];
      const mainIdentity = new Set(document.getElementById("deckColorIdentity").value || "");
      if (identity.some(color => !mainIdentity.has(color))) {
        showToast(`${card.name} does not fit the deck's color identity.`, true);
        inputEl.value = "";
        return;
      }

      const normalizedName = card.name.toLowerCase();
      const isMainCommander = [1, 2].some(mainSlot =>
        (selectedScryfallCards[mainSlot]?.name || document.getElementById(`deckCmd${mainSlot}`).value)
          .toLowerCase() === normalizedName
      );
      const alreadyAdded = selectedAlternativeCards.some(alternative =>
        alternative.scryfall_id === card.id || alternative.name.toLowerCase() === normalizedName
      );
      if (isMainCommander || alreadyAdded) {
        showToast(`${card.name} is already listed for this deck.`, true);
        inputEl.value = "";
        return;
      }

      selectedAlternativeCards.push({
        name: card.name,
        scryfall_id: card.id,
        color_identity: identity
      });
      selectedScryfallCards[slot] = null;
      inputEl.value = "";
      renderAlternativeCards();
      return;
    }

    selectedScryfallCards[slot] = {
      name: card.name,
      mana_cost: mana,
      color_identity: card.color_identity || []
    };

    applyCombinedScryfallData();
  }

  function renderAlternativeCards() {
    const container = document.getElementById("alternativeCommanderList");
    container.replaceChildren();

    selectedAlternativeCards.forEach((alternative, index) => {
      const item = document.createElement("div");
      item.className = "alternative-commander-item";

      const name = document.createElement("span");
      name.textContent = alternative.name;
      item.appendChild(name);

      const identity = document.createElement("span");
      identity.className = "alternative-commander-identity";
      identity.innerHTML = renderPips(alternative.color_identity, 18);
      item.appendChild(identity);

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "remove-alternative-button";
      removeButton.setAttribute("aria-label", `Remove ${alternative.name}`);
      removeButton.textContent = "×";
      removeButton.onclick = () => removeAlternativeCard(index);
      item.appendChild(removeButton);

      container.appendChild(item);
    });
  }

  function removeAlternativeCard(index) {
    selectedAlternativeCards.splice(index, 1);
    renderAlternativeCards();
  }

  function validateAlternativeIdentities() {
    const mainIdentity = new Set(document.getElementById("deckColorIdentity").value || "");
    const invalidAlternative = selectedAlternativeCards.find(alternative =>
      alternative.color_identity.some(color => !mainIdentity.has(color))
    );
    if (invalidAlternative) {
      showToast(`${invalidAlternative.name} does not fit the deck's color identity.`, true);
      return false;
    }
    return true;
  }

  function applyCombinedScryfallData() {
    const c1 = selectedScryfallCards[1];
    const c2 = selectedScryfallCards[2];

    const manaParts = [];
    const identitySet = new Set();

    if (c1) {
      if (c1.mana_cost) manaParts.push(c1.mana_cost);
      (c1.color_identity || []).forEach(col => identitySet.add(col));
    }
    if (c2) {
      if (c2.mana_cost) manaParts.push(c2.mana_cost);
      (c2.color_identity || []).forEach(col => identitySet.add(col));
    }

    if (manaParts.length) {
      document.getElementById("deckMana").value = manaParts.join(" ");
    }
    updateManaCostPreview();

    const orderedIdentity = WUBRG_ORDER.filter(col => identitySet.has(col));
    setColorIdentity(orderedIdentity);
  }

  function setColorIdentity(colorsArray) {
    const uniqueOrdered = WUBRG_ORDER.filter(c => colorsArray.includes(c));
    document.getElementById("deckColorIdentity").value = uniqueOrdered.join("");
    renderActiveColorIdentityPreview(uniqueOrdered);
  }

  function renderActiveColorIdentityPreview(colors) {
    const preview = document.getElementById("activeColorIdentityPreview");
    if (!colors || !colors.length) {
      preview.innerHTML = `<em style="color:var(--muted); font-size:0.88rem;">Colorless / Geen gekozen</em>`;
      return;
    }
    preview.innerHTML = renderPips(colors, 22);
  }

  function clearManaAndIdentity() {
    document.getElementById("deckMana").value = "";
    selectedScryfallCards[1] = null;
    selectedScryfallCards[2] = null;
    updateManaCostPreview();
    setColorIdentity([]);
  }

  function buildPayloadManaCost() {
    const rawMana = document.getElementById("deckMana").value.trim();
    const idStr = document.getElementById("deckColorIdentity").value.trim();
    if (!idStr) return rawMana;

    const missingIdentitySymbols = idStr
      .split("")
      .filter(col => !rawMana.toUpperCase().includes(col))
      .map(col => `{${col}}`)
      .join("");

    if (!rawMana) {
      return idStr.split("").map(col => `{${col}}`).join("");
    }
    return missingIdentitySymbols ? `${rawMana} ${missingIdentitySymbols}` : rawMana;
  }

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".autocomplete-wrap")) {
      document.getElementById("cmdSuggestions_1").style.display = "none";
      document.getElementById("cmdSuggestions_2").style.display = "none";
      document.getElementById("cmdSuggestions_3").style.display = "none";
    }
  });


// Commander registry and deck table
  async function loadCommanders() {
    const res = await fetch("/api/commanders");
    commanders = await res.json();

    const availableCommanders = commanders.filter(c => !c.is_deleted);
    const owners = [...new Set(availableCommanders.map(c => c.owner))];
    document.getElementById("ownerSuggestions").innerHTML = owners.map(o => `<option value="${o}">`).join("");

    const filterSelect = document.getElementById("deckOwnerFilter");
    const currentFilter = filterSelect.value;
    filterSelect.innerHTML = `<option value="">All Owners</option>` + owners.map(o => `<option value="${o}">${o}</option>`).join("");
    if (owners.includes(currentFilter)) filterSelect.value = currentFilter;

    renderDecksTable();
    if (!document.getElementById("editGameId").value) {
      renderSeatInputs();
    }
  }

  function renderDecksTable() {
    const selectedOwner = document.getElementById("deckOwnerFilter").value;
    const selectedPower = document.getElementById("deckPowerFilter").value;
    const selectedStatus = document.getElementById("deckStatusFilter").value;
    const sortBy = document.getElementById("deckSortBy").value;

    let filtered = commanders.filter(c => !c.is_deleted);
    if (selectedOwner) {
      filtered = filtered.filter(c => c.owner === selectedOwner);
    }
    if (selectedPower) {
      filtered = filtered.filter(c => String(c.power_level) === selectedPower);
    }
    if (selectedStatus === "active") {
      filtered = filtered.filter(c => (c.is_active ?? 1) === 1);
    } else if (selectedStatus === "inactive") {
      filtered = filtered.filter(c => (c.is_active ?? 1) === 0);
    }

    if (sortBy === "alpha_asc") {
      filtered.sort((a, b) => getDeckDisplayName(a).localeCompare(getDeckDisplayName(b)));
    } else if (sortBy === "alpha_desc") {
      filtered.sort((a, b) => getDeckDisplayName(b).localeCompare(getDeckDisplayName(a)));
    } else if (sortBy === "colors") {
      filtered.sort((a, b) => {
        const rankDiff = getColorSortRank(a.colors) - getColorSortRank(b.colors);
        if (rankDiff !== 0) return rankDiff;
        return getDeckDisplayName(a).localeCompare(getDeckDisplayName(b));
      });
    }

    document.getElementById("deckCount").textContent = filtered.length;
    document.getElementById("registeredDecksTable").innerHTML = filtered.map(c => {
      const name = getDeckDisplayName(c);
      const isInactive = (c.is_active ?? 1) === 0;
      return `<tr class="${isInactive ? 'deck-inactive' : ''}">
        <td>
          <div>
            <strong>${name}</strong>
            ${isInactive ? renderInactiveBadge() : ""}
          </div>
          <div style="margin-top:4px;">${renderPips(c.colors, 20)}</div>
        </td>
        <td>${c.owner}</td>
        <td style="text-align:center;">${renderPowerBadge(c.power_level)}</td>
        <td style="text-align:right;">
          <div class="deck-action-buttons">
            <button type="button" class="edit-icon-button" aria-label="Edit commander" title="Edit commander" onclick="startEditCommander(${c.id})">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" aria-hidden="true" focusable="false">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
              </svg>
            </button>
            <button type="button" class="trash-icon-button" aria-label="Remove commander" title="Remove commander" onclick="requestDeleteCommander(${c.id})">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" aria-hidden="true" focusable="false">
                <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m4 3v8m6-8v8" />
              </svg>
            </button>
          </div>
        </td>
      </tr>`;
    }).join("") || `<tr><td colspan="4" style="color:var(--muted);">No decks found.</td></tr>`;
  }

  function startEditCommander(id) {
    const deck = commanders.find(c => c.id === id);
    if (!deck) return;

    document.getElementById("editDeckId").value = deck.id;
    document.getElementById("deckOwner").value = deck.owner;
    document.getElementById("deckCmd1").value = deck.commander_1;
    document.getElementById("deckCmd2").value = deck.commander_2 || "";
    document.getElementById("alternativeCommanderSearch").value = "";
    document.getElementById("deckMana").value = deck.mana_cost;
    updateManaCostPreview();
    setColorIdentity(deck.colors || []);
    selectedAlternativeCards = (deck.alternatives || []).map(alternative => ({
      ...alternative,
      color_identity: [...alternative.color_identity]
    }));
    renderAlternativeCards();
    selectPowerLevel(deck.power_level || 3);

    document.getElementById("deckStatusBox").style.display = "flex";
    document.getElementById("deckInactiveCheckbox").checked = (deck.is_active ?? 1) === 0;
    document.getElementById("deckFormTitle").textContent = "Edit Commander / Deck";
    document.getElementById("saveDeckBtn").textContent = "Save Changes";
    document.getElementById("cancelEditBtn").style.display = "block";

    document.getElementById("deckFormCard").scrollIntoView({ behavior: "smooth" });
  }

// Reset commander edit form
  function cancelEditCommander() {
    document.getElementById("editDeckId").value = "";
    document.getElementById("deckOwner").value = "";
    document.getElementById("deckCmd1").value = "";
    document.getElementById("deckCmd2").value = "";
    document.getElementById("alternativeCommanderSearch").value = "";
    selectedAlternativeCards = [];
    selectedScryfallCards[3] = null;
    scryfallResultsCache[3] = [];
    document.getElementById("cmdSuggestions_3").style.display = "none";
    document.getElementById("cmdSuggestions_3").innerHTML = "";
    renderAlternativeCards();
    clearManaAndIdentity();
    selectPowerLevel(3);

    document.getElementById("deckStatusBox").style.display = "none";
    document.getElementById("deckInactiveCheckbox").checked = false;
    document.getElementById("deckFormTitle").textContent = "Register Commander / Deck";
    document.getElementById("saveDeckBtn").textContent = "Register Deck";
    document.getElementById("cancelEditBtn").style.display = "none";
  }


// Commander deletion and submission
  async function requestDeleteCommander(id) {
    const res = await fetch(`/api/commanders/${id}/usage`);
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || "Commander usage could not be loaded", true);
      return;
    }

    const usage = await res.json();
    const commander = commanders.find(c => c.id === id);
    if (!commander) {
      showToast("Commander not found", true);
      return;
    }

    pendingCommanderDeleteId = id;
    const name = getDeckDisplayName(commander);
    const hasStats = usage.games_count > 0;
    document.getElementById("commanderDeleteMessage").textContent = hasStats
      ? `${name} (${commander.owner}) komt voor in ${usage.games_count} gespeelde game(s). Kies wat er met de gegevens gebeurt.`
      : `${name} (${commander.owner}) komt niet voor in gespeelde games. Je kunt de commander verwijderen of non-actief maken.`;
    document.getElementById("commanderDeleteDetails").textContent = hasStats
      ? "Optie 1 verwijdert de resultaten van deze commander; games en statistieken van andere deelnemers blijven behouden. Optie 2 bewaart alle historische statistieken maar verbergt de commander uit de decklijst."
      : "";
    document.getElementById("deleteCommanderWithStatsBtn").textContent = hasStats
      ? "1. Commander + eigen statistieken verwijderen"
      : "Commander verwijderen";
    document.getElementById("deleteCommanderKeepStatsBtn").style.display = hasStats ? "block" : "none";
    document.getElementById("deactivateCommanderBtn").textContent = hasStats
      ? "3. Commander op non-actief zetten"
      : "Commander op non-actief zetten";
    document.getElementById("commanderDeleteDialog").showModal();
  }

  function closeCommanderDeleteDialog() {
    document.getElementById("commanderDeleteDialog").close();
    pendingCommanderDeleteId = null;
  }

  async function applyCommanderDelete(action) {
    if (pendingCommanderDeleteId === null) return;

    const id = pendingCommanderDeleteId;
    const res = await fetch(`/api/commanders/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });

    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || "Commander could not be removed", true);
      return;
    }

    closeCommanderDeleteDialog();
    if (document.getElementById("editDeckId").value === String(id)) {
      cancelEditCommander();
    }
    const messages = {
      delete_with_stats: "Commander en eigen statistieken verwijderd",
      delete_keep_stats: "Commander verwijderd; statistieken behouden",
      inactive: "Commander op non-actief gezet"
    };
    showToast(messages[action]);
    await loadCommanders();
    await loadStats();
  }

  async function submitCommander() {
    const editId = document.getElementById("editDeckId").value;
    const owner = document.getElementById("deckOwner").value.trim();
    const commander_1 = document.getElementById("deckCmd1").value.trim();
    const commander_2 = document.getElementById("deckCmd2").value.trim();
    const mana_cost = buildPayloadManaCost();
    const power_level = parseInt(document.getElementById("deckPowerLevel").value, 10) || 3;
    const is_active = editId ? !document.getElementById("deckInactiveCheckbox").checked : true;
    if (!validateAlternativeIdentities()) return;
    
    const url = editId ? `/api/commanders/${editId}` : "/api/commanders";
    const method = editId ? "PUT" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        commander_1,
        commander_2,
        mana_cost,
        power_level,
        is_active,
        alternatives: selectedAlternativeCards
      })
    });

    if (res.ok) {
      if (editId) {
        cancelEditCommander();
        showToast("Commander updated!");
      } else {
        document.getElementById("deckCmd1").value = "";
        document.getElementById("deckCmd2").value = "";
        document.getElementById("alternativeCommanderSearch").value = "";
        selectedAlternativeCards = [];
        renderAlternativeCards();
        clearManaAndIdentity();
        selectPowerLevel(3);
        showToast("Commander registered!");
      }
      await loadCommanders();
    } else {
      const err = await res.json();
      showToast(err.error || "Error saving deck", true);
      if (editId) {
        await loadCommanders();
        const deck = commanders.find(c => c.id === Number(editId));
        if (deck) {
          selectedAlternativeCards = deck.alternatives || [];
          renderAlternativeCards();
        }
      }
    }
  }

