#!/usr/bin/env python3
"""
Backend for the Honolulu Training Tracker.

- Serves the static frontend (webapp/).
- Proxies Oura readiness data using a Personal Access Token.
- Handles Strava OAuth (authorize/callback/refresh) and proxies recent activities.

Credentials come from server/config.json for local dev (gitignored), or from
environment variables in production (OURA_PERSONAL_ACCESS_TOKEN, STRAVA_CLIENT_ID,
STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI) -- config.json is never committed, so
env vars are how a hosted deploy (e.g. Render) supplies secrets. Either way the
browser never sees client secrets or access tokens directly.

Run locally:  python3 server/server.py
"""
import json
import mimetypes
import os
import re
import time
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
WEBAPP_DIR = os.path.dirname(SERVER_DIR)
CONFIG_PATH = os.path.join(SERVER_DIR, 'config.json')
TOKENS_PATH = os.environ.get('TOKENS_FILE_PATH', os.path.join(SERVER_DIR, 'tokens.json'))

OURA_API = 'https://api.ouraring.com'
STRAVA_AUTH = 'https://www.strava.com/oauth/authorize'
STRAVA_TOKEN = 'https://www.strava.com/oauth/token'
STRAVA_API = 'https://www.strava.com/api/v3'


# ---------------- small persistence helpers ----------------

def load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default


def save_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)


def load_raw_config_file():
    return load_json(CONFIG_PATH, {}) or {}


def load_config():
    """Merge server/config.json (local dev) with environment variables
    (production). Env vars win when both are present. Returns None if
    nothing at all is configured."""
    config = load_raw_config_file()
    config.setdefault('oura', {})
    config.setdefault('strava', {})
    config.setdefault('usda', {})
    config.setdefault('anthropic', {})

    env_oura_token = os.environ.get('OURA_PERSONAL_ACCESS_TOKEN')
    if env_oura_token:
        config['oura']['personal_access_token'] = env_oura_token

    for key, env_name in (
        ('client_id', 'STRAVA_CLIENT_ID'),
        ('client_secret', 'STRAVA_CLIENT_SECRET'),
        ('redirect_uri', 'STRAVA_REDIRECT_URI'),
    ):
        val = os.environ.get(env_name)
        if val:
            config['strava'][key] = val

    # Bootstrap fallback for strava_ensure_token() -- see the comment there for why.
    env_strava_refresh = os.environ.get('STRAVA_REFRESH_TOKEN')
    if env_strava_refresh:
        config['strava']['seed_refresh_token'] = env_strava_refresh

    env_usda_key = os.environ.get('USDA_API_KEY')
    if env_usda_key:
        config['usda']['api_key'] = env_usda_key

    env_anthropic_key = os.environ.get('ANTHROPIC_API_KEY')
    if env_anthropic_key:
        config['anthropic']['api_key'] = env_anthropic_key

    has_oura = bool(config['oura'].get('personal_access_token', '').strip())
    has_strava = bool(config['strava'].get('client_id'))
    has_usda = bool(config['usda'].get('api_key', '').strip())
    has_anthropic = bool(config['anthropic'].get('api_key', '').strip())
    if not has_oura and not has_strava and not has_usda and not has_anthropic:
        return None
    return config


def load_tokens():
    return load_json(TOKENS_PATH, {})


def save_tokens(tokens):
    save_json(TOKENS_PATH, tokens)


# ---------------- HTTP helpers ----------------

def http_request(url, data=None, headers=None, method=None):
    headers = headers or {}
    body = None
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers.setdefault('Content-Type', 'application/x-www-form-urlencoded')
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read().decode())


def http_request_json(url, payload, headers=None, timeout=30):
    headers = dict(headers or {})
    headers.setdefault('Content-Type', 'application/json')
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method='POST')
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


# ---------------- Oura ----------------

