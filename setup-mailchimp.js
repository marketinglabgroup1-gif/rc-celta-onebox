#!/usr/bin/env node
// Idempotently updates the Mailchimp audience so its merge fields match the
// "¡Avísame!" form on landing.html. Reads credentials from .env. Safe to re-run.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

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

// Merge fields the form needs. FNAME/LNAME are usually Mailchimp defaults;
// we create them only if missing. All optional so a blank value never 400s.
const REQUIRED_FIELDS = [
    { tag: 'FNAME', name: 'Nombre', type: 'text' },
    { tag: 'LNAME', name: 'Apellido', type: 'text' },
    { tag: 'GRADA', name: 'Grada preferida', type: 'text' },
    { tag: 'GRADAID', name: 'Grada ID', type: 'text' },
    { tag: 'SESSIONID', name: 'Session ID', type: 'text' },
    { tag: 'EVENTID', name: 'Event ID', type: 'text' },
];

function mailchimp(apiKey) {
    const dc = apiKey.split('-')[1];
    if (!dc) throw new Error('MAILCHIMP_API_KEY is missing the "-usXX" data-center suffix');
    const base = `https://${dc}.api.mailchimp.com/3.0`;
    const auth = 'Basic ' + Buffer.from(`anystring:${apiKey}`).toString('base64');
    return async function call(method, pathname, body) {
        const res = await fetch(base + pathname, {
            method,
            headers: {
                Authorization: auth,
                'Content-Type': 'application/json',
            },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (!res.ok) {
            const detail = data.detail || data.title || text;
            throw new Error(`Mailchimp ${method} ${pathname} -> HTTP ${res.status}: ${detail}`);
        }
        return data;
    };
}

async function main() {
    const env = loadEnv(ENV_PATH);
    const apiKey = env.MAILCHIMP_API_KEY;
    const listId = env.MAILCHIMP_AUDIENCE_ID;
    if (!apiKey || !listId) {
        throw new Error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID in .env');
    }

    const call = mailchimp(apiKey);

    const list = await call('GET', `/lists/${listId}`);
    console.log(`Audience: "${list.name}" (${listId})`);

    const existing = await call('GET', `/lists/${listId}/merge-fields?count=1000`);
    const byTag = new Map((existing.merge_fields || []).map(f => [f.tag, f]));

    for (const field of REQUIRED_FIELDS) {
        if (byTag.has(field.tag)) {
            console.log(`  = ${field.tag} already present ("${byTag.get(field.tag).name}")`);
            continue;
        }
        await call('POST', `/lists/${listId}/merge-fields`, {
            tag: field.tag,
            name: field.name,
            type: field.type,
            required: false,
            public: false,
        });
        console.log(`  + ${field.tag} created ("${field.name}")`);
    }

    console.log('Done. Audience fields now match the form. (The "privacy-accepted" tag is created automatically on first submission.)');
}

main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
});
