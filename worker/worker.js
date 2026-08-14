/* Bracket Attack sync worker (deployed as `bracket-attack-sync` on Cloudflare).
   Tiny room-based JSON store on D1.

   API:
     GET /r/:room?since=N -> { version, state } (or { version, unchanged: true })
     PUT /r/:room  body { state } -> { version }

   D1 schema:
     CREATE TABLE rooms (id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0,
                         state TEXT NOT NULL, updated TEXT);

   Redeploy with: npx wrangler deploy worker/worker.js --name bracket-attack-sync
   (bind the D1 database as `DB`). */

export default {
  async fetch(req, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/r\/([a-zA-Z0-9_-]{1,64})$/);
    if (!m) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: cors });
    const room = m[1].toLowerCase();

    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT version, state FROM rooms WHERE id = ?').bind(room).first();
      if (!row) return new Response(JSON.stringify({ version: 0, state: null }), { headers: cors });
      const since = Number(url.searchParams.get('since') || -1);
      if (since >= row.version) {
        return new Response(JSON.stringify({ version: row.version, unchanged: true }), { headers: cors });
      }
      return new Response(JSON.stringify({ version: row.version, state: JSON.parse(row.state) }), { headers: cors });
    }

    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch {
        return new Response(JSON.stringify({ error: 'bad json' }), { status: 400, headers: cors });
      }
      if (!body || typeof body.state !== 'object' || body.state === null) {
        return new Response(JSON.stringify({ error: 'missing state' }), { status: 400, headers: cors });
      }
      const text = JSON.stringify(body.state);
      if (text.length > 900000) {
        return new Response(JSON.stringify({ error: 'state too large' }), { status: 413, headers: cors });
      }
      const row = await env.DB.prepare(
        `INSERT INTO rooms (id, version, state, updated) VALUES (?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET version = version + 1, state = excluded.state, updated = excluded.updated
         RETURNING version`
      ).bind(room, text, new Date().toISOString()).first();
      return new Response(JSON.stringify({ version: row.version }), { headers: cors });
    }

    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers: cors });
  },
};
