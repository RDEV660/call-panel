# Eddieco Call Panel

Make and receive phone calls in your browser. The panel is hosted free on **GitHub Pages**; the two small server pieces run free on **Twilio Functions**, so you don't need a domain or a computer left on.

## Part A — Twilio Functions (the "server")

1. Twilio Console → **Functions and Assets → Services → Create Service**, name it `eddieco-panel`.
2. Click **Add + → Add Function**, path `/token`. Paste in `twilio-functions/token.js`. Set its visibility to **Public**.
3. **Add + → Add Function**, path `/voice`. Paste in `twilio-functions/voice.js`. Leave its visibility as **Protected**.
4. **Settings → Environment Variables**: add these (ACCOUNT_SID is already provided automatically):

   | Key | Value |
   |---|---|
   | `API_KEY` | your API key SID (`SK…`) |
   | `API_SECRET` | your API key secret |
   | `TWIML_APP_SID` | from step 6 below (`AP…`) |
   | `CALLER_ID` | your Twilio number, like `+19565550123` |
   | `PANEL_PASSWORD` | a strong password you'll type into the panel |
   | `PANEL_IDENTITY` | `eddieco` |

5. Click **Deploy All**. Copy your service address at the bottom, which looks like `https://eddieco-panel-1234.twil.io`.
6. Console → **Voice → TwiML Apps → Create**. Name it `Eddieco Panel` and set the Voice Request URL to `https://eddieco-panel-1234.twil.io/voice` (HTTP POST). Save, copy its SID (`AP…`) into `TWIML_APP_SID`, then **Deploy All** again.
7. **Phone Numbers → your number → Voice configuration**: set "A call comes in" to **Function → eddieco-panel → /voice**. Save.

## Part B — GitHub Pages (the panel)

1. On github.com click **+ → New repository**, name it `eddieco-call-panel`, make it Public, and create it.
2. Click **uploading an existing file**, drag in `index.html` (and this README if you like), then click **Commit changes**.
3. Go to the repo's **Settings → Pages**. Set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After about a minute your panel is live at `https://YOUR-USERNAME.github.io/eddieco-call-panel/`.

## Use it

Open the panel, paste your `twil.io` address and password, then click **Go online**. The address is remembered after the first time. Allow microphone access when your browser asks.

- Type a number (10-digit US numbers get +1 added automatically) and press **Call**. During a call the keypad sends tones, and you can **Mute** or **Hang up**.
- Calls to your Twilio number pop up with **Answer / Decline** while the panel tab is open. If nobody answers in 25 seconds, the caller hears a "nobody is available" message.

## Notes

- **No secrets are on GitHub.** Your API secret and password live only in Twilio's environment variables. Never put them in `index.html`.
- **Trial accounts** can only call verified numbers and play a trial message first.
- If you record calls, some states (e.g. California) require telling the other person.
