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
    neither Oura nor Strava is configured anywhere."""
    config = load_raw_config_file()
    config.setdefault('oura', {})
    config.setdefault('strava', {})

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

    has_oura = bool(config['oura'].get('personal_access_token', '').strip())
    has_strava = bool(config['strava'].get('client_id'))
    if not has_oura and not has_strava:
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


# ---------------- Oura ----------------

def oura_get_readiness(config):
    token = (config.get('oura') or {}).get('personal_access_token', '').strip()
    if not token:
        return {'connected': False}
    end = time.strftime('%Y-%m-%d')
    start = time.strftime('%Y-%m-%d', time.localtime(time.time() - 3 * 86400))
    url = f'{OURA_API}/v2/usercollection/daily_readiness?start_date={start}&end_date={end}'
    try:
        data = http_request(url, headers={'Authorization': f'Bearer {token}'})
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {'connected': True, 'error': 'unauthorized'}
        return {'connected': True, 'error': f'http_{e.code}'}
    except Exception:
        return {'connected': True, 'error': 'network'}
    entries = data.get('data', [])
    if not entries:
        return {'connected': True, 'error': 'no_data'}
    latest = sorted(entries, key=lambda e: e['day'])[-1]
    return {'connected': True, 'score': latest.get('score'), 'day': latest.get('day')}


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


def strava_ensure_token(config):
    tokens = load_tokens()
    strava = tokens.get('strava')
    if not strava:
        return None
    if strava['expires_at'] > time.time() + 60:
        return strava['access_token']
    s = config['strava']
    data = http_request(STRAVA_TOKEN, data={
        'client_id': s['client_id'],
        'client_secret': s['client_secret'],
        'refresh_token': strava['refresh_token'],
        'grant_type': 'refresh_token',
    })
    strava['access_token'] = data['access_token']
    strava['refresh_token'] = data.get('refresh_token', strava['refresh_token'])
    strava['expires_at'] = data['expires_at']
    tokens['strava'] = strava
    save_tokens(tokens)
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


# ---------------- request handler ----------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
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

    def handle_api(self, path, query):
        config = load_config()

        if path == '/api/status':
            tokens = load_tokens()
            oura_on = bool(config and (config.get('oura') or {}).get('personal_access_token', '').strip())
            strava_on = bool(tokens.get('strava'))
            configured = {
                'oura': bool(config and (config.get('oura') or {}).get('personal_access_token', '').strip()),
                'strava': bool(config and (config.get('strava') or {}).get('client_id')),
            }
            return self.send_json({'oura': oura_on, 'strava': strava_on, 'configured': configured})

        if path == '/api/oura/readiness':
            if not config:
                return self.send_json({'connected': False, 'error': 'no_config'})
            return self.send_json(oura_get_readiness(config))

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
