import os
import sqlite3
import socket
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, session

app = Flask(__name__)

# Lees configuratie en secrets uit environment variables
app.secret_key = os.environ.get("SECRET_KEY", "dev_fallback_secret_key_change_me")
DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "mtg_tracker.db")
)
INITIAL_PASSWORD = os.environ.get("INITIAL_PASSWORD", "commander123")


def get_db():
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)

    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn


def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS commanders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            commander_1 TEXT NOT NULL,
            commander_2 TEXT DEFAULT '',
            mana_cost TEXT NOT NULL,
            power_level INTEGER NOT NULL DEFAULT 3
        )
    """)

    # Veilige migratie voor bestaande databases zonder power_level kolom
    columns = [row["name"] for row in c.execute("PRAGMA table_info(commanders)").fetchall()]
    if "power_level" not in columns:
        c.execute("ALTER TABLE commanders ADD COLUMN power_level INTEGER NOT NULL DEFAULT 3")

    c.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            turns INTEGER NOT NULL,
            win_condition TEXT NOT NULL,
            played_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS game_participants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id INTEGER NOT NULL,
            commander_id INTEGER NOT NULL,
            seat_order INTEGER NOT NULL,
            is_winner INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (commander_id) REFERENCES commanders(id)
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS win_conditions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
    """)

    c.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)

    c.execute("SELECT value FROM settings WHERE key = 'password'")
    if not c.fetchone():
        c.execute("INSERT INTO settings (key, value) VALUES ('password', ?)", (INITIAL_PASSWORD,))

    c.execute("SELECT COUNT(*) FROM win_conditions")
    if c.fetchone()[0] == 0:
        defaults = [
            "Combat Damage",
            "Infinite / Non-Combat Combo",
            "Commander Damage",
            "Alternate Wincon",
            "Mill / Deck Out",
            "Burn / Drain",
            "Concession"
        ]
        c.executemany("INSERT INTO win_conditions (name) VALUES (?)", [(d,) for d in defaults])

    conn.commit()
    conn.close()


# Voer database-initialisatie direct uit bij laden van de module
init_db()


def parse_colors(mana_cost):
    colors = set()
    upper_cost = mana_cost.upper()
    for char in ["W", "U", "B", "R", "G"]:
        if char in upper_cost:
            colors.add(char)
    return list(colors) if colors else ["C"]


def parse_power_level(val):
    try:
        lvl = int(val)
        return max(1, min(5, lvl))
    except (TypeError, ValueError):
        return 3


def get_cutoff_date(period):
    now = datetime.now()
    if period == "30d":
        return (now - timedelta(days=30)).strftime("%Y-%m-%d")
    elif period == "90d":
        return (now - timedelta(days=90)).strftime("%Y-%m-%d")
    elif period == "year":
        return f"{now.year}-01-01"
    return None


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/auth/status", methods=["GET"])
def auth_status():
    return jsonify({"logged_in": session.get("authenticated", False)})


@app.route("/api/auth/login", methods=["POST"])
def login():
    data = request.json or {}
    password = data.get("password", "")
    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = 'password'").fetchone()
    conn.close()
    stored_password = row["value"] if row else INITIAL_PASSWORD

    if password == stored_password:
        session["authenticated"] = True
        return jsonify({"status": "ok"})
    else:
        return jsonify({"error": "Onjuist wachtwoord."}), 401


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.pop("authenticated", None)
    return jsonify({"status": "ok"})


