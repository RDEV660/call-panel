// Twilio Function: /voice   (Visibility: PROTECTED — only Twilio can call it)
// Outbound: panel -> phone number.  Inbound: your Twilio number -> rings the panel.
// Also starts live transcription so the AI assistant can take notes.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

exports.handler = function (context, event, callback) {
  const to = (event.To || '').trim();
  const fromPanel = (event.From || '').startsWith('client:');
  const transcribe = (context.TRANSCRIBE || 'on') !== 'off';
  const identity = context.PANEL_IDENTITY || 'eddieco';

  const startTranscript = (dir) => !transcribe ? '' :
    `<Start><Transcription statusCallbackUrl="https://${esc(context.DOMAIN_NAME)}/transcript?dir=${dir}" track="both_tracks" ` +
    `partialResults="false" transcriptionEngine="deepgram" speechModel="nova-3" ` +
    `languageCode="${esc(context.TRANSCRIBE_LANGUAGE || 'multi')}"/></Start>`;

  let body;
  if (fromPanel && to) {
    // Outbound: browser -> phone number (or another panel)
    const target = /^[\d+\-() ]+$/.test(to)
      ? `<Number>${esc(to.replace(/[^\d+]/g, ''))}</Number>`
      : `<Client>${esc(to)}</Client>`;
    body = startTranscript('out') +
      `<Dial callerId="${esc(context.CALLER_ID)}" answerOnBridge="true">${target}</Dial>`;
  } else {
    // Inbound: someone called your Twilio number -> ring the panel
    body = startTranscript('in') +
      `<Dial answerOnBridge="true" timeout="25"><Client><Identity>${esc(identity)}</Identity>` +
      `<Parameter name="parentSid" value="${esc(event.CallSid || '')}"/></Client></Dial>` +
      `<Say>Sorry, nobody is available right now. Please try again later.</Say>`;
  }

  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'text/xml');
  response.setBody(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`);
  return callback(null, response);
};
