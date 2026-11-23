// Random deck selection for the currently selected player profile.
function createRandomDeckPickerCard(owner) {
  const card = document.createElement("section");
  card.className = "card random-deck-picker-card";

  const heading = document.createElement("h2");
  heading.textContent = "Random Deck Picker";

  const description = document.createElement("p");
  description.textContent = "Pick from your active decks for the next game.";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.textContent = "Choose decks";
  openButton.addEventListener("click", () => openRandomDeckPicker(owner));

  card.append(heading, description, openButton);
  return card;
}

async function openRandomDeckPicker(owner) {
  const activeDecks = commanders.filter(deck =>
    deck.owner === owner &&
    !deck.is_deleted &&
    (deck.is_active ?? 1) === 1
  );
  const dialog = document.createElement("dialog");
  dialog.className = "random-deck-picker-dialog";
  dialog.setAttribute("aria-labelledby", "randomDeckPickerTitle");

  const header = document.createElement("div");
  header.className = "random-deck-picker-header";

  const title = document.createElement("h2");
  title.id = "randomDeckPickerTitle";
  title.textContent = "Choose your decks";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "small secondary random-deck-picker-close";
  closeButton.textContent = "Close";
  closeButton.setAttribute("aria-label", "Close deck picker");
  closeButton.addEventListener("click", () => dialog.close());
  header.append(title, closeButton);

  const form = document.createElement("form");
  form.className = "random-deck-picker-form";

  const settings = document.createElement("div");
  settings.className = "random-deck-picker-settings";

  const countGroup = document.createElement("fieldset");
  countGroup.className = "random-deck-picker-group random-deck-picker-count-group";
  const countLegend = document.createElement("legend");
  countLegend.textContent = "Number of decks";
  const countInput = document.createElement("input");
  countInput.type = "number";
  countInput.setAttribute("inputmode", "numeric");
  countInput.setAttribute("aria-label", "Number of decks");
  countInput.min = "1";
  countInput.max = String(Math.max(activeDecks.length, 1));
  countInput.value = String(Math.max(1, Math.min(4, activeDecks.length)));
  countInput.required = true;

  const decrementButton = document.createElement("button");
  decrementButton.type = "button";
  decrementButton.className = "random-deck-picker-stepper-button secondary";
  decrementButton.textContent = "-";
  decrementButton.setAttribute("aria-label", "Choose one fewer deck");
  const incrementButton = document.createElement("button");
  incrementButton.type = "button";
  incrementButton.className = "random-deck-picker-stepper-button secondary";
  incrementButton.textContent = "+";
  incrementButton.setAttribute("aria-label", "Choose one more deck");

  const countStepper = document.createElement("div");
  countStepper.className = "random-deck-picker-stepper";
  countStepper.append(decrementButton, countInput, incrementButton);
  countGroup.append(countLegend, countStepper);

  function updateCountStepper() {
    const count = Number.parseInt(countInput.value, 10) || 0;
    decrementButton.disabled = count <= 1;
    incrementButton.disabled = count >= activeDecks.length;
  }

  decrementButton.addEventListener("click", () => {
    countInput.value = String(Math.max(1, (Number.parseInt(countInput.value, 10) || 1) - 1));
    updateCountStepper();
  });
  incrementButton.addEventListener("click", () => {
    countInput.value = String(Math.min(activeDecks.length, (Number.parseInt(countInput.value, 10) || 0) + 1));
    updateCountStepper();
  });
  countInput.addEventListener("input", updateCountStepper);
  countInput.addEventListener("change", () => {
    const count = Number.parseInt(countInput.value, 10);
    countInput.value = String(Number.isInteger(count)
      ? Math.max(1, Math.min(activeDecks.length || 1, count))
      : 1);
    updateCountStepper();
  });
  updateCountStepper();

  const powerGroup = createPickerRadioGroup(
    "pickerPower",
    "Power level",
    [
      { value: "all", label: "All", selected: true },
      ...[1, 2, 3, 4, 5].map(level => ({ value: String(level), label: String(level) }))
    ],
    "random-deck-picker-power-options"
  );
  const selectionGroup = createPickerRadioGroup(
    "pickerMode",
    "How should we choose?",
    [
      {
        value: "random",
        label: "Random",
        description: "Any matching deck has an equal chance.",
        selected: true
      },
      {
        value: "least_played",
        label: "Least played",
        description: "Fewer games first; ties are randomized."
      },
      {
        value: "oldest_played",
        label: "Longest ago",
        description: "Never-played decks first; ties are randomized."
      },
      {
        value: "color_pairing",
        label: "By color pairing",
        description: "Choose one deck from each distinct color identity."
      }
    ],
    "random-deck-picker-mode-options"
  );
  settings.append(countGroup, powerGroup, selectionGroup);

  const onlyUnwonLabel = document.createElement("label");
  onlyUnwonLabel.className = "random-deck-picker-checkbox";
  const onlyUnwon = document.createElement("input");
  onlyUnwon.type = "checkbox";
  const onlyUnwonText = document.createElement("span");
  onlyUnwonText.textContent = "Only decks that have never won";
  onlyUnwonLabel.append(onlyUnwon, onlyUnwonText);

  const hint = document.createElement("p");
  hint.className = "random-deck-picker-hint";
  hint.textContent = "Only active decks are included. Statistics use all games.";

  const status = document.createElement("p");
  status.className = "random-deck-picker-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = activeDecks.length
    ? "Loading your deck statistics..."
    : "This player has no active decks.";

  const actions = document.createElement("div");
  actions.className = "random-deck-picker-actions";
  const pickButton = document.createElement("button");
  pickButton.type = "submit";
  pickButton.textContent = "Pick decks";
  pickButton.disabled = true;
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", () => dialog.close());
  actions.append(pickButton, cancelButton);

  const results = document.createElement("div");
  results.className = "random-deck-picker-results";

  form.append(settings, onlyUnwonLabel, hint, status, actions, results);
  dialog.append(header, form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();

  if (!activeDecks.length) return;

  let statsByDeckId = null;
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!statsByDeckId) {
      status.textContent = "Deck statistics are still loading.";
      return;
    }

    const requestedCount = Number.parseInt(countInput.value, 10);
    if (!Number.isInteger(requestedCount) || requestedCount < 1) {
      status.textContent = "Choose a deck count greater than zero.";
      return;
    }

    const selectedPower = form.querySelector('input[name="pickerPower"]:checked')?.value;
    const selectionMode = form.querySelector('input[name="pickerMode"]:checked')?.value;
    if (!selectedPower || !["random", "least_played", "oldest_played", "color_pairing"].includes(selectionMode)) {
      status.textContent = "Choose a power level and selection method.";
      return;
    }

    const winsByColor = new Map();
    for (const stats of statsByDeckId.values()) {
      const colorKey = getColorIdentityKey(stats.colors);
      winsByColor.set(colorKey, (winsByColor.get(colorKey) || 0) + stats.wins);
    }

    const candidates = activeDecks
      .map(deck => {
        const stats = statsByDeckId.get(deck.id);
        return {
          ...deck,
          gamesPlayed: stats?.games_played || 0,
          wins: stats?.wins || 0,
          lastPlayedAt: stats?.last_played_at || null
        };
      })
      .filter(deck =>
        (selectedPower === "all" || deck.power_level === Number(selectedPower)) &&
        (!onlyUnwon.checked || deck.wins === 0) &&
        (selectionMode !== "color_pairing" ||
          !onlyUnwon.checked ||
          (winsByColor.get(getColorIdentityKey(deck.colors)) || 0) === 0)
      );

    const selected = selectRandomDecks(candidates, requestedCount, selectionMode);
    const matchedCount = selectionMode === "color_pairing"
      ? new Set(candidates.map(deck => getColorIdentityKey(deck.colors))).size
      : candidates.length;
    status.textContent = matchedCount
      ? `${matchedCount} ${selectionMode === "color_pairing" ? "color combination" : "deck"}${matchedCount === 1 ? "" : "s"} match your filters.`
      : "No active decks match your filters.";
    renderRandomDeckResults(results, selected, requestedCount, matchedCount, selectionMode);
    results.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  try {
    statsByDeckId = await loadLifetimeDeckStats(owner);
    if (!dialog.isConnected) return;
    status.textContent = `${activeDecks.length} active decks available.`;
    pickButton.disabled = false;
  } catch (error) {
    status.textContent = `Could not load lifetime deck statistics: ${error.message}`;
    status.classList.add("error");
  }
}

