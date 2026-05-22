#!/usr/bin/env python3
"""Fetch the full list of matches (sessions) on our ONEBOX channel."""

import json
import sys
import os
from urllib import request, parse, error


def load_env(path=".env"):
    env = {}
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


def authenticate(env):
    body = parse.urlencode({
        "grant_type": "client_credentials",
        "channel_id": env["ONEBOX_CHANNEL_ID"],
        "client_id": env.get("ONEBOX_CLIENT_ID", "seller-channel-client"),
        "client_secret": env["ONEBOX_CLIENT_SECRET"],
    })
    status, text = http(
        "POST",
        env["ONEBOX_API_ENDPOINT"],
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        body=body,
    )
    if status != 200:
        print(f"Auth failed (HTTP {status}): {text}")
        sys.exit(1)
    return json.loads(text)["access_token"]


def fetch_all_sessions(base_url, token):
    """Page through /catalog-api/v1/sessions until we have everything."""
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    all_items = []
    offset = 0
    limit = 100
    while True:
        url = f"{base_url}/catalog-api/v1/sessions?limit={limit}&offset={offset}"
        status, text = http("GET", url, headers=headers)
        if status != 200:
            print(f"Sessions request failed (HTTP {status}): {text}")
            sys.exit(1)
        payload = json.loads(text)
        page = payload.get("data") or []
        all_items.extend(page)
        total = (payload.get("metadata") or {}).get("total")
        if total is None or len(all_items) >= total or not page:
            return all_items, total
        offset += limit


def match_name(session):
    event = session.get("event") or {}
    title = (event.get("texts") or {}).get("title") or {}
    return (
        title.get("es-ES")
        or title.get("en-US")
        or next(iter(title.values()), None)
        or event.get("name")
        or session.get("name")
        or "(no name)"
    )


def main():
    env = load_env()
    parsed = parse.urlsplit(env["ONEBOX_API_ENDPOINT"])
    base_url = f"{parsed.scheme}://{parsed.netloc}"

    token = authenticate(env)
    sessions, total = fetch_all_sessions(base_url, token)

    print(f"Matches returned: {len(sessions)}"
          + (f" (API reported total: {total})" if total is not None else ""))

    if sessions:
        first = sessions[0]
        print(f"First match: {match_name(first)}")
        print(f"  session id: {first.get('id')}")
        print(f"  event:      {(first.get('event') or {}).get('name')}")
        print(f"  venue:      {(first.get('venue') or {}).get('name')}")
        print(f"  starts:     {(first.get('date') or {}).get('start')}")


if __name__ == "__main__":
    main()
