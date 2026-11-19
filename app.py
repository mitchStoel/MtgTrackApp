import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "edh-playgroup-secret-change-me")

DB_PATH = os.environ.get("DB_PATH", "mtg_tracker.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _get_table_columns(cur, table_name: str) -> set[str]:
    rows = cur.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row["name"] for row in rows}


def run_migrations(conn):
    cur = conn.cursor()

    # 1. Migraties voor 'commanders'
    cmd_cols = _get_table_columns(cur, "commanders")
    if "commander_2" not in cmd_cols:
        cur.execute("ALTER TABLE commanders ADD COLUMN commander_2 TEXT DEFAULT ''")
    if "mana_cost" not in cmd_cols:
        cur.execute("ALTER TABLE commanders ADD COLUMN mana_cost TEXT DEFAULT ''")
    if "power_level" not in cmd_cols:
        cur.execute("ALTER TABLE commanders ADD COLUMN power_level INTEGER DEFAULT 3")
    if "is_active" not in cmd_cols:
        cur.execute("ALTER TABLE commanders ADD COLUMN is_active INTEGER DEFAULT 1")
    if "is_deleted" not in cmd_cols:
        cur.execute("ALTER TABLE commanders ADD COLUMN is_deleted INTEGER DEFAULT 0")

    # 2. Migraties voor 'games' (voor het geval een oudere DB kolommen mist)
    game_cols = _get_table_columns(cur, "games")
    if "turns" not in game_cols:
        cur.execute("ALTER TABLE games ADD COLUMN turns INTEGER DEFAULT 0")
    if "played_at" not in game_cols:
        cur.execute("ALTER TABLE games ADD COLUMN played_at TEXT DEFAULT ''")
    if "win_condition" not in game_cols:
        cur.execute("ALTER TABLE games ADD COLUMN win_condition TEXT DEFAULT ''")

    # 3. Migraties voor 'game_participants'
    part_cols = _get_table_columns(cur, "game_participants")
    if "seat_order" not in part_cols:
        cur.execute("ALTER TABLE game_participants ADD COLUMN seat_order INTEGER DEFAULT 1")
    if "is_winner" not in part_cols:
        cur.execute("ALTER TABLE game_participants ADD COLUMN is_winner INTEGER DEFAULT 0")
    if "played_alternative_id" not in part_cols:
        cur.execute(
            "ALTER TABLE game_participants ADD COLUMN played_alternative_id INTEGER "
            "REFERENCES commander_alternatives(id)"
        )

    conn.commit()


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS auth_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            password_hash TEXT NOT NULL
        )
    """)

    cur.execute("SELECT id FROM auth_config WHERE id = 1")
    if not cur.fetchone():
        initial_password = os.environ.get("INITIAL_PASSWORD")
        if not initial_password:
            conn.close()
            raise RuntimeError("INITIAL_PASSWORD must be set when initializing a new database")
        cur.execute(
            "INSERT INTO auth_config (id, password_hash) VALUES (1, ?)",
            (generate_password_hash(initial_password),)
        )

    cur.execute("""
        CREATE TABLE IF NOT EXISTS commanders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            commander_1 TEXT NOT NULL,
            commander_2 TEXT DEFAULT '',
            mana_cost TEXT DEFAULT '',
            power_level INTEGER DEFAULT 2,
            is_active INTEGER DEFAULT 1,
            is_deleted INTEGER DEFAULT 0
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS commander_alternatives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            commander_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            scryfall_id TEXT NOT NULL,
            color_identity TEXT NOT NULL DEFAULT '',
            UNIQUE (commander_id, name COLLATE NOCASE),
            UNIQUE (commander_id, scryfall_id),
            FOREIGN KEY (commander_id) REFERENCES commanders(id) ON DELETE CASCADE
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS win_conditions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    """)

    default_wincons = [
        "Combat Damage",
        "Commander Damage",
        "Combo",
        "Alternate Wincon",
        "Mill / Deckout",
        "Drain / Life Loss"
    ]
    for wc in default_wincons:
        cur.execute("INSERT OR IGNORE INTO win_conditions (name) VALUES (?)", (wc,))

    cur.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            turns INTEGER NOT NULL,
            played_at TEXT NOT NULL,
            win_condition TEXT NOT NULL
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS game_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            commander_id INTEGER NOT NULL,
            seat_order INTEGER NOT NULL,
            is_winner INTEGER NOT NULL DEFAULT 0,
            played_alternative_id INTEGER,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (commander_id) REFERENCES commanders(id),
            FOREIGN KEY (played_alternative_id) REFERENCES commander_alternatives(id)
        )
    """)

    # Voer schema-aanpassingen uit op de reeds bestaande database
    run_migrations(conn)

    conn.commit()
    conn.close()


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("authenticated"):
            return jsonify({"error": "Niet ingelogd"}), 401
        return fn(*args, **kwargs)
    return wrapper