def oura_fetch_latest(token, endpoint):
    """Fetch the most recent entry from an Oura v2 daily_* collection.
    Returns (entry_dict_or_None, error_code_or_None)."""
    end = time.strftime('%Y-%m-%d')
    start = time.strftime('%Y-%m-%d', time.localtime(time.time() - 3 * 86400))
    url = f'{OURA_API}/v2/usercollection/{endpoint}?start_date={start}&end_date={end}'
    try:
        data = http_request(url, headers={'Authorization': f'Bearer {token}'})
    except urllib.error.HTTPError as e:
        return None, ('unauthorized' if e.code == 401 else f'http_{e.code}')
    except Exception:
        return None, 'network'
    entries = data.get('data', [])
    if not entries:
        return None, 'no_data'
    return sorted(entries, key=lambda e: e['day'])[-1], None


def oura_get_readiness(config):
    token = (config.get('oura') or {}).get('personal_access_token', '').strip()
    if not token:
        return {'connected': False}
    entry, error = oura_fetch_latest(token, 'daily_readiness')
    if error:
        return {'connected': True, 'error': error}
    return {'connected': True, 'score': entry.get('score'), 'day': entry.get('day')}


def oura_get_summary(config):
    """Readiness + sleep + activity (which includes step count) in one call."""
    token = (config.get('oura') or {}).get('personal_access_token', '').strip()
    if not token:
        return {'connected': False}

    readiness, r_err = oura_fetch_latest(token, 'daily_readiness')
    sleep, s_err = oura_fetch_latest(token, 'daily_sleep')
    activity, a_err = oura_fetch_latest(token, 'daily_activity')

    if 'unauthorized' in (r_err, s_err, a_err):
        return {'connected': True, 'error': 'unauthorized'}

    result = {'connected': True}
    if readiness:
        result['readiness'] = {'score': readiness.get('score'), 'day': readiness.get('day')}
    if sleep:
        result['sleep'] = {'score': sleep.get('score'), 'day': sleep.get('day')}
    if activity:
        result['activity'] = {
            'score': activity.get('score'),
            'steps': activity.get('steps'),
            'day': activity.get('day'),
        }
    if not any(k in result for k in ('readiness', 'sleep', 'activity')):
        return {'connected': True, 'error': 'no_data'}
    return result


# ---------------- Strava ----------------

def strava_authorize_url(config):
    s = config['strava']
    params = {
        'client_id': s['client_id'],
        'redirect_uri': s['redirect_uri'],
        'response_type': 'code',
        'approval_prompt': 'auto',
        'scope': 'activity:read_all',
    }
    return f'{STRAVA_AUTH}?{urllib.parse.urlencode(params)}'


def strava_exchange_code(config, code):
    s = config['strava']
    data = http_request(STRAVA_TOKEN, data={
        'client_id': s['client_id'],
        'client_secret': s['client_secret'],
        'code': code,
        'grant_type': 'authorization_code',
    })
    tokens = load_tokens()
    tokens['strava'] = {
        'access_token': data['access_token'],
        'refresh_token': data['refresh_token'],
        'expires_at': data['expires_at'],
        'athlete_id': (data.get('athlete') or {}).get('id'),
    }
    save_tokens(tokens)
    # tokens.json lives on local disk, which most hosts (e.g. Render's free
    # plan) wipe on every redeploy -- print the refresh token so it can be
    # copied into a STRAVA_REFRESH_TOKEN env var once, letting
    # strava_ensure_token() self-heal after a redeploy instead of silently
    # showing "disconnected" until someone notices and reconnects by hand.
    print(f"[strava] connected. To survive redeploys, set env var STRAVA_REFRESH_TOKEN={data['refresh_token']}")


