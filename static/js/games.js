// Win conditions and game seat setup
  async function loadWinConditions() {
    const res = await fetch("/api/win_conditions");
    winConditions = await res.json();

    document.getElementById("gameWincon").innerHTML = winConditions
      .map(w => `<option value="${w.name}">${w.name}</option>`).join("");

    document.getElementById("winconList").innerHTML = winConditions
      .map(w => `<div class="wincon-tag">${w.name} <span class="del" onclick="deleteWincon(${w.id})">✕</span></div>`)
      .join("");
  }

  function getUniquePlayers(includeArchived = false) {
    return [...new Set(commanders.filter(c => includeArchived || !c.is_deleted).map(c => c.owner))]
      .sort((a, b) => a.localeCompare(b));
  }

  function populateSeatCommanders(seat, selectedOwner, selectedCmdId = "") {
    const cmdSelect = document.getElementById(`seatCmd_${seat}`);
    if (!cmdSelect) return;

    if (!selectedOwner) {
      cmdSelect.innerHTML = `<option value="">-- Select Player first --</option>`;
      cmdSelect.disabled = true;
      return;
    }

    const ownerDecks = commanders
      .filter(c =>
        c.owner === selectedOwner &&
        ((!c.is_deleted && (c.is_active ?? 1) === 1) || String(c.id) === String(selectedCmdId))
      )
      .sort((a, b) => {
        const nameA = a.commander_2 ? `${a.commander_1} & ${a.commander_2}` : a.commander_1;
        const nameB = b.commander_2 ? `${b.commander_1} & ${b.commander_2}` : b.commander_1;
        return nameA.localeCompare(nameB);
      });

      cmdSelect.disabled = false;
      cmdSelect.innerHTML =
        `<option value="">-- Select Commander (${selectedOwner}) --</option>` +
        ownerDecks.map(c => {
          const cmdName = c.commander_2 ? `${c.commander_1} & ${c.commander_2}` : c.commander_1;
          const inactiveTag = (c.is_active ?? 1) === 0 ? " (inactive)" : "";
          return `<option value="${c.id}">${cmdName} [LV.${c.power_level || 3}]${inactiveTag}</option>`;
        }).join("");

        if (selectedCmdId) {
          cmdSelect.value = String(selectedCmdId);
        }
    populatePlayedCommander(seat);
    }

  function onSeatPlayerChange(seat) {
    const playerSelect = document.getElementById(`seatPlayer_${seat}`);
    const chosenOwner = playerSelect ? playerSelect.value : "";
    populateSeatCommanders(seat, chosenOwner, "");
  }

  function renderSeatInputs(existingParticipants = null) {
    const podSize = existingParticipants ? existingParticipants.length : parseInt(document.getElementById("podSize").value, 10);
    if (!existingParticipants) {
      document.getElementById("podSize").value = podSize;
    }
    const container = document.getElementById("seatsContainer");
    const players = getUniquePlayers(Boolean(existingParticipants));

    const playerOptionsHtml =
      `<option value="">-- Select Player --</option>` +
      players.map(owner => `<option value="${owner}">${owner}</option>`).join("");

    let html = "";
    for (let seat = 1; seat <= podSize; seat++) {
      const pData = existingParticipants ? existingParticipants.find(p => p.seat_order === seat) : null;
      const isWinner = pData ? pData.is_winner === 1 : false;

      html += `
        <div class="seat-box ${isWinner ? 'is-winner' : ''}" id="seatBox_${seat}">
          <div class="seat-header">
            <div class="seat-header-left">
              <span class="seat-badge">Seat ${seat}</span>
              <select id="seatPlayer_${seat}" class="seat-player-select" onchange="onSeatPlayerChange(${seat})">
                ${playerOptionsHtml}
              </select>
            </div>
            <label class="winner-toggle" style="margin:0;">
              <input type="radio" name="gameWinner" value="${seat}" onchange="highlightWinner(${seat})" ${isWinner ? 'checked' : ''} />
              Winner 🏆
            </label>
          </div>
          <select id="seatCmd_${seat}" disabled onchange="populatePlayedCommander(${seat})">
            <option value="">-- Select Player first --</option>
          </select>
          <div id="playedCommanderWrap_${seat}" style="display:none; margin-top:8px;">
            <label for="seatPlayedCommander_${seat}" style="margin-top:0;">Commander actually played</label>
            <select id="seatPlayedCommander_${seat}"></select>
          </div>
        </div>
      `;
    }
    container.innerHTML = html;

    if (existingParticipants) {
      existingParticipants.forEach(p => {
        const cmdObj = commanders.find(c => c.id === p.commander_id);
        const ownerName = cmdObj ? cmdObj.owner : "";
        const playerSel = document.getElementById(`seatPlayer_${p.seat_order}`);
        if (playerSel && ownerName) {
          playerSel.value = ownerName;
        }
        populateSeatCommanders(p.seat_order, ownerName, p.commander_id);
        populatePlayedCommander(p.seat_order, p.played_alternative_id);
      });
    }
  }

  function populatePlayedCommander(seat, selectedAlternativeId = "") {
    const deckId = document.getElementById(`seatCmd_${seat}`).value;
    const choice = document.getElementById(`seatPlayedCommander_${seat}`);
    const wrapper = document.getElementById(`playedCommanderWrap_${seat}`);
    const deck = commanders.find(c => String(c.id) === String(deckId));
    const alternatives = deck ? deck.alternatives || [] : [];

    choice.innerHTML = deck
      ? `<option value="">${getDeckDisplayName(deck)} (Main commander)</option>` +
        alternatives.map(alternative =>
          `<option value="${alternative.id}">${alternative.name} (Alternative)</option>`
        ).join("")
      : "";
    wrapper.style.display = alternatives.length ? "block" : "none";
    choice.value = selectedAlternativeId ? String(selectedAlternativeId) : "";
  }

  function highlightWinner(winningSeat) {
    document.querySelectorAll(".seat-box").forEach(el => el.classList.remove("is-winner"));
    const box = document.getElementById(`seatBox_${winningSeat}`);
    if (box) box.classList.add("is-winner");
  }


