// Twilio Function: /assistant   (Visibility: PUBLIC — protected by your panel password)
// Call notes:  live | summarize | leads | delete
// Lead finder: find | prospects | prospectUpdate | prospectDelete
const https = require('https');

function request(url, { method = 'GET', headers = {}, body = null, timeout = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { 'User-Agent': 'EddiecoCallPanel/1.0', ...headers };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers: h, timeout }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        let json; try { json = JSON.parse(out); } catch (e) { return reject(new Error(`${u.hostname} returned ${res.statusCode}: ${out.slice(0, 160)}`)); }
        if (res.statusCode >= 400) {
          const m = json.error && (json.error.message || json.error);
          return reject(new Error(`${u.hostname} error ${res.statusCode}: ${typeof m === 'string' ? m : out.slice(0, 160)}`));
        }
        resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function listAll(sync, name, order) {
  try { return await sync.syncLists(name).syncListItems.list({ pageSize: 1000, order }); }
  catch (e) { if (e.status === 404) return []; throw e; }
}
async function append(sync, name, data) {
  try { return await sync.syncLists(name).syncListItems.create({ data }); }
  catch (e) {
    if (e.status !== 404) throw e;
    try { await sync.syncLists.create({ uniqueName: name }); } catch (x) { /* exists */ }
    return sync.syncLists(name).syncListItems.create({ data });
  }
}
const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10);
const isFacebook = (url) => /facebook\.com|fb\.com|instagram\.com/i.test(url || '');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// Kinds of small businesses that often have no website — used for "just type an area" searches
const RANDOM_KINDS = ['barber shop', 'nail salon', 'taqueria', 'food truck', 'auto repair shop', 'lawn care service', 'landscaping',
  'tire shop', 'panaderia bakery', 'hair salon', 'car wash', 'roofing contractor', 'plumber', 'A/C repair', 'tattoo shop',
  'pet grooming', 'meat market carniceria', 'upholstery shop', 'welding shop', 'mobile mechanic', 'house cleaning service',
  'event hall', 'boutique', 'flower shop', 'paleteria', 'raspa stand', 'mariscos restaurant', 'auto detailing', 'towing service',
  'handyman', 'pool service', 'pest control', 'electrician', 'fence company', 'concrete contractor', 'party rentals bounce house',
  'quinceanera dresses', 'tamales', 'barbacoa', 'transmission shop', 'body shop collision', 'locksmith', 'tailor alterations',
  'daycare', 'cake shop', 'smoke shop', 'western wear', 'auto glass', 'window tint', 'muffler shop'];

// ---------------- Owner lookup (Texas TDLR license records, free public data) ----------------
const RGV_COUNTIES = ['HIDALGO', 'CAMERON', 'STARR', 'WILLACY'];
const NAME_STOP = new Set(['LLC', 'L.L.C', 'INC', 'CORP', 'CO', 'THE', 'AND', '&', 'SERVICE', 'SERVICES', 'SHOP', 'COMPANY', 'OF', 'RGV',
  'TX', 'TEXAS', 'MCALLEN', 'MISSION', 'PHARR', 'EDINBURG', 'LA', 'EL', 'LOS', 'LAS', 'DE', 'Y', 'A/C', 'AC', 'AIR', 'CONDITIONING', 'HEATING']);
