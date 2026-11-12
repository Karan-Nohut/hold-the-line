# Hold the Line

A voice AI sparring partner for phone scams. An AI plays a scam caller, you practise resisting **out loud**, and a coach then tells you, in speech and on screen, where you held firm and where you gave ground.

Track: **Security** (with Real-Time Assistance).

## Run it

You need [Node.js](https://nodejs.org) 18 or newer and Chrome or Edge.

```bash
npm install
```

```bash
npm start
```

Then open <http://localhost:3000> in **Edge or Chrome** and allow the microphone when asked. Edge is recommended: its built-in "Natural" voices are much more expressive than Chrome's.

### Turn on the AI caller (recommended)

Without an API key the app still runs, using a scripted caller and a rule-based debrief. For a caller that actually responds to what you say:

1. Copy `.env.example` to `.env`.
2. Add **one** key:
   - **Google Gemini** (has a free tier): create a key at <https://aistudio.google.com/apikey> and put it after `GEMINI_API_KEY=`.
   - **Anthropic Claude**: create a key at <https://platform.claude.com> and put it after `ANTHROPIC_API_KEY=`.
3. Restart with `npm start`. The badge under the title changes to "AI caller (Gemini)" or "AI caller (Claude)".

If both keys are set, Gemini is used unless `.env` says `AI_PROVIDER=claude`.

**Gemini's free tier is small.** Each model has its own daily allowance (the main Flash model allowed only about 20 requests a day when this was built, and one practice call uses around eight). The app therefore keeps a list of models for each job and moves to the next one automatically when a model runs out, and if every model is out it falls back to the scripted caller. Quotas reset at midnight Pacific time.

### Optional: a more emotional voice

Put an [ElevenLabs](https://elevenlabs.io) API key after `ELEVENLABS_API_KEY=` in `.env` and restart. The caller and coach are then spoken by neural voices that act out each line's tone (a tearful "grandchild", a cold "officer"), and the caller is filtered to sound like a phone line. The badge shows "ElevenLabs voice". If a request fails or the credits run out, the browser voice takes over for that line. The free plan is enough for a handful of calls: each call uses roughly 1,000 to 1,500 characters of its monthly allowance.

### If voice does not work on your machine

- Voice recognition needs Chrome or Edge and an internet connection (the browser's speech service is online).
- If the microphone is blocked or missing, a text box appears so you can type your replies instead. You can also force it with <http://localhost:3000/?type=1>.
- The browser voices are whatever is installed on your device, so they sound different from machine to machine.

## How to use it

1. Read the made-up identity card. You are "Sam Rivera". Use only those details, never real ones.
2. Pick one of three calls: the bank "fraud team", the grandchild in trouble, or the arrest warrant.
3. Press **Answer**. The caller speaks, then it is your turn. Just talk.
4. End the call by saying "I'm hanging up" (or "goodbye"), or by pressing **Hang up**.
5. Listen to the debrief: your score and how it was worked out, what the caller got from you, your key moments, the pressure that was used, and one line to say next time.

Things worth trying in a demo:

- **Stay silent.** The caller pushes into the silence.
- **Read out the real one-time code.** The leak is caught and costs most of the score.
- **Give a made-up PIN or birthday.** The caller says it "does not match" and pushes harder; the debrief labels it a bluff, not a leak.
- **Hang up straight away.** That is the best possible score.

## How it works

```
Browser (public/)                          Server (server.js)
-----------------                          ------------------
microphone -> SpeechRecognition -> text
                                  POST /api/turn  ----->  the AI model plays the caller
speaker <- voice <- "{tone} words", streamed  <----------  (or the scripted caller)
                                  POST /api/speak  ---->  optional cloud voice acts the line
                                  POST /api/debrief --->  1. exact checks in code
debrief screen + coach voice  <--------------------------  2. AI coach  3. checked  4. scored in code
```

| File | What it does |
|---|---|
| `server.js` | Small Node HTTP server, no framework. Serves the page and the API routes. Keeps no state: the browser sends the whole transcript each time. |
| `lib/scenarios.js` | The made-up identity, the three scam scenarios, the list of caller tones, and the scripted lines used as a fallback. |
| `lib/ai.js` | The two AI calls: the caller (streamed) and the coach (structured JSON). Works with Gemini or Claude; the prompts are shared and only the small "send it" functions differ. |
| `lib/analysis.js` | Logic that needs no AI: spotting real leaks and made-up details, the scripted caller, the scoring rubric, and the checks on the AI coach's report. |
| `lib/voice.js` | The optional ElevenLabs voice. |
| `public/app.js` | The voice loop in the browser: listen, send, speak, repeat. |
| `test/analysis.test.js` | Unit tests for the plain-code logic. Run with `npm test`. |

### The caller's emotion

Every line the caller says starts with a tone, such as `{urgent}` or `{tearful}`, chosen by the model from a fixed list of ten. The tone escalates as you refuse and softens when the caller is getting what it wants. It is used three ways: it drives the delivery of the voice (speed and pitch for browser voices, acting directions for the cloud voice), it is shown above each line in the transcript, and the debrief reports how the tone shifted over the call.

### How a call is judged

The judgement is split so that facts are never left to the AI:

1. **Exact checks in code.** Everything you said is compared with the four secrets on the card. A match is a **leak**. Numbers that look like a code, PIN, card number or year but do not match are **made-up details**: a bluff, not a leak.
2. **The AI coach** reads the transcript along with those results. It writes the coaching, labels your key moments (held firm, gave ground, bluffed), and answers three yes/no questions: did you agree to pay or act, did you challenge the caller, did you say you would check through a trusted number.
3. **The report is checked.** Any quote that does not appear in the transcript is dropped, and a bluff can never be labelled as giving information away.
4. **The score is calculated in code** from those facts:

| | Points | How it is earned |
|---|---|---|
| Kept your secrets | 50 | 50 for no leaks, 10 for one, 0 for more |
| Refused to act | 15 | Never agreed to pay, move money or follow an instruction |
| Got off the line | 20 | Ended the call yourself, minus 3 per reply after the third, minus 5 if you stayed to bluff |
| Checked the story safely | 15 | 15 for naming a trusted way to check (or leaving at once), 8 for challenging the caller |

### Other design choices

- **Turn-taking, not full duplex.** The app listens only while the caller is not speaking. That avoids the caller's voice being picked up by the microphone, and it works on laptop speakers without headphones.
- **Streamed replies.** The caller starts talking before the full reply exists. Browser voices speak each sentence as it arrives. The cloud voice acts the first sentence straight away and prepares the rest of the line while that sentence plays, which brought the gap after you finish speaking down from about 6 seconds to under 2.
- **A fixed opening line.** The first line of each call is scripted, so the caller speaks the instant you answer.
- **Silence is an input.** If you say nothing, that is sent to the caller as silence and they press harder. The pause before each of your replies is also measured and passed to the coach.
- **The caller finds out when details are false.** The caller is told the real values only so it can react as a real scam would play out: a made-up code "fails" and the pressure goes up.
- **A made-up identity.** Nobody speaks real personal details into a microphone.
- **It always runs.** With no key, a missing SDK, an exhausted quota or a failed request, the app falls back (next model, then scripted caller and rule-based debrief; browser voice for speech) instead of breaking mid-call.
- **Only fictional organisations.** The caller is instructed never to name a real bank or agency.

### Models

| Job | Gemini (tried in order) | Claude |
|---|---|---|
| Caller (one request per line; speed matters) | `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-3.5-flash`, `gemini-3.6-flash` | `claude-opus-5-5` |
| Coach (one request per call) | `gemini-3.5-flash`, `gemini-3.6-flash`, then the lite models | `claude-opus-5-5` |

Change them with `GEMINI_MODEL`, `GEMINI_COACH_MODEL` or `SCAM_MODEL` in `.env`.

## Known limits

- Speech recognition comes from the browser, so accuracy depends on the device and accent.
- Browser voices can change speed and pitch but cannot truly act; the cloud voice is the better experience.
- You cannot interrupt the caller mid-sentence.
- Made-up details are only detected in code when they contain a number of four or more digits. Other false details rely on the AI coach's judgement.
- English only. Nothing is saved: there is no history of past calls.

## Tests

```bash
npm test
```