def extract_colors(mana_cost: str) -> list[str]:
    text = (mana_cost or "").upper()
    ordered = ["W", "U", "B", "R", "G"]
    found = [c for c in ordered if c in text]
    return found if found else ["C"]


def _commander_combination_exists(conn, owner, cmd1, cmd2, exclude_id=None):
    query = """
        SELECT 1
        FROM commanders
        WHERE TRIM(owner) = ? COLLATE NOCASE
          AND (
            (TRIM(commander_1) = ? COLLATE NOCASE
             AND TRIM(COALESCE(commander_2, '')) = ? COLLATE NOCASE)
            OR
            (TRIM(commander_1) = ? COLLATE NOCASE
             AND TRIM(COALESCE(commander_2, '')) = ? COLLATE NOCASE)
          )
    """
    params = [owner, cmd1, cmd2, cmd2, cmd1]
    if exclude_id is not None:
        query += " AND id != ?"
        params.append(exclude_id)
    return conn.execute(query + " LIMIT 1", params).fetchone() is not None


class CommanderAlternativeError(ValueError):
    def __init__(self, message, status_code=400):
        super().__init__(message)
        self.status_code = status_code


def _sync_commander_alternatives(conn, commander_id, alternatives, mana_cost, main_names):
    if not isinstance(alternatives, list):
        raise CommanderAlternativeError("Alternatieve commanders moeten een lijst zijn")

    color_order = ("W", "U", "B", "R", "G")
    deck_identity = set(extract_colors(mana_cost)) - {"C"}
    main_names = {name.strip().casefold() for name in main_names if name.strip()}
    existing_rows = conn.execute(
        "SELECT id, name, scryfall_id, color_identity FROM commander_alternatives WHERE commander_id = ?",
        (commander_id,)
    ).fetchall()
    existing = {row["id"]: dict(row) for row in existing_rows}

    retained_ids = set()
    additions = []
    seen_names = set()
    seen_scryfall_ids = set()

    for alternative in alternatives:
        if not isinstance(alternative, dict):
            raise CommanderAlternativeError("Ongeldige alternative commander")

        raw_name = alternative.get("name")
        raw_scryfall_id = alternative.get("scryfall_id")
        identity = alternative.get("color_identity")
        if (
            not isinstance(raw_name, str)
            or not isinstance(raw_scryfall_id, str)
            or not isinstance(identity, list)
            or not all(isinstance(color, str) for color in identity)
        ):
            raise CommanderAlternativeError("Naam, Scryfall-id en kleuridentiteit zijn verplicht")
        name = raw_name.strip()
        scryfall_id = raw_scryfall_id.strip()
        if not name or not scryfall_id:
            raise CommanderAlternativeError("Naam, Scryfall-id en kleuridentiteit zijn verplicht")

        identity_set = set(identity)
        if not identity_set.issubset(set(color_order)):
            raise CommanderAlternativeError("Ongeldige kleuridentiteit")
        if not identity_set.issubset(deck_identity):
            raise CommanderAlternativeError(
                f"{name} past niet binnen de kleuridentiteit van dit deck"
            )

        normalized_name = name.casefold()
        normalized_scryfall_id = scryfall_id.casefold()
        if normalized_name in main_names:
            raise CommanderAlternativeError(
                f"{name} is al de hoofdcommander van dit deck"
            )
        if normalized_name in seen_names or normalized_scryfall_id in seen_scryfall_ids:
            raise CommanderAlternativeError(f"{name} staat al bij de alternatieven")
        seen_names.add(normalized_name)
        seen_scryfall_ids.add(normalized_scryfall_id)

        color_identity = "".join(color for color in color_order if color in identity_set)
        alternative_id = alternative.get("id")
        if alternative_id is None:
            additions.append((name, scryfall_id, color_identity))
            continue

        try:
            alternative_id = int(alternative_id)
        except (TypeError, ValueError):
            raise CommanderAlternativeError("Ongeldig alternative commander-id")

        stored = existing.get(alternative_id)
        if not stored:
            raise CommanderAlternativeError("Alternative commander hoort niet bij dit deck")
        if (
            stored["name"] != name
            or stored["scryfall_id"] != scryfall_id
            or stored["color_identity"] != color_identity
        ):
            raise CommanderAlternativeError(
                "Een opgeslagen alternative commander kan niet worden vervangen"
            )
        retained_ids.add(alternative_id)

    for alternative_id in existing.keys() - retained_ids:
        stored = existing[alternative_id]
        games_count = conn.execute(
            "SELECT COUNT(*) FROM game_participants WHERE played_alternative_id = ?",
            (alternative_id,)
        ).fetchone()[0]
        if games_count:
            raise CommanderAlternativeError(
                f"{stored['name']} is in games gebruikt en kan daarom niet worden verwijderd",
                409
            )

    for alternative_id in existing.keys() - retained_ids:
        conn.execute(
            "DELETE FROM commander_alternatives WHERE id = ?",
            (alternative_id,)
        )
    for name, scryfall_id, color_identity in additions:
        conn.execute(
            """
            INSERT INTO commander_alternatives
                (commander_id, name, scryfall_id, color_identity)
            VALUES (?, ?, ?, ?)
            """,
            (commander_id, name, scryfall_id, color_identity)
        )


