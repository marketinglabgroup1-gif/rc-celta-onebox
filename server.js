#!/usr/bin/env node
// Local server for the "¡Avísame!" landing page.
//   - serves landing.html and /assets/*
//   - POST /subscribe -> stores the submission in the Mailchimp audience
// The Mailchimp API key stays server-side (loaded from .env); it is never
// sent to the browser. Run with: ./node server.js   (then open the printed URL)

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');
const PORT = Number(process.env.PORT) || 3000;

// Same .env loader used by generate-landing.js.
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

const env = loadEnv(ENV_PATH);
const API_KEY = env.MAILCHIMP_API_KEY;
const LIST_ID = env.MAILCHIMP_AUDIENCE_ID;
if (!API_KEY || !LIST_ID) {
    console.error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID in .env');
    process.exit(1);
}
const DC = API_KEY.split('-')[1];
if (!DC) {
    console.error('MAILCHIMP_API_KEY is missing the "-usXX" data-center suffix');
    process.exit(1);
}
const MC_BASE = `https://${DC}.api.mailchimp.com/3.0`;
const MC_AUTH = 'Basic ' + Buffer.from(`anystring:${API_KEY}`).toString('base64');

async function mailchimp(method, pathname, body) {
    const res = await fetch(MC_BASE + pathname, {
        method,
        headers: { Authorization: MC_AUTH, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    return { ok: res.ok, status: res.status, data };
}

// "Sector 316 - 83 libres (94%)" -> "Sector 316"
function cleanGrada(label) {
    return String(label || '').replace(/\s*-\s*\d[\d.]*\s*libres.*$/i, '').trim();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function handleSubscribe(req, res) {
    let raw = '';
    req.on('data', c => {
        raw += c;
        if (raw.length > 1e6) req.destroy();
    });
    req.on('end', async () => {
        let body;
        try {
            body = JSON.parse(raw || '{}');
        } catch {
            return sendJson(res, 400, { ok: false, error: 'Cuerpo de la solicitud no válido.' });
        }

        const name = String(body.name || '').trim();
        const surname = String(body.surname || '').trim();
        const email = String(body.email || '').trim().toLowerCase();
        const gradaId = String(body.gradaId || '').trim();
        const gradaName = cleanGrada(body.gradaLabel);
        const sessionId = String(body.sessionId || '').trim();
        const eventId = String(body.eventId || '').trim();
        const privacy = body.privacy === true;

        if (!name || !surname || !EMAIL_RE.test(email) || !gradaId || !privacy) {
            return sendJson(res, 400, {
                ok: false,
                error: 'Faltan campos obligatorios o el correo no es válido.',
            });
        }

        const subscriberHash = crypto.createHash('md5')
            .update(email).digest('hex');

        try {
            const upsert = await mailchimp(
                'PUT',
                `/lists/${LIST_ID}/members/${subscriberHash}`,
                {
                    email_address: email,
                    status_if_new: 'subscribed',
                    status: 'subscribed',
                    merge_fields: {
                        FNAME: name,
                        LNAME: surname,
                        GRADA: gradaName,
                        GRADAID: gradaId,
                        SESSIONID: sessionId,
                        EVENTID: eventId,
                    },
                },
            );

            if (!upsert.ok) {
                const detail = upsert.data.detail || upsert.data.title || 'Error de Mailchimp';
                // Most common real-world case: a previously unsubscribed/cleaned address.
                const friendly = upsert.status === 400 && /compliance|unsubscrib|forgott|cleaned/i.test(detail)
                    ? 'Este correo se dio de baja anteriormente y no se puede volver a suscribir automáticamente.'
                    : detail;
                console.error(`Mailchimp upsert failed (${upsert.status}): ${detail}`);
                return sendJson(res, 502, { ok: false, error: friendly });
            }

            // Tag is created automatically by Mailchimp if it doesn't exist yet.
            const tag = await mailchimp(
                'POST',
                `/lists/${LIST_ID}/members/${subscriberHash}/tags`,
                { tags: [{ name: 'privacy-accepted', status: 'active' }] },
            );
            if (!tag.ok) {
                console.error(`Tag apply failed (${tag.status}): ` +
                    (tag.data.detail || tag.data.title || ''));
                // Contact is saved; the tag is non-critical, so still report success.
            }

            return sendJson(res, 200, { ok: true });
        } catch (err) {
            console.error('Subscribe error:', err.message || err);
            return sendJson(res, 502, {
                ok: false,
                error: 'No se pudo conectar con Mailchimp. Inténtalo de nuevo.',
            });
        }
    });
}

function sendJson(res, status, obj) {
    const buf = Buffer.from(JSON.stringify(obj));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': buf.length,
    });
    res.end(buf);
}

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/' || urlPath === '/landing.html') {
        urlPath = '/landing.html';
    }

    // Resolve safely inside ROOT (block path traversal).
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT + path.sep)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    // Only landing.html and the assets folder are served.
    const isAllowed = filePath === path.join(ROOT, 'landing.html') ||
        filePath.startsWith(path.join(ROOT, 'assets') + path.sep);
    if (!isAllowed || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Not found');
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url.split('?')[0] === '/subscribe') {
        return handleSubscribe(req, res);
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        return serveStatic(req, res);
    }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
});

server.listen(PORT, () => {
    console.log(`Landing page running at http://localhost:${PORT}`);
    console.log(`Submissions are stored in Mailchimp audience ${LIST_ID}.`);
});
