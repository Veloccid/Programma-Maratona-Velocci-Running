// api/strava.js — backend Velocci per Strava
// Il Client Secret vive SOLO qui (Environment Variables di Vercel),
// non arriva mai al browser.

const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API_BASE  = 'https://www.strava.com/api/v3';

export default async function handler(req, res) {
  const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
  const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).json({
      error: 'config_mancante',
      message: 'STRAVA_CLIENT_ID o STRAVA_CLIENT_SECRET non impostati su Vercel.'
    });
  }

  // ── GET: restituisce solo il Client ID (dato pubblico, serve al redirect OAuth)
  if (req.method === 'GET') {
    return res.status(200).json({ clientId: CLIENT_ID });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'metodo_non_permesso' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const action = body.action;

  try {
    // ── 1. Scambio del codice OAuth con i token
    if (action === 'exchange') {
      if (!body.code) return res.status(400).json({ error: 'codice_mancante' });
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code: body.code,
          grant_type: 'authorization_code'
        })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'scambio_fallito', details: data });
      return res.status(200).json(tokenPayload(data));
    }

    // ── 2. Rinnovo del token scaduto
    if (action === 'refresh') {
      if (!body.refresh_token) return res.status(400).json({ error: 'refresh_token_mancante' });
      const r = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: body.refresh_token,
          grant_type: 'refresh_token'
        })
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'rinnovo_fallito', details: data });
      return res.status(200).json(tokenPayload(data));
    }

    // ── 3. Elenco attività in una finestra di date
    if (action === 'activities') {
      if (!body.access_token) return res.status(400).json({ error: 'access_token_mancante' });
      const params = new URLSearchParams({ per_page: '100' });
      if (body.after)  params.set('after',  String(body.after));
      if (body.before) params.set('before', String(body.before));

      const r = await fetch(`${API_BASE}/athlete/activities?${params}`, {
        headers: { Authorization: `Bearer ${body.access_token}` }
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: 'attivita_fallite', details: data });

      // Riduco al minimo indispensabile: meno dati in giro, risposta più leggera
      const slim = (Array.isArray(data) ? data : []).map(a => ({
        id: a.id,
        name: a.name,
        type: a.sport_type || a.type,
        start: a.start_date_local,
        km: a.distance ? Math.round(a.distance / 100) / 10 : 0,
        moving: a.moving_time || 0,
        hr: a.average_heartrate ? Math.round(a.average_heartrate) : null,
        maxHr: a.max_heartrate ? Math.round(a.max_heartrate) : null,
        elev: a.total_elevation_gain ? Math.round(a.total_elevation_gain) : 0
      }));
      return res.status(200).json({ activities: slim });
    }

    return res.status(400).json({ error: 'azione_sconosciuta', action: action || null });

  } catch (err) {
    return res.status(500).json({ error: 'errore_server', message: String(err && err.message || err) });
  }
}

function tokenPayload(d) {
  return {
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    expires_at:    d.expires_at,
    athlete: d.athlete ? { id: d.athlete.id, firstname: d.athlete.firstname } : null
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