def strava_ensure_token(config):
    tokens = load_tokens()
    strava = tokens.get('strava')
    seed_refresh = None
    if not strava:
        seed_refresh = (config.get('strava') or {}).get('seed_refresh_token', '').strip()
        if not seed_refresh:
            return None
        # tokens.json was wiped (e.g. a redeploy) but a refresh token was
        # seeded via env var -- bootstrap a fresh token pair from it instead
        # of requiring the user to reconnect through the OAuth flow again.
        strava = {'access_token': None, 'refresh_token': seed_refresh, 'expires_at': 0}
    if strava['expires_at'] > time.time() + 60:
        return strava['access_token']
    s = config['strava']
    try:
        data = http_request(STRAVA_TOKEN, data={
            'client_id': s['client_id'],
            'client_secret': s['client_secret'],
            'refresh_token': strava['refresh_token'],
            'grant_type': 'refresh_token',
        })
    except Exception:
        # Expired/revoked refresh token, or a stale STRAVA_REFRESH_TOKEN seed
        # -- surface as "not connected" (every caller already handles that)
        # instead of letting an uncaught HTTPError crash the request.
        return None
    strava['access_token'] = data['access_token']
    strava['refresh_token'] = data.get('refresh_token', strava['refresh_token'])
    strava['expires_at'] = data['expires_at']
    tokens['strava'] = strava
    save_tokens(tokens)
    # Strava refresh tokens rarely rotate, but if this one just did, the env
    # var seed is now stale -- flag it so it gets updated before the next
    # redeploy wipes tokens.json and falls back to the old one.
    if seed_refresh and strava['refresh_token'] != seed_refresh:
        print(f"[strava] refresh token rotated -- update env var STRAVA_REFRESH_TOKEN={strava['refresh_token']}")
    return strava['access_token']


def strava_get_activities(config, days=90):
    access_token = strava_ensure_token(config)
    if not access_token:
        return {'connected': False}
    after = int(time.time() - days * 86400)
    url = f'{STRAVA_API}/athlete/activities?after={after}&per_page=100'
    try:
        req = urllib.request.Request(url, headers={'Authorization': f'Bearer {access_token}'})
        with urllib.request.urlopen(req, timeout=15) as resp:
            activities = json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {'connected': True, 'error': f'http_{e.code}'}
    except Exception:
        return {'connected': True, 'error': 'network'}

    runs = []
    for a in activities:
        if a.get('type') not in ('Run', 'TrailRun', 'VirtualRun'):
            continue
        runs.append({
            'id': f"strava-{a['id']}",
            'date': (a.get('start_date_local') or '')[:10],
            'km': round(a.get('distance', 0) / 1000, 2),
            'name': a.get('name'),
            'type': a.get('type'),
        })
    return {'connected': True, 'activities': runs}


# ---------------- USDA FoodData Central (protein lookup) ----------------

USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search'


def usda_lookup_protein(config, query):
    api_key = (config.get('usda') or {}).get('api_key', '').strip()
    if not api_key:
        return {'connected': False}

    params = {
        'query': query,
        'dataType': 'Foundation,SR Legacy',  # generic whole foods, standardized per-100g values
        'pageSize': 10,
        'api_key': api_key,
    }
    url = f'{USDA_SEARCH}?{urllib.parse.urlencode(params)}'
    try:
        data = http_request(url)
    except urllib.error.HTTPError as e:
        if e.code == 401 or e.code == 403:
            return {'connected': True, 'error': 'unauthorized'}
        return {'connected': True, 'error': f'http_{e.code}'}
    except Exception:
        return {'connected': True, 'error': 'network'}

    for food in data.get('foods', []):
        description = food.get('description', '')
        # "oil" entries (e.g. "Fish oil, salmon") are essentially never what
        # someone means by a protein source -- skip them, not the point.
        if 'oil' in description.lower():
            continue
        for nutrient in food.get('foodNutrients', []):
            if nutrient.get('nutrientId') == 1003 and nutrient.get('value') is not None:
                return {
                    'connected': True,
                    'found': True,
                    'description': description,
                    'proteinPer100g': nutrient['value'],
                }
    return {'connected': True, 'found': False}


# ---------------- coach (Anthropic Claude) ----------------

ANTHROPIC_API = 'https://api.anthropic.com/v1/messages'
ANTHROPIC_MODEL = 'claude-sonnet-5'
ANTHROPIC_VERSION = '2023-06-01'

