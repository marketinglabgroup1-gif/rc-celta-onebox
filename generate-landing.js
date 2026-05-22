#!/usr/bin/env node
// Fetches sectors for a single ONEBOX session and bakes them into the
// <select id="grada"> options in landing.html. Reads credentials from .env.

const fs = require('node:fs');
const path = require('node:path');

const SESSION_ID = 240895;
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const HTML_PATH = path.join(ROOT, 'landing.html');

function loadEnv(filePath) {
    const env = {};
    if (!fs.existsSync(filePath)) return env;
    for (const raw of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || !line.includes('=')) continue;
        const idx = line.indexOf('=');
        const key = line.slice(0, idx).trim();
        let value = line.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
    return env;
}

function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

async function getToken({ tokenUrl, channelId, clientId, clientSecret }) {
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        channel_id: channelId,
        client_id: clientId,
        client_secret: clientSecret,
    });
    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Auth failed: HTTP ${res.status} ${text}`);
    const data = JSON.parse(text);
    if (!data.access_token) throw new Error('No access_token in auth response');
    return data.access_token;
}

async function getAvailability(baseUrl, token, sessionId) {
    const url = `${baseUrl}/catalog-api/v1/sessions/${sessionId}/availability`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Availability fetch failed: HTTP ${res.status} ${text}`);
    return JSON.parse(text);
}

function extractSectors(payload) {
    const list = Array.isArray(payload?.sectors) ? payload.sectors : [];
    return list
        .map(s => {
            const pts = Array.isArray(s.price_types) ? s.price_types : [];
            const total = pts.reduce((a, p) => a + (p?.availability?.total ?? 0), 0);
            const available = pts.reduce((a, p) => a + (p?.availability?.available ?? 0), 0);
            const pct = total > 0 ? Math.round((available / total) * 100) : 0;
            return { id: s.id ?? s.sectorId, name: s.name ?? s.code, available, pct };
        })
        .filter(s => s.id != null && s.name);
}

async function getSession(baseUrl, token, sessionId) {
    const url = `${baseUrl}/catalog-api/v1/sessions`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Sessions fetch failed: HTTP ${res.status} ${text}`);
    const list = JSON.parse(text)?.data || [];
    const session = list.find(s => s.id === sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found in catalog`);
    return session;
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Show the venue-local wall-clock time exactly as ONEBOX returns it
// (e.g. "2020-02-12T21:00:00+01:00" -> "12 feb 2020, 21:00").
function formatDateEs(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso || '');
    if (!m) return iso || '';
    const [, y, mo, d, hh, mm] = m;
    return `${Number(d)} ${MONTHS_ES[Number(mo) - 1]} ${y}, ${hh}:${mm}`;
}

function groupThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function extractEvent(session, availability) {
    const subtitleTexts = session?.event?.texts?.subtitle || {};
    const subtitle = subtitleTexts['es-ES'] || subtitleTexts['en-US'] || '';
    const total = availability?.total ?? 0;
    const available = availability?.available ?? 0;
    const pct = total > 0 ? Math.round((available / total) * 100) : 0;
    const soldOut = session?.sold_out === true || available === 0;
    return {
        title: session?.event?.name || session?.name || '',
        subtitle,
        date: formatDateEs(session?.date?.start),
        venue: [session?.venue?.name, session?.venue?.location?.city]
            .filter(Boolean).join(', '),
        price: `${session?.price?.min_final?.value ?? '?'} € – ${session?.price?.max_final?.value ?? '?'} €`,
        status: soldOut ? 'Agotado' : (session?.on_sale ? 'En venta' : 'Próximamente'),
        statusKind: soldOut ? 'out' : 'on',
        availText: `${groupThousands(available)} / ${groupThousands(total)} (${pct}%)`,
        pct,
    };
}

function renderEventInfo(ev, indent) {
    const i = indent;
    return [
        `${i}<div class="event-info">`,
        `${i}    <div class="event-info__head">`,
        `${i}        <div>`,
        `${i}            <p class="event-info__title">${escapeText(ev.title)}</p>`,
        `${i}            <p class="event-info__subtitle">${escapeText(ev.subtitle)}</p>`,
        `${i}        </div>`,
        `${i}        <span class="event-info__status event-info__status--${ev.statusKind}">${escapeText(ev.status)}</span>`,
        `${i}    </div>`,
        `${i}    <ul class="event-info__meta">`,
        `${i}        <li><span>Fecha</span>${escapeText(ev.date)}</li>`,
        `${i}        <li><span>Recinto</span>${escapeText(ev.venue)}</li>`,
        `${i}        <li><span>Precio</span>${escapeText(ev.price)}</li>`,
        `${i}    </ul>`,
        `${i}    <div class="event-info__avail">`,
        `${i}        <div class="event-info__bar"><span style="width: ${ev.pct}%;"></span></div>`,
        `${i}        <p class="event-info__avail-text">${escapeText(ev.availText)}</p>`,
        `${i}    </div>`,
        `${i}</div>`,
    ].join('\n');
}

