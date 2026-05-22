// Vercel serverless function: POST /api/subscribe
// Stores a landing-page submission in the Mailchimp audience.
// The Mailchimp API key stays server-side, read from environment variables
// (set MAILCHIMP_API_KEY and MAILCHIMP_AUDIENCE_ID in the Vercel dashboard).
// A vercel.json rewrite maps the form's /subscribe path to /api/subscribe,
// so this mirrors the behaviour of server.js for local development.

const crypto = require('node:crypto');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Sector 316 - 83 libres (94%)" -> "Sector 316"
function cleanGrada(label) {
  return String(label || '').replace(/\s*-\s*\d[\d.]*\s*libres.*$/i, '').trim();
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') return resolve(req.body);
    if (typeof req.body === 'string') {
      try { return resolve(JSON.parse(req.body || '{}')); } catch { return resolve({}); }
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  }

  const API_KEY = process.env.MAILCHIMP_API_KEY;
  const LIST_ID = process.env.MAILCHIMP_AUDIENCE_ID;
  if (!API_KEY || !LIST_ID) {
    console.error('Missing MAILCHIMP_API_KEY or MAILCHIMP_AUDIENCE_ID env vars');
    return res.status(500).json({ ok: false, error: 'Configuración del servidor incompleta.' });
  }
  const DC = API_KEY.split('-')[1];
  if (!DC) {
    console.error('MAILCHIMP_API_KEY is missing the "-usXX" data-center suffix');
    return res.status(500).json({ ok: false, error: 'Clave de Mailchimp no válida.' });
  }
  const MC_BASE = `https://${DC}.api.mailchimp.com/3.0`;
  const MC_AUTH = 'Basic ' + Buffer.from(`anystring:${API_KEY}`).toString('base64');

  async function mailchimp(method, pathname, body) {
    const r = await fetch(MC_BASE + pathname, {
      method,
      headers: { Authorization: MC_AUTH, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    const data = text ? JSON.parse(text) : {};
    return { ok: r.ok, status: r.status, data };
  }

  const body = await readBody(req);

  const name = String(body.name || '').trim();
  const surname = String(body.surname || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const gradaId = String(body.gradaId || '').trim();
  const gradaName = cleanGrada(body.gradaLabel);
  const sessionId = String(body.sessionId || '').trim();
  const eventId = String(body.eventId || '').trim();
  const privacy = body.privacy === true;

  if (!name || !surname || !EMAIL_RE.test(email) || !gradaId || !privacy) {
    return res.status(400).json({
      ok: false,
      error: 'Faltan campos obligatorios o el correo no es válido.',
    });
  }

  const subscriberHash = crypto.createHash('md5').update(email).digest('hex');

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
      const friendly = upsert.status === 400 && /compliance|unsubscrib|forgott|cleaned/i.test(detail)
        ? 'Este correo se dio de baja anteriormente y no se puede volver a suscribir automáticamente.'
        : detail;
      console.error(`Mailchimp upsert failed (${upsert.status}): ${detail}`);
      return res.status(502).json({ ok: false, error: friendly });
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

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Subscribe error:', err.message || err);
    return res.status(502).json({
      ok: false,
      error: 'No se pudo conectar con Mailchimp. Inténtalo de nuevo.',
    });
  }
};
