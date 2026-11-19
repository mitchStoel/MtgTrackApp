import os
import sqlite3
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, jsonify, render_template, request, session
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "edh-playgroup-secret-change-me")

DB_PATH = os.environ.get("DB_PATH", "edh_tracker.db")
DEFAULT_PASSWORD = os.environ.get("POD_PASSWORD", "edh1234")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


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
        cur.execute(
            "INSERT INTO auth_config (id, password_hash) VALUES (1, ?)",
            (generate_password_hash(DEFAULT_PASSWORD),)
        )

    cur.execute("""
        CREATE TABLE IF NOT EXISTS commanders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner TEXT NOT NULL,
            commander_1 TEXT NOT NULL,
            commander_2 TEXT DEFAULT '',
            mana_cost TEXT DEFAULT '',
            power_level INTEGER DEFAULT 3
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
            FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
            FOREIGN KEY (commander_id) REFERENCES commanders(id)
        )
    """)

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
    conn.close()

    result = []
    for r in rows:
        item = dict(r)
        item["colors"] = extract_colors(item.get("mana_cost", ""))
        item["power_level"] = item.get("power_level") or 3
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

    if not owner or not cmd1:
        return jsonify({"error": "Owner en Commander Name zijn verplicht"}), 400
    if power_level < 1 or power_level > 5:
        power_level = 3

    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO commanders (owner, commander_1, commander_2, mana_cost, power_level)
        VALUES (?, ?, ?, ?, ?)
        """,
        (owner, cmd1, cmd2, mana_cost, power_level)
    )
    new_id = cur.lastrowid
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

    if not owner or not cmd1:
        return jsonify({"error": "Owner en Commander Name zijn verplicht"}), 400
    if power_level < 1 or power_level > 5:
        power_level = 3

    conn = get_db()
    existing = conn.execute("SELECT id FROM commanders WHERE id = ?", (cmd_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({"error": "Commander niet gevonden"}), 404

    conn.execute(
        """
        UPDATE commanders
        SET owner = ?, commander_1 = ?, commander_2 = ?, mana_cost = ?, power_level = ?
        WHERE id = ?
        """,
        (owner, cmd1, cmd2, mana_cost, power_level, cmd_id)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM commanders WHERE id = ?", (cmd_id,)).fetchone()
    conn.close()

    item = dict(row)
    item["colors"] = extract_colors(item.get("mana_cost", ""))
    return jsonify(item)


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
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO games (turns, played_at, win_condition) VALUES (?, ?, ?)",
        (turns, played_at, win_condition)
    )
    game_id = cur.lastrowid

    for p in participants:
        cur.execute(
            """
            INSERT INTO game_participants (game_id, commander_id, seat_order, is_winner)
            VALUES (?, ?, ?, ?)
            """,
            (
                game_id,
                int(p["commander_id"]),
                int(p["seat_order"]),
                1 if p.get("is_winner") else 0
            )
        )

    conn.commit()
    conn.close()
    return jsonify({"id": game_id}), 201


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

    cur = conn.cursor()
    cur.execute(
        "UPDATE games SET turns = ?, played_at = ?, win_condition = ? WHERE id = ?",
        (turns, played_at, win_condition, game_id)
    )
    cur.execute("DELETE FROM game_participants WHERE game_id = ?", (game_id,))

    for p in participants:
        cur.execute(
            """
            INSERT INTO game_participants (game_id, commander_id, seat_order, is_winner)
            VALUES (?, ?, ?, ?)
            """,
            (
                game_id,
                int(p["commander_id"]),
                int(p["seat_order"]),
                1 if p.get("is_winner") else 0
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

    game_ids = [g["id"] for g in games]
    participants = []
    if game_ids:
        placeholders = ",".join("?" for _ in game_ids)
        participants = conn.execute(
            f"SELECT * FROM game_participants WHERE game_id IN ({placeholders}) ORDER BY seat_order ASC",
            game_ids
        ).fetchall()
    conn.close()

    total_games = len(games)
    avg_turns = round(sum(g["turns"] for g in games) / total_games, 1) if total_games else 0
    game_turns_map = {g["id"]: g["turns"] for g in games}

    player_agg = {}
    cmd_agg = {}
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
            "commanders": {}
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

        player_profiles[owner] = {
            "owner": owner,
            "games_played": gp,
            "wins": w,
            "winrate": wr,
            "avg_win_turns": avg_wt,
            "favorite_wincon": fav_wc,
            "color_counts": p_entry["color_counts"],
            "commanders": p_cmds
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
            enriched_parts.append({
                "seat_order": p["seat_order"],
                "commander_1": c.get("commander_1", "Unknown"),
                "commander_2": c.get("commander_2", ""),
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
        "seat_stats": seat_stats,
        "wincon_stats": wincon_stats,
        "recent_games": recent_games,
        "player_profiles": player_profiles
    })


init_db()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5050, debug=True)