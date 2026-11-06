// Twilio Function: /transcript   (Visibility: PROTECTED — only Twilio can call it)
// Live words (partials) go into a Sync Map so the panel can show them while people talk.
// Finished sentences go into a Sync List, ordered by when the person STARTED talking.
exports.handler = async function (context, event, callback) {
  if (event.TranscriptionEvent !== 'transcription-content') return callback(null, 'ok');

  let text = '';
  try { text = JSON.parse(event.TranscriptionData || '{}').transcript || ''; } catch (e) {}
  text = text.trim();

  const youTrack = event.dir === 'in' ? 'outbound_track' : 'inbound_track';
  const who = event.Track === youTrack ? 'You' : 'Them';
  const key = event.Track || 'track';
  const now = Date.now();

  const sync = context.getTwilioClient().sync.v1.services(context.SYNC_SERVICE_SID || 'default');
  const mapName = `p-${event.CallSid}`;
  const listName = `t-${event.CallSid}`;
  const map = () => sync.syncMaps(mapName);

  // When did this sentence start? (set by the first partial of the sentence)
  let started = null;
  try { started = (await map().syncMapItems(key).fetch()).data.start; } catch (e) { /* none yet */ }

  try {
    if (event.Final === 'true') {
      try { await map().syncMapItems(key).remove(); } catch (e) {}
      if (!text) return callback(null, 'ok');
      const item = { who, text, t: started || now };
      try { await sync.syncLists(listName).syncListItems.create({ data: item }); }
      catch (err) {
        if (err.status !== 404) throw err;
        try { await sync.syncLists.create({ uniqueName: listName, ttl: 7 * 86400 }); } catch (e) {}
        await sync.syncLists(listName).syncListItems.create({ data: item });
      }
    } else {
      if (!text) return callback(null, 'ok');
      const data = { who, text, start: started || now, updated: now };
      try { await map().syncMapItems(key).update({ data }); }
      catch (err) {
        if (err.status !== 404) throw err;
        try { await map().syncMapItems.create({ key, data }); }
        catch (e2) {
          if (e2.status !== 404) throw e2;
          try { await sync.syncMaps.create({ uniqueName: mapName, ttl: 86400 }); } catch (e) {}
          await map().syncMapItems.create({ key, data });
        }
      }
    }
  } catch (err) {
    console.error(err.message);
  }
  return callback(null, 'ok');
};