def get_period_cutoff(period: str) -> str | None:
    now = datetime.now()
    if period == "30d":
        return (now - timedelta(days=30)).strftime("%Y-%m-%d")
    if period == "90d":
        return (now - timedelta(days=90)).strftime("%Y-%m-%d")
    if period == "year":
        return f"{now.year}-01-01"
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth/status")
def auth_status():
    return jsonify({"logged_in": bool(session.get("authenticated"))})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    password = data.get("password", "")

    conn = get_db()
    row = conn.execute("SELECT password_hash FROM auth_config WHERE id = 1").fetchone()
    conn.close()

    if row and check_password_hash(row["password_hash"], password):
        session["authenticated"] = True
        return jsonify({"ok": True})
    return jsonify({"error": "Onjuist wachtwoord"}), 401


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/change_password", methods=["PUT"])
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    current_pw = data.get("current_password", "")
    new_pw = data.get("new_password", "")

    if len(new_pw) < 4:
        return jsonify({"error": "Nieuw wachtwoord moet minimaal 4 tekens bevatten"}), 400

    conn = get_db()
    row = conn.execute("SELECT password_hash FROM auth_config WHERE id = 1").fetchone()
    if not row or not check_password_hash(row["password_hash"], current_pw):
        conn.close()
        return jsonify({"error": "Huidig wachtwoord klopt niet"}), 400

    conn.execute(
        "UPDATE auth_config SET password_hash = ? WHERE id = 1",
        (generate_password_hash(new_pw),)
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/commanders", methods=["GET"])
def get_commanders():
    conn = get_db()
    rows = conn.execute("SELECT * FROM commanders ORDER BY id DESC").fetchall()
    alternative_rows = conn.execute(
        "SELECT * FROM commander_alternatives ORDER BY name COLLATE NOCASE ASC"
    ).fetchall()
    conn.close()

    alternatives_by_commander = {}
    for row in alternative_rows:
        alternative = dict(row)
        alternative["color_identity"] = list(alternative["color_identity"])
        alternatives_by_commander.setdefault(row["commander_id"], []).append(alternative)

    result = []
    for r in rows:
        item = dict(r)
        item["colors"] = extract_colors(item.get("mana_cost", ""))
        item["power_level"] = item.get("power_level") or 3
        item["is_active"] = 1 if item.get("is_active") is None else int(item["is_active"])
        item["is_deleted"] = 1 if item.get("is_deleted") is None else int(item["is_deleted"])
        item["alternatives"] = alternatives_by_commander.get(item["id"], [])
        result.append(item)
    return jsonify(result)


@app.route("/api/commanders", methods=["POST"])
@login_required
def create_commander():
    data = request.get_json(silent=True) or {}
    owner = (data.get("owner") or "").strip()
    cmd1 = (data.get("commander_1") or "").strip()
    cmd2 = (data.get("commander_2") or "").strip()
    mana_cost = (data.get("mana_cost") or "").strip()
    power_level = int(data.get("power_level") or 3)
    is_active = 1 if data.get("is_active", True) else 0
    alternatives = data.get("alternatives", [])
    

    if not owner or not cmd1:
        return jsonify({"error": "Owner en Commander Name zijn verplicht"}), 400
    if power_level < 1 or power_level > 5:
        power_level = 3

    conn = get_db()
    if _commander_combination_exists(conn, owner, cmd1, cmd2):
        conn.close()
        return jsonify({"error": "Deze speler heeft deze commandercombinatie al geregistreerd"}), 409

    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO commanders (owner, commander_1, commander_2, mana_cost, power_level)
        VALUES (?, ?, ?, ?, ?)
        """,
        (owner, cmd1, cmd2, mana_cost, power_level)
    )
    new_id = cur.lastrowid
    try:
        _sync_commander_alternatives(
            conn, new_id, alternatives, mana_cost, [cmd1, cmd2]
        )
    except CommanderAlternativeError as err:
        conn.rollback()
        conn.close()
        return jsonify({"error": str(err)}), err.status_code
    conn.commit()
    row = conn.execute("SELECT * FROM commanders WHERE id = ?", (new_id,)).fetchone()
    conn.close()

    item = dict(row)
    item["colors"] = extract_colors(item.get("mana_cost", ""))
    return jsonify(item), 201


@app.route("/api/commanders/<int:cmd_id>", methods=["PUT"])
@login_required
def update_commander(cmd_id):
    data = request.get_json(silent=True) or {}
    owner = (data.get("owner") or "").strip()
    cmd1 = (data.get("commander_1") or "").strip()
    cmd2 = (data.get("commander_2") or "").strip()
    mana_cost = (data.get("mana_cost") or "").strip()
    power_level = int(data.get("power_level") or 3)
    is_active = 1 if data.get("is_active", True) else 0
    alternatives = data.get("alternatives")

    if not owner or not cmd1:
        return jsonify({"error": "Owner en Commander Name zijn verplicht"}), 400
    if power_level < 1 or power_level > 5:
        power_level = 3

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM commanders WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (cmd_id,)
    ).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Commander niet gevonden"}), 404

    if _commander_combination_exists(conn, owner, cmd1, cmd2, exclude_id=cmd_id):
        conn.close()
        return jsonify({"error": "Deze speler heeft deze commandercombinatie al geregistreerd"}), 409

    conn.execute(
        """
        UPDATE commanders
        SET owner = ?, commander_1 = ?, commander_2 = ?, mana_cost = ?, power_level = ?, is_active = ?
        WHERE id = ?
        """,
        (owner, cmd1, cmd2, mana_cost, power_level, is_active, cmd_id)
    )
    if "alternatives" in data:
        try:
            _sync_commander_alternatives(
                conn, cmd_id, alternatives, mana_cost, [cmd1, cmd2]
            )
        except CommanderAlternativeError as err:
            conn.rollback()
            conn.close()
            return jsonify({"error": str(err)}), err.status_code
    conn.commit()
    row = conn.execute("SELECT * FROM commanders WHERE id = ?", (cmd_id,)).fetchone()
    conn.close()

    item = dict(row)
    item["colors"] = extract_colors(item.get("mana_cost", ""))
    return jsonify(item)


@app.route("/api/commanders/<int:cmd_id>/usage", methods=["GET"])
@login_required
def get_commander_usage(cmd_id):
    conn = get_db()
    commander = conn.execute(
        "SELECT id FROM commanders WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (cmd_id,)
    ).fetchone()
    if not commander:
        conn.close()
        return jsonify({"error": "Commander niet gevonden"}), 404

    row = conn.execute(
        "SELECT COUNT(DISTINCT game_id) AS games_count FROM game_participants WHERE commander_id = ?",
        (cmd_id,)
    ).fetchone()
    conn.close()
    return jsonify({"games_count": row["games_count"]})


@app.route("/api/commanders/<int:cmd_id>", methods=["DELETE"])
@login_required
def delete_commander(cmd_id):
    data = request.get_json(silent=True) or {}
    action = data.get("action")
    if action not in {"delete_with_stats", "delete_keep_stats", "inactive"}:
        return jsonify({"error": "Ongeldige verwijderactie"}), 400

    conn = get_db()
    commander = conn.execute(
        "SELECT id FROM commanders WHERE id = ? AND COALESCE(is_deleted, 0) = 0",
        (cmd_id,)
    ).fetchone()
    if not commander:
        conn.close()
        return jsonify({"error": "Commander niet gevonden"}), 404

    games_count = conn.execute(
        "SELECT COUNT(DISTINCT game_id) FROM game_participants WHERE commander_id = ?",
        (cmd_id,)
    ).fetchone()[0]

    if action == "delete_with_stats":
        conn.execute("DELETE FROM game_participants WHERE commander_id = ?", (cmd_id,))
        conn.execute("DELETE FROM commanders WHERE id = ?", (cmd_id,))
    elif action == "delete_keep_stats":
        conn.execute("UPDATE commanders SET is_deleted = 1 WHERE id = ?", (cmd_id,))
    else:
        conn.execute("UPDATE commanders SET is_active = 0 WHERE id = ?", (cmd_id,))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "games_count": games_count})


@app.route("/api/win_conditions", methods=["GET"])
def get_win_conditions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM win_conditions ORDER BY name ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/win_conditions", methods=["POST"])
@login_required
def add_win_condition():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Naam is verplicht"}), 400

    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("INSERT INTO win_conditions (name) VALUES (?)", (name,))
        conn.commit()
        new_id = cur.lastrowid
        row = conn.execute("SELECT * FROM win_conditions WHERE id = ?", (new_id,)).fetchone()
        conn.close()
        return jsonify(dict(row)), 201
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Bestaat al"}), 400


@app.route("/api/win_conditions/<int:wc_id>", methods=["DELETE"])
@login_required
def delete_win_condition(wc_id):
    conn = get_db()
    conn.execute("DELETE FROM win_conditions WHERE id = ?", (wc_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/games/<int:game_id>", methods=["GET"])
def get_game(game_id):
    conn = get_db()
    game = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
    if not game:
        conn.close()
        return jsonify({"error": "Spel niet gevonden"}), 404

    parts = conn.execute(
        "SELECT * FROM game_participants WHERE game_id = ? ORDER BY seat_order ASC",
        (game_id,)
    ).fetchall()
    conn.close()

    return jsonify({
        "id": game["id"],
        "turns": game["turns"],
        "played_at": game["played_at"],
        "win_condition": game["win_condition"],
        "participants": [dict(p) for p in parts]
    })


@app.route("/api/games", methods=["POST"])
@login_required
def create_game():
    data = request.get_json(silent=True) or {}
    turns = int(data.get("turns") or 0)
    played_at = (data.get("played_at") or "").strip()
    win_condition = (data.get("win_condition") or "").strip()
    participants = data.get("participants") or []

    if turns < 1 or not played_at or not win_condition or len(participants) not in (3, 4):
        return jsonify({"error": "Ongeldige spelgegevens"}), 400

    conn = get_db()
    normalized_participants, error = _normalize_game_participants(conn, participants)
    if error:
        conn.close()
        return jsonify({"error": error}), 400

    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (turns, played_at, win_condition) VALUES (?, ?, ?)",
        (turns, played_at, win_condition)
    )
    game_id = cur.lastrowid

    for p in normalized_participants:
        cur.execute(
            """
            INSERT INTO game_participants
                (game_id, commander_id, seat_order, is_winner, played_alternative_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                game_id,
                p["commander_id"],
                p["seat_order"],
                p["is_winner"],
                p["played_alternative_id"]
            )
        )

    conn.commit()
    conn.close()
    return jsonify({"id": game_id}), 201