# Calling this tool only ever produces a proposal the client renders as an
# Apply/Dismiss card -- nothing is written to the athlete's plan until they
# click Apply. See coach_reply()/extract_proposals() for how the tool_use
# block is turned into that card.
COACH_TOOLS = [
    {
        'name': 'propose_plan_change',
        'description': (
            "Propose changing a specific day's planned workout. This does NOT apply the "
            "change -- it only surfaces a card in the app that the athlete must explicitly "
            "approve before their plan actually changes."
        ),
        'input_schema': {
            'type': 'object',
            'properties': {
                'date': {'type': 'string', 'description': 'ISO date (YYYY-MM-DD) of the day to change, must be today or later this week'},
                'type': {'type': 'string', 'description': "New short workout title, e.g. 'Easy Run' or 'Full Rest'"},
                'detail': {'type': 'string', 'description': 'New workout detail/instructions for that day'},
                'reason': {'type': 'string', 'description': "One sentence explaining why, grounded in the athlete's actual data"},
            },
            'required': ['date', 'type', 'detail', 'reason'],
        },
    },
]

ISO_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

COACH_SYSTEM_TEMPLATE = """You are an experienced, encouraging running coach embedded in the athlete's personal Honolulu Marathon training tracker web app. Ground every answer in the live training data below — never invent numbers that aren't there.

Race: Honolulu Marathon, December 13, 2026.
{health_profile_section}{memory_section}
Non-negotiables baked into this plan (don't casually suggest dropping these): nasal breathing on easy runs, daily achilles/toe-spacer mobility work, midfoot strike focus, heat-adaptation long runs scheduled 10am–2pm before Peak phase, walk breaks allowed on long runs.

You can propose changing a specific day's planned workout with the propose_plan_change tool -- use it when the data genuinely supports a change (low readiness, high recent mileage, missed sessions, soreness they mention, a pattern in "things you've learned", etc.), not reflexively. Calling the tool does NOT change anything by itself -- it surfaces a card in the app that the athlete has to explicitly approve before it takes effect, so there's no risk in proposing when you're fairly confident; they're always the final decision-maker. Only propose changes for today or a day later this week that's in the "Current status" below -- you don't have visibility into future weeks, so don't propose changes there. Never propose changing race day itself. When you do call the tool, you can still write normal reply text alongside it (e.g. explain your reasoning); you don't need to (and shouldn't) also describe the exact new workout in prose since the card already shows it.

Be specific and concise -- a few sentences to a short paragraph is usually enough, not an exhaustive breakdown -- and ask a clarifying question if the data below doesn't cover what you'd need to answer well.

If the athlete tells you something durable worth remembering for future conversations -- an injury detail, a preference, a recurring pattern, a goal, anything not already covered below or in "things you've learned" -- put one line per new fact at the very START of your response, before anything else, formatted exactly as "MEMORY: <short fact>". Put these first (not at the end) so they're never lost if your reply runs long. Only do this for genuinely new information they just told you -- most replies won't need one. These lines are stripped out before the athlete sees your reply, so never refer to them in the visible answer.

Current status:
{context_text}"""


def format_health_profile_section(context):
    profile = (context or {}).get('healthProfile')
    if not isinstance(profile, str) or not profile.strip():
        return ''
    # Clamp length -- this is meant to be background, not the bulk of every
    # request's tokens, and it's user-supplied free text going straight into
    # the system prompt.
    profile = profile.strip()[:6000]
    return (
        "\nAthlete health profile — medical history, conditions, and lifestyle "
        "background. Keep this in mind for every answer, especially anything "
        "safety-relevant (e.g. seizure or syncope history around heat/intensity, "
        "injury history around specific movements):\n" + profile + "\n"
    )