@app.route("/api/auth/change_password", methods=["PUT"])
def change_password():
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    data = request.json or {}
    current_pw = data.get("current_password", "")
    new_pw = data.get("new_password", "").strip()

    if not new_pw:
        return jsonify({"error": "Nieuw wachtwoord mag niet leeg zijn."}), 400

    conn = get_db()
    row = conn.execute("SELECT value FROM settings WHERE key = 'password'").fetchone()
    stored_password = row["value"] if row else INITIAL_PASSWORD

    if current_pw != stored_password:
        conn.close()
        return jsonify({"error": "Huidige wachtwoord is onjuist."}), 400

    conn.execute("UPDATE settings SET value = ? WHERE key = 'password'", (new_pw,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/commanders", methods=["GET"])
def get_commanders():
    conn = get_db()
    rows = conn.execute("SELECT * FROM commanders ORDER BY owner ASC, commander_1 ASC").fetchall()
    conn.close()
    result = []
    for r in rows:
        item = dict(r)
        item["colors"] = parse_colors(item["mana_cost"])
        item["power_level"] = parse_power_level(item.get("power_level", 3))
        result.append(item)
    return jsonify(result)


@app.route("/api/commanders", methods=["POST"])
def add_commander():
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    data = request.json or {}
    owner = data.get("owner", "").strip()
    cmd1 = data.get("commander_1", "").strip()
    cmd2 = data.get("commander_2", "").strip()
    mana_cost = data.get("mana_cost", "").strip()
    power_level = parse_power_level(data.get("power_level", 3))

    if not owner or not cmd1 or not mana_cost:
        return jsonify({"error": "Owner, primary commander, and mana cost are required."}), 400

    conn = get_db()
    conn.execute(
        "INSERT INTO commanders (owner, commander_1, commander_2, mana_cost, power_level) VALUES (?, ?, ?, ?, ?)",
        (owner, cmd1, cmd2, mana_cost, power_level)
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"}), 201


@app.route("/api/commanders/<int:cmd_id>", methods=["PUT"])
def update_commander(cmd_id):
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    data = request.json or {}
    owner = data.get("owner", "").strip()
    cmd1 = data.get("commander_1", "").strip()
    cmd2 = data.get("commander_2", "").strip()
    mana_cost = data.get("mana_cost", "").strip()
    power_level = parse_power_level(data.get("power_level", 3))

    if not owner or not cmd1 or not mana_cost:
        return jsonify({"error": "Owner, primary commander, and mana cost are required."}), 400

    conn = get_db()
    conn.execute(
        """UPDATE commanders
           SET owner = ?, commander_1 = ?, commander_2 = ?, mana_cost = ?, power_level = ?
           WHERE id = ?""",
        (owner, cmd1, cmd2, mana_cost, power_level, cmd_id)
    )
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/win_conditions", methods=["GET"])
def get_win_conditions():
    conn = get_db()
    rows = conn.execute("SELECT * FROM win_conditions ORDER BY id ASC").fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/win_conditions", methods=["POST"])
def add_win_condition():
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    name = (request.json or {}).get("name", "").strip()
    if not name:
        return jsonify({"error": "Name required"}), 400
    conn = get_db()
    try:
        conn.execute("INSERT INTO win_conditions (name) VALUES (?)", (name,))
        conn.commit()
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({"error": "Already exists"}), 400
    conn.close()
    return jsonify({"status": "ok"}), 201


@app.route("/api/win_conditions/<int:wc_id>", methods=["DELETE"])
def delete_win_condition(wc_id):
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    conn = get_db()
    conn.execute("DELETE FROM win_conditions WHERE id = ?", (wc_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/games", methods=["POST"])
def log_game():
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    data = request.json or {}
    turns = data.get("turns")
    win_condition = data.get("win_condition", "").strip()
    played_at = data.get("played_at", "").strip()
    participants = data.get("participants", [])

    if not turns or int(turns) < 1:
        return jsonify({"error": "Valid turn count required."}), 400
    if len(participants) not in (3, 4):
        return jsonify({"error": "Games must have 3 or 4 players."}), 400

    winners = [p for p in participants if p.get("is_winner")]
    if len(winners) != 1:
        return jsonify({"error": "Exactly one winner must be selected."}), 400

    if not played_at:
        played_at = datetime.now().strftime("%Y-%m-%d")

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (turns, win_condition, played_at) VALUES (?, ?, ?)",
        (int(turns), win_condition, played_at)
    )
    game_id = cur.lastrowid

    for p in participants:
        cur.execute(
            """INSERT INTO game_participants (game_id, commander_id, seat_order, is_winner)
               VALUES (?, ?, ?, ?)""",
            (game_id, int(p["commander_id"]), int(p["seat_order"]), 1 if p["is_winner"] else 0)
        )

    conn.commit()
    conn.close()
    return jsonify({"status": "ok", "game_id": game_id}), 201


@app.route("/api/games/<int:game_id>", methods=["GET"])
def get_single_game(game_id):
    conn = get_db()
    g = conn.execute(
        "SELECT id, turns, win_condition, substr(played_at, 1, 10) as played_at FROM games WHERE id = ?",
        (game_id,)
    ).fetchone()
    if not g:
        conn.close()
        return jsonify({"error": "Game not found"}), 404

    parts = conn.execute("""
        SELECT commander_id, seat_order, is_winner
        FROM game_participants
        WHERE game_id = ?
        ORDER BY seat_order ASC
    """, (game_id,)).fetchall()
    conn.close()

    return jsonify({
        "id": g["id"],
        "turns": g["turns"],
        "win_condition": g["win_condition"],
        "played_at": g["played_at"],
        "participants": [dict(p) for p in parts]
    })


@app.route("/api/games/<int:game_id>", methods=["PUT"])
def update_game(game_id):
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    data = request.json or {}
    turns = data.get("turns")
    win_condition = data.get("win_condition", "").strip()
    played_at = data.get("played_at", "").strip()
    participants = data.get("participants", [])

    if not turns or int(turns) < 1:
        return jsonify({"error": "Valid turn count required."}), 400
    if len(participants) not in (3, 4):
        return jsonify({"error": "Games must have 3 or 4 players."}), 400

    winners = [p for p in participants if p.get("is_winner")]
    if len(winners) != 1:
        return jsonify({"error": "Exactly one winner must be selected."}), 400

    if not played_at:
        played_at = datetime.now().strftime("%Y-%m-%d")

    conn = get_db()
    cur = conn.cursor()
    g = cur.execute("SELECT id FROM games WHERE id = ?", (game_id,)).fetchone()
    if not g:
        conn.close()
        return jsonify({"error": "Game not found"}), 404

    cur.execute(
        "UPDATE games SET turns = ?, win_condition = ?, played_at = ? WHERE id = ?",
        (int(turns), win_condition, played_at, game_id)
    )

    cur.execute("DELETE FROM game_participants WHERE game_id = ?", (game_id,))
    for p in participants:
        cur.execute(
            """INSERT INTO game_participants (game_id, commander_id, seat_order, is_winner)
               VALUES (?, ?, ?, ?)""",
            (game_id, int(p["commander_id"]), int(p["seat_order"]), 1 if p["is_winner"] else 0)
        )

    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/games/<int:game_id>", methods=["DELETE"])
def delete_game(game_id):
    if not session.get("authenticated", False):
        return jsonify({"error": "Niet ingelogd."}), 401

    conn = get_db()
    conn.execute("DELETE FROM game_participants WHERE game_id = ?", (game_id,))
    conn.execute("DELETE FROM games WHERE id = ?", (game_id,))
    conn.commit()
    conn.close()
    return jsonify({"status": "ok"})


@app.route("/api/stats", methods=["GET"])
def get_stats():
    min_games = int(request.args.get("min_games", 1))
    period = request.args.get("period", "all")
    cutoff = get_cutoff_date(period)

    conn = get_db()
    game_where = "WHERE substr(g.played_at, 1, 10) >= ?" if cutoff else ""
    date_params = (cutoff,) if cutoff else ()

    game_summary = conn.execute(f"""
        SELECT COUNT(*) as total_games, COALESCE(ROUND(AVG(g.turns), 1), 0) as avg_turns
        FROM games g
        {game_where}
    """, date_params).fetchone()

    player_stats = conn.execute(f"""
        SELECT
            c.owner,
            COUNT(gp.id) as games_played,
            SUM(gp.is_winner) as wins,
            ROUND(100.0 * SUM(gp.is_winner) / COUNT(gp.id), 1) as winrate
        FROM game_participants gp
        JOIN games g ON gp.game_id = g.id
        JOIN commanders c ON gp.commander_id = c.id
        {game_where}
        GROUP BY c.owner
        ORDER BY winrate DESC, wins DESC
    """, date_params).fetchall()

    if cutoff:
        cmd_stats_rows = conn.execute("""
            SELECT
                c.id,
                c.owner,
                c.commander_1,
                c.commander_2,
                c.mana_cost,
                c.power_level,
                COUNT(gp.id) as games_played,
                COALESCE(SUM(gp.is_winner), 0) as wins,
                COALESCE(ROUND(100.0 * SUM(gp.is_winner) / NULLIF(COUNT(gp.id), 0), 1), 0) as winrate
            FROM commanders c
            LEFT JOIN (
                SELECT gp.*
                FROM game_participants gp
                JOIN games g ON gp.game_id = g.id
                WHERE substr(g.played_at, 1, 10) >= ?
            ) gp ON c.id = gp.commander_id
            GROUP BY c.id
        """, (cutoff,)).fetchall()
    else:
        cmd_stats_rows = conn.execute("""
            SELECT
                c.id,
                c.owner,
                c.commander_1,
                c.commander_2,
                c.mana_cost,
                c.power_level,
                COUNT(gp.id) as games_played,
                COALESCE(SUM(gp.is_winner), 0) as wins,
                COALESCE(ROUND(100.0 * SUM(gp.is_winner) / NULLIF(COUNT(gp.id), 0), 1), 0) as winrate
            FROM commanders c
            LEFT JOIN game_participants gp ON c.id = gp.commander_id
            GROUP BY c.id
        """).fetchall()

    all_cmds = []
    for r in cmd_stats_rows:
        d = dict(r)
        d["display_name"] = f"{d['commander_1']} & {d['commander_2']}" if d["commander_2"] else d["commander_1"]
        d["colors"] = parse_colors(d["mana_cost"])
        d["power_level"] = parse_power_level(d.get("power_level", 3))
        all_cmds.append(d)

    played_cmds = [c for c in all_cmds if c["games_played"] > 0]
    top_played = sorted(played_cmds, key=lambda x: (x["games_played"], x["wins"]), reverse=True)[:5]

    qualified_cmds = [c for c in played_cmds if c["games_played"] >= min_games]
    top_winrate = sorted(qualified_cmds, key=lambda x: (x["winrate"], x["games_played"]), reverse=True)[:5]

    seat_stats = conn.execute(f"""
        SELECT
            gp.seat_order,
            COUNT(*) as games,
            SUM(gp.is_winner) as wins,
            ROUND(100.0 * SUM(gp.is_winner) / COUNT(*), 1) as winrate
        FROM game_participants gp
        JOIN games g ON gp.game_id = g.id
        {game_where}
        GROUP BY gp.seat_order
        ORDER BY gp.seat_order ASC
    """, date_params).fetchall()

    wincon_stats = conn.execute(f"""
        SELECT g.win_condition, COUNT(*) as count
        FROM games g
        {game_where}
        GROUP BY g.win_condition
        ORDER BY count DESC
    """, date_params).fetchall()

    owners = [r["owner"] for r in conn.execute("SELECT DISTINCT owner FROM commanders ORDER BY owner ASC").fetchall()]
    player_profiles = {}

    for owner in owners:
        owner_where = "WHERE c.owner = ?" + (" AND substr(g.played_at, 1, 10) >= ?" if cutoff else "")
        owner_params = (owner, cutoff) if cutoff else (owner,)

        p_games = conn.execute(f"""
            SELECT
                gp.is_winner,
                gp.seat_order,
                g.turns,
                g.win_condition,
                c.id as commander_id,
                c.commander_1,
                c.commander_2,
                c.mana_cost
            FROM game_participants gp
            JOIN games g ON gp.game_id = g.id
            JOIN commanders c ON gp.commander_id = c.id
            {owner_where}
        """, owner_params).fetchall()

        total_p_games = len(p_games)
        total_p_wins = sum(r["is_winner"] for r in p_games)
        p_winrate = round(100.0 * total_p_wins / total_p_games, 1) if total_p_games > 0 else 0.0
        avg_win_turns = round(
            sum(r["turns"] for r in p_games if r["is_winner"]) / total_p_wins, 1
        ) if total_p_wins > 0 else 0.0

        color_counts = {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0}
        if total_p_games > 0:
            for r in p_games:
                for col in parse_colors(r["mana_cost"]):
                    color_counts[col] += 1
        else:
            owner_decks = [c for c in all_cmds if c["owner"] == owner]
            for d in owner_decks:
                for col in d["colors"]:
                    color_counts[col] += 1

        wincon_counts = {}
        for r in p_games:
            if r["is_winner"]:
                wc = r["win_condition"]
                wincon_counts[wc] = wincon_counts.get(wc, 0) + 1
        fav_wincon = max(wincon_counts.items(), key=lambda x: x[1])[0] if wincon_counts else "N/A"

        owner_commanders = [c for c in all_cmds if c["owner"] == owner]
        owner_commanders.sort(key=lambda x: (x["games_played"], x["wins"]), reverse=True)

        player_profiles[owner] = {
            "owner": owner,
            "games_played": total_p_games,
            "wins": total_p_wins,
            "winrate": p_winrate,
            "avg_win_turns": avg_win_turns,
            "favorite_wincon": fav_wincon,
            "color_counts": color_counts,
            "commanders": owner_commanders
        }

    recent_rows = conn.execute(f"""
        SELECT g.id, g.turns, g.win_condition, substr(g.played_at, 1, 10) as played_date
        FROM games g
        {game_where}
        ORDER BY g.played_at DESC, g.id DESC
        LIMIT 10
    """, date_params).fetchall()

    recent_games = []
    for g in recent_rows:
        parts = conn.execute("""
            SELECT gp.seat_order, gp.is_winner, c.owner, c.commander_1, c.commander_2
            FROM game_participants gp
            JOIN commanders c ON gp.commander_id = c.id
            WHERE gp.game_id = ?
            ORDER BY gp.seat_order ASC
        """, (g["id"],)).fetchall()
        recent_games.append({
            "id": g["id"],
            "turns": g["turns"],
            "win_condition": g["win_condition"],
            "played_date": g["played_date"],
            "participants": [dict(p) for p in parts]
        })

    conn.close()
    return jsonify({
        "total_games": game_summary["total_games"],
        "avg_turns": game_summary["avg_turns"],
        "player_stats": [dict(r) for r in player_stats],
        "top_played": top_played,
        "top_winrate": top_winrate,
        "seat_stats": [dict(r) for r in seat_stats],
        "wincon_stats": [dict(r) for r in wincon_stats],
        "player_profiles": player_profiles,
        "recent_games": recent_games
    })


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


if __name__ == "__main__":
    local_ip = get_local_ip()
    print("\n====================================================")
    print(" MTG Commander Tracker is running!")
    print(" On this PC:    http://localhost:5050")
    print(f" On your Phone: http://{local_ip}:5050")
    print("====================================================\n")
    app.run(host="0.0.0.0", port=5050, debug=False)