def _normalize_game_participants(conn, participants):
    normalized = []
    for participant in participants:
        if not isinstance(participant, dict):
            return None, "Ongeldige deelnemersgegevens"
        try:
            commander_id = int(participant["commander_id"])
            seat_order = int(participant["seat_order"])
            alternative_id = participant.get("played_alternative_id")
            alternative_id = int(alternative_id) if alternative_id not in (None, "") else None
        except (KeyError, TypeError, ValueError):
            return None, "Ongeldige deelnemersgegevens"

        if alternative_id is not None:
            alternative = conn.execute(
                """
                SELECT id FROM commander_alternatives
                WHERE id = ? AND commander_id = ?
                """,
                (alternative_id, commander_id)
            ).fetchone()
            if not alternative:
                return None, "De alternative commander hoort niet bij het gekozen deck"

        normalized.append({
            "commander_id": commander_id,
            "seat_order": seat_order,
            "is_winner": 1 if participant.get("is_winner") else 0,
            "played_alternative_id": alternative_id
        })
    return normalized, None


@app.route("/api/games/<int:game_id>", methods=["PUT"])
@login_required
def update_game(game_id):
    data = request.get_json(silent=True) or {}
    turns = int(data.get("turns") or 0)
    played_at = (data.get("played_at") or "").strip()
    win_condition = (data.get("win_condition") or "").strip()
    participants = data.get("participants") or []

    if turns < 1 or not played_at or not win_condition or len(participants) not in (3, 4):
        return jsonify({"error": "Ongeldige spelgegevens"}), 400

    conn = get_db()
    existing = conn.execute("SELECT id FROM games WHERE id = ?", (game_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Spel niet gevonden"}), 404

    normalized_participants, error = _normalize_game_participants(conn, participants)
    if error:
        conn.close()
        return jsonify({"error": error}), 400

    cur = conn.cursor()
    cur.execute(
        "UPDATE games SET turns = ?, played_at = ?, win_condition = ? WHERE id = ?",
        (turns, played_at, win_condition, game_id)
    )
    cur.execute("DELETE FROM game_participants WHERE game_id = ?", (game_id,))

    for p in normalized_participants:
        cur.execute(
            """
            INSERT INTO game_participants
                (game_id, commander_id, seat_order, is_winner, played_alternative_id)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                game_id,
                p["commander_id"],
                p["seat_order"],
                p["is_winner"],
                p["played_alternative_id"]
            )
        )

    conn.commit()
    conn.close()
    return jsonify({"id": game_id})


@app.route("/api/games/<int:game_id>", methods=["DELETE"])
@login_required
def delete_game(game_id):
    conn = get_db()
    conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/stats")
def get_stats():
    min_games = max(1, int(request.args.get("min_games") or 1))
    period = request.args.get("period") or "all"
    cutoff = get_period_cutoff(period)
    
    conn = get_db()
    if cutoff:
        games = conn.execute(
            "SELECT * FROM games WHERE played_at >= ? ORDER BY played_at DESC, id DESC",
            (cutoff,)
        ).fetchall()
    else:
        games = conn.execute("SELECT * FROM games ORDER BY played_at DESC, id DESC").fetchall()

    cmd_rows = conn.execute("SELECT * FROM commanders").fetchall()
    cmd_map = {r["id"]: dict(r) for r in cmd_rows}
    alternative_rows = conn.execute("SELECT * FROM commander_alternatives").fetchall()
    alternative_map = {r["id"]: dict(r) for r in alternative_rows}

    game_ids = [g["id"] for g in games]
    all_participants = []
    if game_ids:
        placeholders = ",".join("?" for _ in game_ids)
        all_participants = conn.execute(
            f"SELECT * FROM game_participants WHERE game_id IN ({placeholders}) ORDER BY seat_order ASC",
            game_ids
        ).fetchall()
    conn.close()

    pod_size = request.args.get("pod_size") or "all"
    raw_parts_by_game = {}
    for p in all_participants:
        raw_parts_by_game.setdefault(p["game_id"], []).append(dict(p))

    if pod_size in ("3", "4"):
        target_size = int(pod_size)
        games = [g for g in games if len(raw_parts_by_game.get(g["id"], [])) == target_size]

    game_ids = [g["id"] for g in games]
    valid_game_set = set(game_ids)
    participants = [p for p in all_participants if p["game_id"] in valid_game_set]

    total_games = len(games)
    avg_turns = round(sum(g["turns"] for g in games) / total_games, 1) if total_games else 0
    game_turns_map = {g["id"]: g["turns"] for g in games}

    owner_registered_identities = {}
    for c in cmd_map.values():
        if c.get("is_deleted"):
            continue
        owner = c["owner"]
        id_key = "".join(extract_colors(c.get("mana_cost", "")))
        is_act = 1 if c.get("is_active") is None else int(c["is_active"])
        entry = owner_registered_identities.setdefault(owner, {
            "active": set(),
            "inactive": set(),
            "active_counts": {},
            "inactive_counts": {}
        })
        if is_act == 1:
            entry["active"].add(id_key)
            entry["active_counts"][id_key] = entry["active_counts"].get(id_key, 0) + 1
        else:
            entry["inactive"].add(id_key)
            entry["inactive_counts"][id_key] = entry["inactive_counts"].get(id_key, 0) + 1

    total_games = len(games)
    avg_turns = round(sum(g["turns"] for g in games) / total_games, 1) if total_games else 0
    game_turns_map = {g["id"]: g["turns"] for g in games}

    player_agg = {}
    cmd_agg = {}
    actual_commander_agg = {}
    seat_agg = {s: {"seat_order": s, "games": 0, "wins": 0} for s in range(1, 5)}
    wincon_agg = {}

    for g in games:
        wc = g["win_condition"]
        wincon_agg[wc] = wincon_agg.get(wc, 0) + 1

    parts_by_game = {gid: [] for gid in game_ids}
    for p in participants:
        parts_by_game.setdefault(p["game_id"], []).append(dict(p))
        c = cmd_map.get(p["commander_id"])
        if not c:
            continue

        owner = c["owner"]
        is_win = bool(p["is_winner"])
        seat = p["seat_order"]
        turns = game_turns_map.get(p["game_id"], 0)

        p_entry = player_agg.setdefault(owner, {
            "owner": owner,
            "games_played": 0,
            "wins": 0,
            "win_turns": [],
            "wincons": {},
            "color_counts": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0},
            "commanders": {},
            "actual_commanders": {}
        })
        p_entry["games_played"] += 1
        if is_win:
            p_entry["wins"] += 1
            p_entry["win_turns"].append(turns)
            g_obj = next((g for g in games if g["id"] == p["game_id"]), None)
            if g_obj:
                wc = g_obj["win_condition"]
                p_entry["wincons"][wc] = p_entry["wincons"].get(wc, 0) + 1

        colors = extract_colors(c.get("mana_cost", ""))
        for col in colors:
            p_entry["color_counts"][col] = p_entry["color_counts"].get(col, 0) + 1

        disp_name = f"{c['commander_1']} & {c['commander_2']}" if c["commander_2"] else c["commander_1"]
        played_alternative_id = p["played_alternative_id"]
        alternative = alternative_map.get(played_alternative_id)
        if alternative and alternative["commander_id"] == c["id"]:
            actual_name = alternative["name"]
            actual_alternative_id = alternative["id"]
        else:
            actual_name = disp_name
            actual_alternative_id = None

        c_entry = cmd_agg.setdefault(c["id"], {
            "id": c["id"],
            "display_name": disp_name,
            "owner": owner,
            "power_level": c.get("power_level") or 3,
            "colors": colors,
            "games_played": 0,
            "wins": 0
        })
        c_entry["games_played"] += 1
        if is_win:
            c_entry["wins"] += 1

        pc_entry = p_entry["commanders"].setdefault(c["id"], {
            "id": c["id"],
            "display_name": disp_name,
            "power_level": c.get("power_level") or 3,
            "colors": colors,
            "games_played": 0,
            "wins": 0
        })
        pc_entry["games_played"] += 1
        if is_win:
            pc_entry["wins"] += 1

        actual_key = actual_alternative_id or 0
        actual_entry = p_entry["actual_commanders"].setdefault(actual_key, {
            "deck_id": c["id"],
            "deck_name": disp_name,
            "actual_commander": actual_name,
            "games_played": 0,
            "wins": 0
        })
        actual_entry["games_played"] += 1
        if is_win:
            actual_entry["wins"] += 1

        global_actual_entry = actual_commander_agg.setdefault(
            (c["id"], actual_key),
            {
                "deck_id": c["id"],
                "deck_name": disp_name,
                "owner": owner,
                "actual_commander": actual_name,
                "games_played": 0,
                "wins": 0
            }
        )
        global_actual_entry["games_played"] += 1
        if is_win:
            global_actual_entry["wins"] += 1

        if seat in seat_agg:
            seat_agg[seat]["games"] += 1
            if is_win:
                seat_agg[seat]["wins"] += 1

    player_stats = []
    player_profiles = {}
    for owner, p_entry in player_agg.items():
        gp = p_entry["games_played"]
        w = p_entry["wins"]
        wr = round((w / gp) * 100, 1) if gp else 0
        player_stats.append({
            "owner": owner,
            "games_played": gp,
            "wins": w,
            "winrate": wr
        })

        avg_wt = round(sum(p_entry["win_turns"]) / len(p_entry["win_turns"]), 1) if p_entry["win_turns"] else None
        fav_wc = max(p_entry["wincons"].items(), key=lambda x: x[1])[0] if p_entry["wincons"] else "-"

        p_cmds = []
        for pc in p_entry["commanders"].values():
            pc_wr = round((pc["wins"] / pc["games_played"]) * 100, 1) if pc["games_played"] else 0
            p_cmds.append({**pc, "winrate": pc_wr})

        actual_commanders = []
        for actual in p_entry["actual_commanders"].values():
            actual_wr = round((actual["wins"] / actual["games_played"]) * 100, 1)
            actual_commanders.append({**actual, "winrate": actual_wr})
        actual_commanders.sort(
            key=lambda item: (-item["games_played"], -item["wins"], item["deck_name"], item["actual_commander"])
        )
        
        id_info = owner_registered_identities.get(owner, {
            "active": set(),
            "inactive": set(),
            "active_counts": {},
            "inactive_counts": {}
        })
        player_profiles[owner] = {
            "owner": owner,
            "games_played": gp,
            "wins": w,
            "winrate": wr,
            "avg_win_turns": avg_wt,
            "favorite_wincon": fav_wc,
            "color_counts": p_entry["color_counts"],
            "active_identities": sorted(id_info["active"]),
            "inactive_identities": sorted(id_info["inactive"] - id_info["active"]),
            "active_identity_counts": id_info["active_counts"],
            "inactive_identity_counts": id_info["inactive_counts"],
            "commanders": p_cmds,
            "actual_commanders": actual_commanders
        }

    player_stats.sort(key=lambda x: (-x["winrate"], -x["wins"], x["owner"]))

    all_cmds = []
    for c_entry in cmd_agg.values():
        wr = round((c_entry["wins"] / c_entry["games_played"]) * 100, 1) if c_entry["games_played"] else 0
        all_cmds.append({**c_entry, "winrate": wr})

    top_played = sorted(all_cmds, key=lambda x: (-x["games_played"], -x["wins"]))[:5]
    top_winrate = sorted(
        [c for c in all_cmds if c["games_played"] >= min_games],
        key=lambda x: (-x["winrate"], -x["wins"], -x["games_played"])
    )[:5]

    actual_commander_stats = []
    for actual in actual_commander_agg.values():
        actual_wr = round((actual["wins"] / actual["games_played"]) * 100, 1)
        actual_commander_stats.append({**actual, "winrate": actual_wr})
    actual_commander_stats.sort(
        key=lambda item: (-item["games_played"], -item["wins"], item["owner"], item["deck_name"])
    )

    seat_stats = []
    for s in range(1, 5):
        s_entry = seat_agg[s]
        wr = round((s_entry["wins"] / s_entry["games"]) * 100, 1) if s_entry["games"] else 0
        seat_stats.append({**s_entry, "winrate": wr})

    wincon_stats = [
        {"win_condition": k, "count": v}
        for k, v in sorted(wincon_agg.items(), key=lambda x: -x[1])
    ]

    recent_games = []
    for g in games[:10]:
        enriched_parts = []
        for p in parts_by_game.get(g["id"], []):
            c = cmd_map.get(p["commander_id"], {})
            alternative = alternative_map.get(p["played_alternative_id"])
            is_alternative = bool(alternative and alternative["commander_id"] == p["commander_id"])
            enriched_parts.append({
                "seat_order": p["seat_order"],
                "commander_1": c.get("commander_1", "Unknown"),
                "commander_2": c.get("commander_2", ""),
                "played_commander": alternative["name"] if is_alternative else None,
                "is_alternative": is_alternative,
                "owner": c.get("owner", "Unknown"),
                "is_winner": p["is_winner"]
            })
        recent_games.append({
            "id": g["id"],
            "played_date": g["played_at"],
            "turns": g["turns"],
            "win_condition": g["win_condition"],
            "participants": enriched_parts
        })

    return jsonify({
        "total_games": total_games,
        "avg_turns": avg_turns,
        "player_stats": player_stats,
        "top_played": top_played,
        "top_winrate": top_winrate,
        "actual_commander_stats": actual_commander_stats,
        "seat_stats": seat_stats,
        "wincon_stats": wincon_stats,
        "recent_games": recent_games,
        "player_profiles": player_profiles
    })


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)