def format_memory_section(context):
    memories = (context or {}).get('coachMemory')
    if not isinstance(memories, list) or not memories:
        return ''
    lines = ["\nThings you've learned about this athlete from past conversations:"]
    for m in memories[-60:]:
        if isinstance(m, str) and m.strip():
            lines.append(f"  - {m.strip()[:300]}")
    return '\n'.join(lines) + '\n'


MEMORY_LINE_RE = re.compile(r'^MEMORY:\s*(.+)$', re.MULTILINE)


def extract_memories(text):
    """Pulls trailing "MEMORY: ..." lines out of a reply -- these are the
    model's own signal for what's worth remembering next time, not meant to
    be shown to the athlete."""
    memories = [m.strip() for m in MEMORY_LINE_RE.findall(text) if m.strip()]
    cleaned = MEMORY_LINE_RE.sub('', text)
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned).strip()
    return cleaned, memories


def extract_proposals(content_blocks):
    """Pulls propose_plan_change tool calls out of the response content and
    validates them -- the client trusts this shape directly to render a
    card and (if approved) key state.planOverrides by date, so a malformed
    tool call should be dropped here rather than reaching the browser."""
    proposals = []
    for block in content_blocks:
        if block.get('type') != 'tool_use' or block.get('name') != 'propose_plan_change':
            continue
        args = block.get('input') or {}
        date = str(args.get('date', '')).strip()
        workout_type = str(args.get('type', '')).strip()[:80]
        detail = str(args.get('detail', '')).strip()[:500]
        reason = str(args.get('reason', '')).strip()[:300]
        if not ISO_DATE_RE.match(date) or not workout_type or not detail:
            continue
        proposals.append({'date': date, 'type': workout_type, 'detail': detail, 'reason': reason})
    return proposals


def format_coach_context(context):
    if not isinstance(context, dict):
        context = {}
    lines = []
    lines.append(f"Days to race: {context.get('daysToRace', 'unknown')}")
    down = ' (a scheduled down week)' if context.get('isDownWeek') else ''
    lines.append(f"Current week: {context.get('week', '?')} of 27 — {context.get('phase', 'unknown')} phase{down}")

    today = context.get('todaysWorkout')
    if today:
        lines.append(f"Today's planned workout ({today.get('day', '')}): {today.get('type', '')} — {today.get('detail', '')}")

    rest = context.get('restOfWeek') or []
    if rest:
        lines.append("Rest of this week's plan:")
        for d in rest:
            lines.append(f"  - {d.get('day', '')}: {d.get('type', '')} — {d.get('detail', '')}")

    lines.append(f"km logged this week (Strava-synced runs only): {context.get('weeklyKmSoFar', 0)}")

    runs = context.get('recentStravaRuns') or []
    if runs:
        lines.append("Recent Strava runs (last 14 days):")
        for r in runs:
            name = f' "{r["name"]}"' if r.get('name') else ''
            lines.append(f"  - {r.get('date', '')}: {r.get('km', '?')}km{name}")
    else:
        lines.append("No Strava runs synced in the last 14 days.")

    oura = context.get('oura')
    if oura:
        lines.append(
            f"Oura today — readiness {oura.get('readiness', '?')}, "
            f"sleep {oura.get('sleep', '?')}, activity {oura.get('activity', '?')}"
        )
    else:
        lines.append("Oura not connected, or no data yet today.")

    cycle = context.get('cycle')
    if cycle:
        lines.append(f"Cycle: day {cycle.get('day', '?')} of 28 ({cycle.get('phase', '?')} phase)")

    adherence = context.get('adherence') or {}
    if adherence:
        lines.append(
            f"Today's mobility work: {adherence.get('mobilityDone', '?')}/{adherence.get('mobilityTotal', '?')} done. "
            f"Mouth tape streak: {adherence.get('mouthTapeStreak', '?')} days."
        )

    trend = context.get('last7Days')
    if trend:
        lines.append(
            f"Last 7 days ({trend.get('daysWithData', '?')} days with data): "
            f"mobility adherence {trend.get('mobilityAdherencePct', '?')}%, "
            f"supplement adherence {trend.get('supplementAdherencePct', '?')}%, "
            f"avg water {trend.get('avgWaterMl', '?')}ml/day, "
            f"avg protein {trend.get('avgProteinG', '?')}g/day, "
            f"mouth tape {trend.get('mouthTapeDaysHit', '?')}/7 nights."
        )

    return '\n'.join(lines)


