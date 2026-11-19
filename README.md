# 🌌 EDH Playgroup

Een zelf-gehoste, mobielvriendelijke webapplicatie voor het bijhouden van Magic: The Gathering Commander (EDH) potjes, decks, wincondities en uitgebreide statistieken.

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
