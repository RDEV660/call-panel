// Twilio Function: /token   (Visibility: PUBLIC)
// Gives the Eddieco Call Panel a short-lived access token, only if the password matches.
exports.handler = function (context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Access-Control-Allow-Origin', '*');
  response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Content-Type', 'application/json');

  if (!context.PANEL_PASSWORD || event.password !== context.PANEL_PASSWORD) {
    response.setStatusCode(401);
    response.setBody({ error: 'Wrong password' });
    return callback(null, response);
  }

  const identity = context.PANEL_IDENTITY || 'eddieco';
  const AccessToken = Twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;

  const token = new AccessToken(context.ACCOUNT_SID, context.PANEL_KEY || context.API_KEY, context.PANEL_SECRET || context.API_SECRET, {
    identity,
    ttl: 3600,
  });
  token.addGrant(new VoiceGrant({
    outgoingApplicationSid: context.TWIML_APP_SID,
    incomingAllow: true,
  }));

  response.setBody({ token: token.toJwt(), identity, callerId: context.CALLER_ID });
  return callback(null, response);
};