def coach_reply(config, messages, context):
    api_key = (config.get('anthropic') or {}).get('api_key', '').strip()
    if not api_key:
        return {'error': 'no_config'}

    system = COACH_SYSTEM_TEMPLATE.format(
        health_profile_section=format_health_profile_section(context),
        memory_section=format_memory_section(context),
        context_text=format_coach_context(context),
    )
    # Trim to the last 12 turns and clamp message length — this is a personal
    # single-user app, but the coach endpoint still shouldn't accept an
    # unbounded body and rack up an unbounded Anthropic bill from one bad request.
    trimmed = messages[-12:]
    safe_messages = []
    for m in trimmed:
        role = m.get('role')
        content = str(m.get('content', ''))[:4000]
        if role in ('user', 'assistant') and content.strip():
            safe_messages.append({'role': role, 'content': content})
    if not safe_messages:
        return {'error': 'no_messages'}

    payload = {
        'model': ANTHROPIC_MODEL,
        'max_tokens': 1536,
        'system': system,
        'messages': safe_messages,
        'tools': COACH_TOOLS,
    }
    try:
        data = http_request_json(ANTHROPIC_API, payload, headers={
            'x-api-key': api_key,
            'anthropic-version': ANTHROPIC_VERSION,
        })
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {'error': 'unauthorized'}
        return {'error': f'http_{e.code}'}
    except Exception:
        return {'error': 'network'}

    content_blocks = data.get('content', [])
    text = ''.join(block.get('text', '') for block in content_blocks if block.get('type') == 'text')
    cleaned_text, new_memories = extract_memories(text)
    proposals = extract_proposals(content_blocks)
    if not cleaned_text and proposals:
        # The model sometimes calls the tool with no accompanying prose --
        # the card speaks for itself, but the chat bubble still needs *some*
        # text so the conversation history (and the UI) has something to show.
        cleaned_text = 'Here’s what I’d suggest — take a look at the card below.'

    result = {'reply': cleaned_text}
    if new_memories:
        result['memories'] = new_memories
    if proposals:
        result['proposals'] = proposals
    return result