function createPickerRadioGroup(name, legendText, options, groupClass) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = `random-deck-picker-group ${groupClass}`;
  const legend = document.createElement("legend");
  legend.textContent = legendText;
  fieldset.appendChild(legend);

  const choices = document.createElement("div");
  choices.className = "random-deck-picker-choices";
  options.forEach(option => {
    const label = document.createElement("label");
    label.className = "random-deck-picker-choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;
    input.checked = Boolean(option.selected);

    const content = document.createElement("span");
    content.className = "random-deck-picker-choice-content";
    const optionLabel = document.createElement("span");
    optionLabel.className = "random-deck-picker-choice-label";
    optionLabel.textContent = option.label;
    content.appendChild(optionLabel);

    if (option.description) {
      const description = document.createElement("span");
      description.className = "random-deck-picker-choice-description";
      description.textContent = option.description;
      content.appendChild(description);
    }

    label.append(input, content);
    choices.appendChild(label);
  });
  fieldset.appendChild(choices);
  return fieldset;
}

async function loadLifetimeDeckStats(owner) {
  const response = await fetch("/api/stats?min_games=1&period=all&pod_size=all");
  if (!response.ok) {
    throw new Error(`Stats request failed with HTTP ${response.status}.`);
  }

  const data = await response.json();
  if (!data.player_profiles) {
    throw new Error("The stats response did not contain player profiles.");
  }

  const profile = data.player_profiles[owner];
  return new Map((profile?.commanders || []).map(deck => [deck.id, deck]));
}