function niceName(n) {
  // "SALINAS, ROEL JR" -> "Roel Salinas Jr"
  const cap = (w) => w.toLowerCase().replace(/(^|[\s'-])\S/g, (m) => m.toUpperCase());
  const parts = String(n || '').split(',');
  if (parts.length < 2) return cap(n);
  const last = parts[0].trim(), rest = parts.slice(1).join(' ').trim().split(/\s+/);
  const suffix = /^(JR|SR|II|III|IV)$/.test(rest[rest.length - 1]) ? ' ' + cap(rest.pop()) : '';
  return cap(`${rest.join(' ')} ${last}`) + suffix;
}
const looksLikePerson = (owner, biz) => owner && owner.includes(',') && owner.toUpperCase() !== String(biz || '').toUpperCase();

async function lookupOwner(p) {
  const soql = (s) => s.replace(/'/g, "''");
  const conds = [];
  const ph = digits(p.phone);
  if (ph.length === 10) conds.push(`business_telephone='${ph}'`, `owner_telephone='${ph}'`);
  const words = String(p.name || '').toUpperCase().replace(/[^A-Z0-9' &]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !NAME_STOP.has(w)).slice(0, 2);
  if (words.length) conds.push(`upper(business_name) like '%${words.map(soql).join('%')}%'`);
  if (!conds.length) return null;
  const where = `(${conds.join(' OR ')}) AND business_county in(${RGV_COUNTIES.map((c) => `'${c}'`).join(',')})`;
  const url = `https://data.texas.gov/resource/7358-krk7.json?$select=business_name,owner_name,license_type,business_telephone,owner_telephone&$limit=25&$where=${encodeURIComponent(where)}`;
  const rows = await request(url, { timeout: 4500 });
  const sig = (n) => String(n || '').toUpperCase().replace(/[^A-Z0-9' &]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !NAME_STOP.has(w));
  const ours = new Set(sig(p.name));
  // Only accept: same phone, OR the same significant name words both ways (no fuzzy guessing)
  const strong = (r) => {
    if (ph && (r.business_telephone === ph || r.owner_telephone === ph)) return true;
    const theirs = sig(r.business_name);
    return theirs.length > 0 && ours.size > 0 && theirs.every((w) => ours.has(w)) && [...ours].every((w) => theirs.includes(w));
  };
  const hits = rows.filter((r) => looksLikePerson(r.owner_name, r.business_name) && strong(r));
  if (!hits.length) return null;
  const owners = [...new Set(hits.map((h) => h.owner_name))];
  if (owners.length > 1) return null;   // two different people match — don't guess
  const best = hits[0];
  return { owner: niceName(best.owner_name), source: `TX license (${best.license_type})`, licensedAs: best.business_name };
}

// ---------------- Lead finder sources ----------------
async function findGoogle(key, q) {
  const r = await request('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', timeout: 8000,
    headers: {
      'Content-Type': 'application/json', 'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.businessStatus',
    },
    body: { textQuery: q, pageSize: 20 },
  });
  return (r.places || [])
    .filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
    .map((p) => ({
      name: p.displayName && p.displayName.text, phone: p.nationalPhoneNumber || '', address: p.formattedAddress || '',
      category: p.primaryTypeDisplayName && p.primaryTypeDisplayName.text, rating: p.rating || '', reviews: p.userRatingCount || 0,
      site: p.websiteUri || '', ref: `g:${p.id}`,
    }));
}

const OSM_TAGS = [
  [/barber|hair/i, ['shop~"^(hairdresser|barber)$"']],
  [/nail|beauty|salon|spa|lash|brow/i, ['shop~"^(beauty|nails|hairdresser|cosmetics)$"']],
  [/taco|taquer|restaurant|food|cafe|coffee|diner|grill|bbq|pizza|burger/i, ['amenity~"^(restaurant|fast_food|cafe)$"']],
  [/bakery|panader|donut/i, ['shop~"^(bakery|pastry|confectionery)$"']],
  [/auto|car|mechanic|tire|tyre|transmission|body shop/i, ['shop~"^(car_repair|tyres|car_parts|car)$"', 'craft=car_repair']],
  [/lawn|landscap|garden|tree/i, ['craft=gardener', 'shop=garden_centre']],
  [/plumb/i, ['craft=plumber']], [/electric/i, ['craft=electrician']], [/roof/i, ['craft=roofer']],
  [/hvac|air condition|a\/c/i, ['craft=hvac']], [/clean|laundr/i, ['shop~"^(dry_cleaning|laundry)$"']],
  [/dentist|dental/i, ['amenity=dentist']], [/gym|fitness/i, ['leisure=fitness_centre']],
  [/tattoo/i, ['shop=tattoo']], [/florist|flower/i, ['shop=florist']], [/pet|groom/i, ['shop=pet', 'shop=pet_grooming']],
];
async function findOSM(q) {
  const m = q.match(/^(.*?)\s+(?:in|near|around)\s+(.+)$/i);
  const what = m ? m[1] : '', where = m ? m[2] : q;
  const geo = await request(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(where)}`, { timeout: 3000 });
  if (!geo.length) throw new Error(`Couldn't find the place "${where}"`);
  const { lat, lon } = geo[0];
  const match = what && OSM_TAGS.find(([re]) => re.test(what));
  const filters = !what ? ['[shop][name]', '[craft][name]', '[amenity~"^(restaurant|fast_food|cafe)$"][name]']
    : match ? match[1].map((f) => `[${f}]`) : [`[name~"${what.replace(/["\\]/g, '')}",i]`];
  const ql = `[out:json][timeout:6];(${filters.map((f) => `nwr${f}(around:20000,${lat},${lon});`).join('')});out center tags 80;`;
  const r = await request('https://overpass-api.de/api/interpreter', {
    method: 'POST', timeout: 6500, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql),
  });
  return (r.elements || []).filter((e) => e.tags && e.tags.name).map((e) => {
    const t = e.tags;
    const addr = [[t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' '), t['addr:city']].filter(Boolean).join(', ');
    return {
      name: t.name, phone: t.phone || t['contact:phone'] || '', address: addr,
      category: (t.shop || t.amenity || t.craft || t.leisure || '').replace(/_/g, ' '), rating: '', reviews: 0,
      site: t.website || t['contact:website'] || t.url || t['contact:facebook'] || '', ref: `o:${e.type}/${e.id}`,
    };
  });
}

// ---------------- Handler ----------------
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
  const prospectsOut = async () => (await listAll(sync, 'prospects', 'desc')).map((i) => ({ id: i.index, ...i.data }));

  try {
    switch (event.action) {
      // ----- live transcript -----
      case 'live': {
        if (!callSid) return send(400, { error: 'Missing callSid' });
        const items = await listAll(sync, `t-${callSid}`);
        return send(200, { lines: items.map((i) => i.data).sort((a, b) => a.t - b.t) });
      }

      // ----- AI call notes -----
      case 'summarize': {
        if (!callSid) return send(400, { error: 'Missing callSid' });
        if (!context.SURPLUS_KEY) return send(500, { error: 'SURPLUS_KEY is not set in Environment Variables' });
        const lines = (await listAll(sync, `t-${callSid}`)).map((i) => i.data).sort((a, b) => a.t - b.t);
        if (!lines.length) return send(200, { lead: null, note: 'No transcript for this call (too short, or nobody talked).' });

        const transcript = lines.map((l) => `${l.who}: ${l.text}`).join('\n').slice(-8000);
        const today = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        const prompt = `Sales call notes for Eddieco (builds websites + SEO for local businesses). "You"=Eddieco caller, "Them"=the business. The call may be in English, Spanish, or a mix — understand both, but write every note in English (keep names as spoken). Today is ${today}.
${event.business ? `Business: ${event.business}. ` : ''}Phone: ${event.phone || 'unknown'}.
Reply with ONLY compact JSON, keys: business_name, contact_name, owner_name, is_decision_maker (yes/no/unknown), interest (hot/warm/cold/not interested/no answer), has_website (yes/no/unknown), meeting_requested (true/false), meeting_time (real date+time, or ""), follow_up, objections, best_contact, follow_up_date (YYYY-MM-DD or ""), summary (max 2 sentences). Use "" when unknown.

${transcript}`;

        const body = {
          model: context.SURPLUS_MODEL || 'deepseek-v4-pro-0813',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 4000, temperature: 0.1, reasoning_effort: 'low',
        };
        if (context.SURPLUS_PROVIDER) body.provider_order = context.SURPLUS_PROVIDER.split(',').map((s) => s.trim());

        let ai;
        try {
          ai = await request('https://api.surplusintelligence.ai/v1/chat/completions', {
            method: 'POST', timeout: 8300, body,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${context.SURPLUS_KEY}` },
          });
        } catch (e) {
          if (e.message === 'TIMEOUT') return send(504, { error: 'AI took too long', retry: true });
          throw e;
        }
        const raw = (ai.choices && ai.choices[0] && ai.choices[0].message && ai.choices[0].message.content) || '';
        let lead;
        try { lead = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); }
        catch (e) { lead = { summary: raw.trim() || 'AI gave no answer' }; }
        Object.assign(lead, { phone: event.phone || '', direction: event.direction || '', date: new Date().toISOString(), callSid, prospectId: event.prospectId || '' });

        const saved = await append(sync, 'leads', lead);
        return send(200, { lead: { id: saved.index, ...lead } });
      }

      // ----- browser-side AI (no 10-second limit) -----
      case 'aiConfig':
        if (!context.SURPLUS_KEY) return send(500, { error: 'SURPLUS_KEY is not set in Environment Variables' });
        return send(200, {
          key: context.SURPLUS_KEY,
          model: context.SURPLUS_MODEL || 'deepseek-v4-pro-0813',
          coachModel: context.COACH_MODEL || context.SURPLUS_MODEL || 'deepseek-v4-pro-0813',
          provider: context.SURPLUS_PROVIDER || '',
        });

      case 'saveLead': {
        let lead = {}; try { lead = JSON.parse(event.lead || '{}'); } catch (e) { return send(400, { error: 'Bad lead data' }); }
        Object.assign(lead, { phone: event.phone || '', direction: event.direction || '', date: new Date().toISOString(), callSid, prospectId: event.prospectId || '' });
        const saved = await append(sync, 'leads', lead);
        return send(200, { lead: { id: saved.index, ...lead } });
      }

      case 'leads': {
        const items = await listAll(sync, 'leads', 'desc');
        return send(200, { leads: items.map((i) => ({ id: i.index, ...i.data })) });
      }
      case 'delete': {
        await sync.syncLists('leads').syncListItems(String(parseInt(event.id, 10))).remove();
        return send(200, { ok: true });
      }

      // ----- lead finder -----
      case 'prospects':
        return send(200, { prospects: await prospectsOut() });

      case 'find': {
        const q = String(event.q || '').trim().slice(0, 120);
        if (!q) return send(400, { error: 'Type what to search for' });
        let found, source, kinds = [];
        const areaOnly = event.random === '1' || !/\s(in|near|around)\s/i.test(` ${q} `);
        if (context.GOOGLE_PLACES_KEY) {
          if (areaOnly) {
            kinds = shuffle([...RANDOM_KINDS]).slice(0, 3);
            const area = q.replace(/^.*\s(in|near|around)\s/i, '');
            const lists = await Promise.all(kinds.map((k) => findGoogle(context.GOOGLE_PLACES_KEY, `${k} in ${area}`).catch(() => [])));
            found = shuffle(lists.flat());
          } else found = await findGoogle(context.GOOGLE_PLACES_KEY, q);
          source = 'Google Maps';
        } else {
          found = await findOSM(q);
          if (areaOnly) found = shuffle(found);
          source = 'OpenStreetMap (add GOOGLE_PLACES_KEY for better results)';
        }

        const existing = (await listAll(sync, 'prospects')).map((i) => i.data);
        const seenPhones = new Set(existing.map((p) => digits(p.phone)).filter(Boolean));
        const seenRefs = new Set(existing.map((p) => p.ref));
        let added = 0, skipped = 0;
        const fresh = found.filter((f) => {
          const bad = !f.name || (f.site && !isFacebook(f.site)) || seenRefs.has(f.ref) || (digits(f.phone) && seenPhones.has(digits(f.phone)));
          if (bad) { skipped++; return false; }
          seenRefs.add(f.ref); if (digits(f.phone)) seenPhones.add(digits(f.phone));
          return true;
        });
        await Promise.all(fresh.map((f) => {
          added++;
          return append(sync, 'prospects', {
            name: f.name, phone: f.phone, address: f.address, category: f.category || '', rating: f.rating, reviews: f.reviews,
            website: f.site ? 'facebook' : 'none', site: f.site || '', ref: f.ref, status: 'new', search: q, added: new Date().toISOString(),
          });
        }));
        return send(200, { added, skipped, source, kinds, prospects: await prospectsOut() });
      }

      case 'prospectUpdate': {
        const id = String(parseInt(event.id, 10));
        let fields = {}; try { fields = JSON.parse(event.fields || '{}'); } catch (e) {}
        const allowed = ['status', 'lastNote', 'lastCalled', 'owner', 'ownerSource', 'contact', 'meeting', 'notes'];
        const item = await sync.syncLists('prospects').syncListItems(id).fetch();
        const data = { ...item.data };
        allowed.forEach((k) => { if (fields[k] !== undefined) data[k] = String(fields[k]).slice(0, 500); });
        await sync.syncLists('prospects').syncListItems(id).update({ data });
        return send(200, { prospect: { id: Number(id), ...data } });
      }

      case 'prospectDelete': {
        await sync.syncLists('prospects').syncListItems(String(parseInt(event.id, 10))).remove();
        return send(200, { ok: true });
      }

      // ----- owner lookup -----
      case 'findOwner': {
        const id = String(parseInt(event.id, 10));
        const item = await sync.syncLists('prospects').syncListItems(id).fetch();
        const data = { ...item.data };
        let hit = null;
        try { hit = await lookupOwner(data); } catch (e) { return send(200, { found: false, note: 'License records are slow right now — try again' }); }
        data.ownerChecked = new Date().toISOString();
        if (hit && !data.owner) { data.owner = hit.owner; data.ownerSource = hit.source; }
        await sync.syncLists('prospects').syncListItems(id).update({ data });
        return send(200, { found: !!hit, ...(hit || {}), prospect: { id: Number(id), ...data } });
      }

      // ----- tasks + game events (shared between everyone using the panel) -----
      case 'listGet': case 'listAdd': case 'listUpdate': case 'listDelete': {
        const list = String(event.list || '');
        if (!['tasks', 'events'].includes(list)) return send(400, { error: 'Unknown list' });
        if (event.action === 'listGet') {
          const items = await listAll(sync, list, 'desc');
          return send(200, { items: items.slice(0, 1000).map((i) => ({ id: i.index, ...i.data })) });
        }
        let data = {}; try { data = JSON.parse(event.data || '{}'); } catch (e) {}
        if (JSON.stringify(data).length > 4000) return send(400, { error: 'Too big' });
        if (event.action === 'listAdd') {
          const saved = await append(sync, list, { ...data, t: Date.now() });
          return send(200, { item: { id: saved.index, ...saved.data } });
        }
        const id = String(parseInt(event.id, 10));
        if (event.action === 'listDelete') { await sync.syncLists(list).syncListItems(id).remove(); return send(200, { ok: true }); }
        const cur = await sync.syncLists(list).syncListItems(id).fetch();
        const merged = { ...cur.data, ...data };
        await sync.syncLists(list).syncListItems(id).update({ data: merged });
        return send(200, { item: { id: Number(id), ...merged } });
      }

      default:
        return send(400, { error: 'Unknown action' });
    }
  } catch (err) {
    return send(500, { error: err.message === 'TIMEOUT' ? 'The search took too long — try again' : (err.message || String(err)) });
  }
};