// Game editing and deletion
  async function startEditGame(gameId) {
    const res = await fetch(`/api/games/${gameId}`);
    if (!res.ok) return showToast("Kon spel niet laden", true);
    const game = await res.json();

    document.getElementById("editGameId").value = game.id;
    document.getElementById("podSize").value = game.participants.length;
    document.getElementById("gameTurns").value = game.turns;
    document.getElementById("gameDate").value = game.played_at;
    document.getElementById("gameWincon").value = game.win_condition;

    renderSeatInputs(game.participants);

    document.getElementById("gameFormTitle").textContent = `Edit Game #${game.id}`;
    document.getElementById("saveGameBtn").textContent = "Save Game Changes";
    document.getElementById("cancelGameEditBtn").style.display = "block";

    switchTab("log");
    document.getElementById("gameFormCard").scrollIntoView({ behavior: "smooth" });
  }

  function cancelEditGame() {
    document.getElementById("editGameId").value = "";
    document.getElementById("gameTurns").value = "";
    setTodayDate();
    document.getElementById("podSize").value = "4";
    renderSeatInputs();

    document.getElementById("gameFormTitle").textContent = "Log Completed Game";
    document.getElementById("saveGameBtn").textContent = "Save Game Result";
    document.getElementById("cancelGameEditBtn").style.display = "none";
  }

  async function deleteGame(gameId) {
    if (!confirm(`Weet je zeker dat je spel #${gameId} wilt verwijderen?`)) return;
    const res = await fetch(`/api/games/${gameId}`, { method: "DELETE" });
    if (res.ok) {
      showToast("Spel verwijderd!");
      loadStats();
    } else {
      showToast("Fout bij verwijderen spel", true);
    }
  }


// Win-condition management and game submission
  async function addWincon() {
    const name = document.getElementById("newWinconName").value.trim();
    if (!name) return;
    const res = await fetch("/api/win_conditions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      document.getElementById("newWinconName").value = "";
      loadWinConditions();
      showToast("Win condition added!");
    } else {
      showToast("Could not add win condition", true);
    }
  }

  async function deleteWincon(id) {
    await fetch(`/api/win_conditions/${id}`, { method: "DELETE" });
    loadWinConditions();
  }

  async function submitGame() {
    const editGameId = document.getElementById("editGameId").value;
    const podSize = parseInt(document.getElementById("podSize").value, 10);
    const turns = document.getElementById("gameTurns").value;
    const played_at = document.getElementById("gameDate").value;
    const win_condition = document.getElementById("gameWincon").value;
    const winnerRadio = document.querySelector('input[name="gameWinner"]:checked');

    if (!turns || turns < 1) return showToast("Enter number of turns.", true);
    if (!played_at) return showToast("Select a date.", true);
    if (!winnerRadio) return showToast("Select who won the game.", true);

    const winningSeat = parseInt(winnerRadio.value, 10);
    const participants = [];
    const usedCmdIds = new Set();

    for (let seat = 1; seat <= podSize; seat++) {
      const playerName = document.getElementById(`seatPlayer_${seat}`).value;
      const cmdId = document.getElementById(`seatCmd_${seat}`).value;
      const alternativeId = document.getElementById(`seatPlayedCommander_${seat}`).value;
      if (!playerName) return showToast(`Select a player for Seat ${seat}.`, true);
      if (!cmdId) return showToast(`Select a commander for Seat ${seat}.`, true);
      if (usedCmdIds.has(cmdId)) return showToast("Same deck selected twice.", true);
      usedCmdIds.add(cmdId);

      participants.push({
        commander_id: parseInt(cmdId, 10),
        played_alternative_id: alternativeId ? parseInt(alternativeId, 10) : null,
        seat_order: seat,
        is_winner: seat === winningSeat
      });
    }

    const url = editGameId ? `/api/games/${editGameId}` : "/api/games";
    const method = editGameId ? "PUT" : "POST";

    const res = await fetch(url, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turns, played_at, win_condition, participants })
    });

    if (res.ok) {
      if (editGameId) {
        cancelEditGame();
        showToast("Spel bijgewerkt!");
      } else {
        document.getElementById("gameTurns").value = "";
        setTodayDate();
        renderSeatInputs();
        showToast("Game logged!");
      }
      loadStats();
    } else {
      const err = await res.json();
      showToast(err.error || "Error saving game", true);
    }
  }

