#!/usr/bin/env python3
"""Smoke test for the ONEBOX API: auth, list sessions, fetch availability."""

import json
import sys
import os
from urllib import request, parse, error


def load_env(path=".env"):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def http(method, url, headers=None, body=None):
    data = body.encode("utf-8") if isinstance(body, str) else body
    req = request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8")
    except error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")
    except error.URLError as e:
        return None, f"Network error: {e.reason}"


def pretty(text):
    try:
        return json.dumps(json.loads(text), indent=2, ensure_ascii=False)
    except (ValueError, TypeError):
        return text


def section(title):
    print("\n" + "=" * 70)
    print(title)
    print("=" * 70)


def main():
    env = load_env()
    client_secret = env.get("ONEBOX_CLIENT_SECRET")
    channel_id = env.get("ONEBOX_CHANNEL_ID")
    client_id = env.get("ONEBOX_CLIENT_ID", "seller-channel-client")
    token_url = env.get("ONEBOX_API_ENDPOINT")

    if not (client_secret and channel_id and token_url):
        print("Missing required values in .env "
              "(ONEBOX_CLIENT_SECRET, ONEBOX_CHANNEL_ID, ONEBOX_API_ENDPOINT).")
        sys.exit(1)

    # Derive the base URL from the token endpoint
    # (https://api.oneboxtds.net/oauth/token -> https://api.oneboxtds.net)
    parsed = parse.urlsplit(token_url)
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    # 1) Authenticate
    section("1. POST /oauth/token  (authenticate)")
    body = parse.urlencode({
        "grant_type": "client_credentials",
        "channel_id": channel_id,
        "client_id": client_id,
        "client_secret": client_secret,
    })
    status, text = http(
        "POST",
        token_url,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=body,
    )
    print(f"HTTP {status}")
    print(pretty(text))

    if status != 200:
        print("\nKEYS INVALID or auth failed — stopping.")
        sys.exit(1)

    try:
        token = json.loads(text)["access_token"]
    except (ValueError, KeyError):
        print("\nCould not extract access_token from response — stopping.")
        sys.exit(1)
    print("\nKEYS VALID — access_token received.")

    auth_headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    # 2) Get sessions
    section("2. GET /catalog-api/v1/sessions  (list sessions)")
    sessions_url = f"{base_url}/catalog-api/v1/sessions"
    status, text = http("GET", sessions_url, headers=auth_headers)
    print(f"HTTP {status}")
    print(pretty(text))

    if status != 200:
        sys.exit(1)

    # Try to find a session id to query availability for
    session_id = None
    try:
        payload = json.loads(text)
        candidates = payload if isinstance(payload, list) else (
            payload.get("sessions") or payload.get("data") or payload.get("content") or []
        )
        if candidates:
            first = candidates[0]
            session_id = first.get("id") or first.get("sessionId") or first.get("session_id")
    except (ValueError, AttributeError, IndexError):
        pass

    if not session_id:
        print("\nNo session id found in response — skipping availability check.")
        return

    # 3) Get availability for the first session
    section(f"3. GET /catalog-api/v1/sessions/{session_id}/availability")
    avail_url = f"{base_url}/catalog-api/v1/sessions/{session_id}/availability"
    status, text = http("GET", avail_url, headers=auth_headers)
    print(f"HTTP {status}")
    print(pretty(text))


if __name__ == "__main__":
    main()