function rewriteEventInfo(html, ev) {
    const re = /([ \t]*)(<!-- EVENT-INFO:START[^>]*-->)([\s\S]*?)([ \t]*)(<!-- EVENT-INFO:END -->)/;
    const match = html.match(re);
    if (!match) throw new Error('Could not find EVENT-INFO markers in landing.html');
    const [, indent, startTag, , , endTag] = match;
    const block = '\n' + renderEventInfo(ev, indent) + '\n' + indent;
    return html.replace(re, `${indent}${startTag}${block}${endTag}`);
}

function rewriteEventIds(html, sessionId, eventId) {
    const re = /([ \t]*)(<!-- EVENT-IDS:START -->)([\s\S]*?)([ \t]*)(<!-- EVENT-IDS:END -->)/;
    const match = html.match(re);
    if (!match) throw new Error('Could not find EVENT-IDS markers in landing.html');
    const [, indent, startTag, , , endTag] = match;
    const block = [
        '',
        `${indent}<input type="hidden" id="session_id" name="session_id" value="${escapeAttr(sessionId)}">`,
        `${indent}<input type="hidden" id="event_id" name="event_id" value="${escapeAttr(eventId)}">`,
        indent,
    ].join('\n');
    return html.replace(re, `${indent}${startTag}${block}${endTag}`);
}

function renderOptions(sectors, indent) {
    const placeholder = `${indent}<option value="">Selecciona una grada</option>`;
    const items = sectors.map(s => {
        const label = `${s.name} - ${groupThousands(s.available)} libres (${s.pct}%)`;
        return `${indent}<option value="${escapeAttr(s.id)}">${escapeText(label)}</option>`;
    });
    return [placeholder, ...items].join('\n');
}

function rewriteSelect(html, sectors) {
    const re = /(<select\b[^>]*\bid="grada"[^>]*>)([\s\S]*?)(<\/select>)/;
    const match = html.match(re);
    if (!match) throw new Error('Could not find <select id="grada"> in landing.html');

    const [, openTag, innerOriginal, closeTag] = match;
    const optionIndent =
        (innerOriginal.match(/\n([ \t]+)<option\b/) || [, '                        '])[1];
    const closingIndent =
        (innerOriginal.match(/\n([ \t]+)$/) || [, '                    '])[1];

    const inner = '\n' + renderOptions(sectors, optionIndent) + '\n' + closingIndent;
    return html.replace(re, openTag + inner + closeTag);
}

async function main() {
    const env = loadEnv(ENV_PATH);
    const tokenUrl = env.ONEBOX_API_ENDPOINT;
    const channelId = env.ONEBOX_CHANNEL_ID;
    const clientSecret = env.ONEBOX_CLIENT_SECRET;
    const clientId = env.ONEBOX_CLIENT_ID || 'seller-channel-client';

    if (!tokenUrl || !channelId || !clientSecret) {
        throw new Error('Missing ONEBOX_API_ENDPOINT, ONEBOX_CHANNEL_ID or ONEBOX_CLIENT_SECRET in .env');
    }

    const baseUrl = new URL(tokenUrl).origin;
    const token = await getToken({ tokenUrl, channelId, clientId, clientSecret });
    const payload = await getAvailability(baseUrl, token, SESSION_ID);
    const session = await getSession(baseUrl, token, SESSION_ID);
    const sectors = extractSectors(payload);

    if (sectors.length === 0) {
        throw new Error('No sectors returned from availability response.');
    }

    const event = extractEvent(session, payload.availability);

    let html = fs.readFileSync(HTML_PATH, 'utf8');
    html = rewriteEventInfo(html, event);
    html = rewriteEventIds(html, session?.id ?? SESSION_ID, session?.event?.id ?? '');
    html = rewriteSelect(html, sectors);
    fs.writeFileSync(HTML_PATH, html);

    console.log(`Baked event "${event.title}" and ${sectors.length} sectors into ${path.basename(HTML_PATH)}.`);
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