function selectRandomDecks(candidates, requestedCount, selectionMode) {
  if (selectionMode === "random") {
    return shuffleDecks(candidates).slice(0, requestedCount);
  }

  if (selectionMode === "least_played") {
    return sortAndShuffleTies(
      candidates,
      (left, right) => left.gamesPlayed - right.gamesPlayed,
      deck => deck.gamesPlayed
    ).slice(0, requestedCount);
  }

  if (selectionMode === "oldest_played") {
    return sortAndShuffleTies(
      candidates,
      (left, right) => (left.lastPlayedAt || "").localeCompare(right.lastPlayedAt || ""),
      deck => deck.lastPlayedAt || ""
    ).slice(0, requestedCount);
  }

  if (selectionMode === "color_pairing") {
    const candidatesByColor = new Map();
    for (const deck of shuffleDecks(candidates)) {
      const colorKey = getColorIdentityKey(deck.colors);
      if (!candidatesByColor.has(colorKey)) {
        candidatesByColor.set(colorKey, deck);
      }
    }
    return shuffleDecks([...candidatesByColor.values()]).slice(0, requestedCount);
  }

  throw new Error("Choose a valid selection method.");
}

function sortAndShuffleTies(decks, compare, getTieKey) {
  const sorted = [...decks].sort(compare);
  const result = [];

  for (let start = 0; start < sorted.length;) {
    let end = start + 1;
    while (end < sorted.length && getTieKey(sorted[end]) === getTieKey(sorted[start])) {
      end++;
    }
    result.push(...shuffleDecks(sorted.slice(start, end)));
    start = end;
  }
  return result;
}

function shuffleDecks(decks) {
  const shuffled = [...decks];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function renderRandomDeckResults(container, selectedDecks, requestedCount, matchedCount, selectionMode) {
  container.replaceChildren();
  const summary = document.createElement("p");
  summary.className = "random-deck-picker-summary";
  summary.textContent = selectedDecks.length < requestedCount
    ? `Showing ${selectedDecks.length} of ${requestedCount} requested decks (${matchedCount} matched the filters).`
    : selectionMode === "color_pairing"
      ? `Selected ${selectedDecks.length} decks from different color combinations.`
      : `Randomly selected ${selectedDecks.length} ${selectedDecks.length === 1 ? "deck" : "decks"}.`;
  container.appendChild(summary);

  if (!selectedDecks.length) return;

  const list = document.createElement("div");
  list.className = "random-deck-picker-list";
  selectedDecks.forEach(deck => {
    const item = document.createElement("article");
    item.className = "random-deck-picker-result";

    const title = document.createElement("h3");
    title.textContent = deck.commander_2
      ? `${deck.commander_1} & ${deck.commander_2}`
      : deck.commander_1;

    const metadata = document.createElement("p");
    const playedDate = deck.lastPlayedAt
      ? `Last played ${formatPickerDate(deck.lastPlayedAt)}`
      : "Never played";
    metadata.textContent = `${deck.gamesPlayed} games · ${deck.wins} wins · ${playedDate}`;

    const details = document.createElement("div");
    details.className = "random-deck-picker-result-details";
    const power = document.createElement("span");
    power.innerHTML = renderPowerBadge(deck.power_level);
    const colors = document.createElement("span");
    colors.innerHTML = renderPips(deck.colors, 18);
    details.append(power, colors);

    item.append(title, metadata, details);
    list.appendChild(item);
  });
  container.appendChild(list);
}

function formatPickerDate(dateValue) {
  const parts = dateValue.slice(0, 10).split("-");
  return parts.length === 3 ? `${parts[2]}-${parts[1]}-${parts[0]}` : dateValue;
}
