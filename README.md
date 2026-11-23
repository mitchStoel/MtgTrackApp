# 🌌 EDH Playgroup

Een zelf-gehoste, mobielvriendelijke webapplicatie voor het bijhouden van Magic: The Gathering Commander (EDH) potjes, decks, wincondities en uitgebreide statistieken.

## Frontend-indeling

- `templates/index.html` bevat de HTML-weergave.
- `static/css/style.css` bevat de styling.
- `static/js/state.js` en `static/js/shared-ui.js` leveren gedeelde status en weergavehulpen.
- `static/js/decks.js`, `static/js/games.js`, `static/js/stats.js`, `static/js/random-deck-picker.js` en `static/js/auth.js` bevatten de bijbehorende features.
- `static/js/bootstrap.js` start de app nadat de andere scripts geladen zijn.

De scripts worden als klassieke scripts in vaste volgorde geladen, zodat bestaande inline HTML-handlers blijven werken. De Docker-image neemt de CSS, iconen en JavaScript-bestanden expliciet op; Docker Compose blijft alleen de database persistent mounten.

## Vereisten op de Host Server
- Een standaard Linux-server (of Windows/macOS met Docker Desktop).
- **Docker Engine** (v20.10+) en **Docker Compose** (v2.0+).
- Er zijn **geen** lokale Python-, pip- of database-installaties nodig op de host.

---

## Snelstart (Nieuwe Installatie)

1. **Kopieer het `.env.example` bestand naar `.env`:**
   ```bash
   cp .env.example .env
   ```
2. **Open `.env` en stel zelf een sterk `INITIAL_PASSWORD` in.** Dit wordt alleen gebruikt bij de eerste initialisatie van een lege database. Voor een bestaande database blijft het opgeslagen wachtwoord actief; wijzig dat via de instellingen in de app.
3. **Start de applicatie:**
   ```bash
   docker compose up -d
