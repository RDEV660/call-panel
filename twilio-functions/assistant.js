// Twilio Function: /assistant   (Visibility: PUBLIC — protected by your panel password)
// action=live       -> transcript so far for a call
// action=summarize  -> AI (Surplus Intelligence) writes notes + extracts lead info, saves to lead list
// action=leads      -> every saved lead
// action=delete     -> remove one lead (by id)
const https = require('https');

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 8500,
    }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        let json; try { json = JSON.parse(out); } catch (e) { return reject(new Error(`AI returned ${res.statusCode}: ${out.slice(0, 200)}`)); }
        if (res.statusCode >= 400) return reject(new Error(`AI error ${res.statusCode}: ${(json.error && (json.error.message || json.error)) || out.slice(0, 200)}`));
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('AI took too long — try Summarize again')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function readTranscript(sync, callSid) {
  try {
    const items = await sync.syncLists(`t-${callSid}`).syncListItems.list({ pageSize: 1000 });
    return items.map((i) => i.data).sort((a, b) => a.t - b.t);
  } catch (e) {
    if (e.status === 404) return [];
    throw e;
  }
}

exports.handler = async function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');
  const send = (status, body) => { response.setStatusCode(status); response.setBody(body); return callback(null, response); };

  if (!context.PANEL_PASSWORD || event.password !== context.PANEL_PASSWORD) return send(401, { error: 'Wrong password' });

  const sync = context.getTwilioClient().sync.v1.services(context.SYNC_SERVICE_SID || 'default');
  const callSid = (event.callSid || '').replace(/[^A-Za-z0-9]/g, '');

  try {
    if (event.action === 'live') {
      if (!callSid) return send(400, { error: 'Missing callSid' });
      return send(200, { lines: await readTranscript(sync, callSid) });
    }

    if (event.action === 'leads') {
      try {
        const items = await sync.syncLists('leads').syncListItems.list({ pageSize: 1000, order: 'desc' });
        return send(200, { leads: items.map((i) => ({ id: i.index, ...i.data })) });
      } catch (e) { if (e.status === 404) return send(200, { leads: [] }); throw e; }
    }

    if (event.action === 'delete') {
      await sync.syncLists('leads').syncListItems(String(parseInt(event.id, 10))).remove();
      return send(200, { ok: true });
    }

    if (event.action === 'summarize') {
      if (!callSid) return send(400, { error: 'Missing callSid' });
      if (!context.SURPLUS_KEY) return send(500, { error: 'SURPLUS_KEY is not set in Environment Variables' });

      const lines = await readTranscript(sync, callSid);
      if (!lines.length) return send(200, { lead: null, note: 'No transcript for this call (too short, or nobody talked).' });

      const transcript = lines.map((l) => `${l.who}: ${l.text}`).join('\n').slice(-12000);
      const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const prompt = `You are a sales assistant for Eddieco, a small agency that builds websites and does SEO for local businesses.
Below is a phone call transcript. "You" is the Eddieco caller; "Them" is the business. Speech-to-text may have small errors.
Today is ${today} (Central Time).
${event.business ? `The caller noted the business is: ${event.business}` : ''}
Phone number called/calling: ${event.phone || 'unknown'}

Reply with ONLY a JSON object, no other text, with these keys:
"business_name": string or "",
"contact_name": name of the person spoken to, or "",
"owner_name": name of the business owner if mentioned, or "",
"is_decision_maker": "yes" | "no" | "unknown",
"interest": "hot" | "warm" | "cold" | "not interested" | "no answer/voicemail",
"has_website": "yes" | "no" | "unknown",
"meeting_requested": true or false,
"meeting_time": agreed meeting date/time in plain words (resolve "tomorrow", "Friday" etc. to a real date), or "",
"follow_up": what to do next and when, or "",
"objections": short list of concerns they raised, as one string, or "",
"best_contact": email/other number/best time to call if mentioned, or "",
"summary": 2-3 sentence summary of the call.

TRANSCRIPT:
${transcript}`;

      const ai = await postJson('https://api.surplusintelligence.ai/v1/chat/completions',
        { Authorization: `Bearer ${context.SURPLUS_KEY}` },
        { model: context.SURPLUS_MODEL || 'gemini-3.8-flash', messages: [{ role: 'user', content: prompt }], max_tokens: 700, temperature: 0.2 });

      const raw = (ai.choices && ai.choices[0] && ai.choices[0].message && ai.choices[0].message.content) || '';
      let lead;
      try { lead = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
      catch (e) { lead = { summary: raw.trim() || 'AI gave no answer' }; }

      lead.phone = event.phone || '';
      lead.direction = event.direction || '';
      lead.date = new Date().toISOString();
      lead.callSid = callSid;

      try { await sync.syncLists.create({ uniqueName: 'leads' }); } catch (e) { /* already exists */ }
      const saved = await sync.syncLists('leads').syncListItems.create({ data: lead });
      return send(200, { lead: { id: saved.index, ...lead } });
    }

    return send(400, { error: 'Unknown action' });
  } catch (err) {
    return send(500, { error: err.message || String(err) });
  }
};
