// Twilio Function: /voice   (Visibility: PROTECTED — only Twilio can call it)
// Outbound: panel -> phone number.  Inbound: your Twilio number -> rings the panel.
exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  const to = (event.To || '').trim();
  const fromPanel = (event.From || '').startsWith('client:');

  if (fromPanel && to) {
    const dial = twiml.dial({ callerId: context.CALLER_ID, answerOnBridge: true });
    if (/^[\d+\-() ]+$/.test(to)) dial.number(to.replace(/[^\d+]/g, ''));
    else dial.client(to);
  } else {
    const dial = twiml.dial({ answerOnBridge: true, timeout: 25 });
    dial.client(context.PANEL_IDENTITY || 'eddieco');
    twiml.say('Sorry, nobody is available right now. Please try again later.');
  }

  return callback(null, twiml);
};
