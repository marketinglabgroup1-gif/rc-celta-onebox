# RC Celta · ONEBOX integration

Tools and pages for the RC Celta ticketing flow on the ONEBOX TDS catalog API
(channel 2287). Talks to three ONEBOX endpoints: OAuth token, session list, and
per-session seat availability.

## Contents

| File | What it does |
|------|--------------|
| `test_onebox.py` | Smoke test: authenticates and prints the response of all three endpoints. |
| `list_matches.py` | Fetches every match (session) on the channel and prints the count + first match. |
| `generate-landing.js` | Bakes a session's event info and grada (sector) list into `landing.html`. |
| `landing.html` | RC Celta "¡Avísame!" sign-up page for one match (Mailchimp-backed). |
| `server.js` | Local server for `landing.html` + `POST /subscribe` (stores leads in Mailchimp). |
| `onebox-sessions-cards.html` | Visual grid of all matches, colour-coded by availability, with search. Links the featured match to the landing page. |
| `onebox-api-test.html` | Dark-theme API documentation for the three endpoints (secrets redacted). |
| `setup-mailchimp.js` | One-off setup for the Mailchimp audience merge fields. |

## Setup

Credentials are read from a `.env` file (not committed). Required keys:

```
ONEBOX_CLIENT_SECRET=...
ONEBOX_CHANNEL_ID=2287
ONEBOX_API_ENDPOINT=https://api.oneboxtds.net/oauth/token
MAILCHIMP_API_KEY=...
MAILCHIMP_AUDIENCE_ID=...
```

## Running

```sh
python3 test_onebox.py        # verify ONEBOX credentials
python3 list_matches.py       # list matches
./node generate-landing.js    # refresh landing.html from live data
./start.command               # launch the landing page locally (port 3000)
```

The static pages (`onebox-sessions-cards.html`, `onebox-api-test.html`) open
directly in a browser.