# ---------------- request handler ----------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')  # never let the browser reuse a stale API response
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location):
        self.send_response(302)
        self.send_header('Location', location)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = dict(urllib.parse.parse_qsl(parsed.query))

        if path.startswith('/api/') or path.startswith('/auth/'):
            return self.handle_api(path, query)
        return self.serve_static(path)

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == '/api/coach':
            length = int(self.headers.get('Content-Length', 0) or 0)
            raw = self.rfile.read(length) if length else b'{}'
            try:
                body = json.loads(raw.decode())
            except json.JSONDecodeError:
                return self.send_json({'error': 'bad_request'}, status=400)
            config = load_config()
            if not config or not (config.get('anthropic') or {}).get('api_key', '').strip():
                return self.send_json({'error': 'no_config'})
            messages = body.get('messages')
            if not isinstance(messages, list) or not messages:
                return self.send_json({'error': 'no_messages'}, status=400)
            return self.send_json(coach_reply(config, messages, body.get('context')))
        return self.send_json({'error': 'not_found'}, status=404)

    def handle_api(self, path, query):
        config = load_config()

        if path == '/api/status':
            tokens = load_tokens()
            oura_on = bool(config and (config.get('oura') or {}).get('personal_access_token', '').strip())
            strava_on = bool(tokens.get('strava'))
            usda_on = bool(config and (config.get('usda') or {}).get('api_key', '').strip())
            anthropic_on = bool(config and (config.get('anthropic') or {}).get('api_key', '').strip())
            configured = {
                'oura': bool(config and (config.get('oura') or {}).get('personal_access_token', '').strip()),
                'strava': bool(config and (config.get('strava') or {}).get('client_id')),
                'usda': usda_on,
                'anthropic': anthropic_on,
            }
            return self.send_json({
                'oura': oura_on, 'strava': strava_on, 'usda': usda_on, 'anthropic': anthropic_on,
                'configured': configured,
            })

        if path == '/api/oura/readiness':
            if not config:
                return self.send_json({'connected': False, 'error': 'no_config'})
            return self.send_json(oura_get_readiness(config))

        if path == '/api/oura/summary':
            if not config:
                return self.send_json({'connected': False, 'error': 'no_config'})
            return self.send_json(oura_get_summary(config))

        if path == '/api/strava/activities':
            if not config or not (config.get('strava') or {}).get('client_id'):
                return self.send_json({'connected': False, 'error': 'no_config'})
            days = int(query.get('days', '90'))
            return self.send_json(strava_get_activities(config, days))

        if path == '/api/strava/disconnect':
            tokens = load_tokens()
            tokens.pop('strava', None)
            save_tokens(tokens)
            return self.send_json({'ok': True})

        if path == '/api/nutrition/protein':
            if not config or not (config.get('usda') or {}).get('api_key'):
                return self.send_json({'connected': False, 'error': 'no_config'})
            food = query.get('food', '').strip()
            if not food:
                return self.send_json({'connected': True, 'error': 'no_query'})
            return self.send_json(usda_lookup_protein(config, food))

        if path == '/auth/strava/login':
            if not config or not (config.get('strava') or {}).get('client_id'):
                return self.send_json({'error': 'Strava is not configured. Set STRAVA_CLIENT_ID/STRAVA_CLIENT_SECRET (or server/config.json locally).'}, status=400)
            return self.redirect(strava_authorize_url(config))

        if path == '/auth/strava/callback':
            error = query.get('error')
            if error:
                return self.redirect('/?strava=denied')
            code = query.get('code')
            if not code or not config:
                return self.redirect('/?strava=error')
            try:
                strava_exchange_code(config, code)
            except Exception:
                return self.redirect('/?strava=error')
            return self.redirect('/?strava=connected')

        return self.send_json({'error': 'not_found'}, status=404)

    def serve_static(self, path):
        if path == '/':
            path = '/index.html'
        # prevent path traversal
        safe_path = os.path.normpath(path).lstrip('/')
        full_path = os.path.join(WEBAPP_DIR, safe_path)
        if not os.path.abspath(full_path).startswith(os.path.abspath(WEBAPP_DIR)):
            return self.send_json({'error': 'forbidden'}, status=403)
        if not os.path.isfile(full_path):
            return self.send_json({'error': 'not_found'}, status=404)
        ctype, _ = mimetypes.guess_type(full_path)
        ctype = ctype or 'application/octet-stream'
        with open(full_path, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        # Force revalidation on every load -- this is a small personal app that
        # changes often; a browser silently serving a stale cached app.js or
        # favicon (which browsers cache especially aggressively) after a
        # deploy is worse than the minor cost of always re-fetching.
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(body)


def main():
    env_port = os.environ.get('PORT')
    if env_port:
        # Hosted (Render sets PORT) -- listen on all interfaces.
        port = int(env_port)
        host = '0.0.0.0'
    else:
        # Local dev -- localhost only, port from config.json if present.
        port = load_raw_config_file().get('port', 4173)
        host = 'localhost'

    config = load_config()
    if not config:
        print('No credentials configured. For local dev: copy server/config.example.json to')
        print('server/config.json and fill it in. For production: set OURA_PERSONAL_ACCESS_TOKEN,')
        print('STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_REDIRECT_URI as environment variables.')
        print('The app will still run, but Oura/Strava will show as not connected.')

    server = ThreadingHTTPServer((host, port), Handler)
    print(f'Honolulu Training Tracker running on {host}:{port}')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
