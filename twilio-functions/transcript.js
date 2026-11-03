// Twilio Function: /transcript   (Visibility: PROTECTED — only Twilio can call it)
// Receives live transcription from Twilio and stores each finished sentence.
exports.handler = async function (context, event, callback) {
  if (event.TranscriptionEvent !== 'transcription-content' || event.Final !== 'true') {
    return callback(null, 'ok');
  }

  let text = '';
  try { text = JSON.parse(event.TranscriptionData || '{}').transcript || ''; } catch (e) {}
  text = text.trim();
  if (!text) return callback(null, 'ok');

  // Who said it: on calls you make, the inbound track is you; on calls you receive, it's them.
  const youTrack = event.dir === 'in' ? 'outbound_track' : 'inbound_track';
  const who = event.Track === youTrack ? 'You' : 'Them';

  const sync = context.getTwilioClient().sync.v1.services(context.SYNC_SERVICE_SID || 'default');
  const listName = `t-${event.CallSid}`;
  const item = { who, text, t: Date.now() };

  try {
    await sync.syncLists(listName).syncListItems.create({ data: item });
  } catch (err) {
    if (err.status !== 404) return callback(err);
    try { await sync.syncLists.create({ uniqueName: listName, ttl: 7 * 86400 }); } catch (e) { /* created by a parallel request */ }
    await sync.syncLists(listName).syncListItems.create({ data: item });
  }
  return callback(null, 'ok');
};
