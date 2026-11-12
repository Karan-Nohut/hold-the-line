# AI tools used

## Summary

| Tool | Used for |
|---|---|
| Claude Code (desktop app, Claude Fable 5.2) | Reading the brief, proposing project ideas, writing the code and the documents, and testing in a browser |
| Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.5-flash` and others in rotation) | Runs inside the product: plays the scam caller and writes the coaching |
| ElevenLabs API (optional, `eleven_v4_turbo`) | Runs inside the product: a more emotional voice for the caller and coach, acting out the tone of each line |
| Claude API (`claude-opus-5-5`) | Supported as an alternative provider for the same two jobs |
| Browser Web Speech API | Speech recognition and speech output in the product (not a generative AI tool, listed for completeness) |

## How I used Claude Code

**Choosing the project.** I pasted the challenge brief into Claude Code and asked what was being asked for, then asked for project suggestions. It proposed five ideas across the tracks with a note on why voice suited each and how risky each was to build in a day. It recommended the scam-call practice partner, and I went with that recommendation.

**Building.** Claude Code wrote the first version of every file in this repository in one session: the Node server, the scenario scripts, the Claude prompts, the browser voice loop, the styles, and the unit tests. It made the main design decisions and explained them as it went, including:

- turn-taking instead of full duplex, so the microphone does not pick up the caller's voice
- streaming the caller's reply and speaking it sentence by sentence to cut the wait
- a made-up identity with known secrets, so leaks can be detected by exact matching in code
- a scripted fallback so the app runs with no API key and survives a failed API call

**Testing.** Claude Code ran the unit tests (`npm test`, 8 passing) and drove a full practice call in its built-in browser using the typed-reply fallback, because that browser has no microphone access. That run caught one bug, where the spoken score and the on-screen score could disagree after the leak cap was applied, which it then fixed. It also started the server with an invalid API key, for each provider, to confirm that a failed AI call falls back to the scripted caller.

**Changing provider.** The first version called only the Claude API. Claude Pro does not include API access, so I asked Claude Code to add Google Gemini, which has a free tier. It read the installed Gemini SDK's README and type definitions to get the call shapes, then restructured `lib/ai.js` so the prompts are shared and each provider has two small functions.

**Live testing.** With my Gemini key in place, Claude Code timed the available Gemini Flash models. The two newest timed out on my key, so the default became `gemini-3.5-flash` with minimal thinking, which starts replying in about a second. It then checked the AI caller and the AI debrief end to end using typed replies. I tested the voice path myself in Chrome with a microphone.

**Second round, after I tested it by voice.** I found a real flaw: I gave the caller a made-up birthday and PIN, and the review said I had given my information away. I asked Claude Code to check whether what I said was actually the information on the card, and to make the product more sophisticated, with a more emotional voice and better judgement from the reviewer. It made these changes:

- *Real versus made-up details.* Code now separates real leaks from made-up numbers, the coach is told the difference, and the caller reacts when details "do not match".
- *A reviewer whose score is calculated, not guessed.* The AI coach now reports three yes/no findings and writes the coaching. The score comes from a fixed rubric in `lib/analysis.js`, and the coach's quotes are checked against the transcript.
- *Emotion.* The caller model picks a tone for every line, which drives the voice and is shown in the transcript and debrief.
- *Voice.* Claude Code tested Gemini's speech model first and found it is not available on the free tier, so it preferred the browser's natural voices and added ElevenLabs as an optional upgrade.
- *Quota.* During testing the main Gemini model hit its free limit of about 20 requests a day, so Claude Code added automatic rotation across models.

It verified this round with 16 unit tests and live calls against Gemini using typed replies, including replaying my made-up birthday and PIN case.

**ElevenLabs.** After I added an ElevenLabs key, Claude Code listed the voices on my account, chose one per character, and checked by comparing clip lengths that the acting directions were not being read aloud. Its first test showed a 6 second wait before the caller spoke, so it changed the app to voice the first sentence immediately and capped the caller's lines at 35 words, which brought the wait to under 2 seconds. Claude Code cannot hear audio, so judging how the voices actually sound was my job.

**Documents.** Claude Code drafted the README, the write-up, and this file.

## How the product uses AI

- **The caller.** Each turn, the server sends the conversation so far to the model (Gemini or Claude) with a system prompt that sets up the training simulation, the scammer's role and goal, and rules for spoken output (short sentences, no markup, fictional organisations only). The reply is streamed. Each line starts with a tone in curly braces, such as `{urgent}`, and the marker `[END_CALL]` lets the model end the call.
- **The coach.** After the call, one request sends the transcript (with the caller's tone on each line and any long pauses before my replies), the call length, who ended it, and the results of the code-based checks. The response is constrained to a JSON schema: verdict, spoken summary, three yes/no findings, tactics, key moments, and a line to say next time.
- **What is deliberately not left to AI.** Whether a secret was leaked, and whether numbers I gave were made up, is decided by exact matching in `lib/analysis.js`. The score is calculated there from a fixed rubric. Quotes in the coach's report are checked against the transcript, and a bluff can never be reported as a leak.
