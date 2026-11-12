# AI tools used

| Tool | What it was used for |
|---|---|
| Claude Code (desktop app, Claude Fable 5.2) | Coming up with the idea, writing the code, first drafts of the docs, testing in a browser |
| Claude (claude.ai, Claude Opus 5.5) | Reviewing the code for bugs, and rewriting this file and `WRITEUP.md` |
| Google Gemini API (`gemini-3.5-flash-lite`, `gemini-3.5-flash` and a few others) | Inside the app: plays the scammer and writes the coaching |
| ElevenLabs API (optional, `eleven_v4_turbo`) | Inside the app: a more expressive voice for the caller and coach |
| Claude API (`claude-opus-5-5`) | Inside the app: an alternative to Gemini for the same two jobs |
| Browser Web Speech API | Speech recognition and the default voice (not generative AI, but listed anyway) |

## How I used Claude Code

Claude Code wrote the first version of every file in this repo, and it made most of the big design decisions. What I did was pick the idea, test it by actually talking to it, find what was broken, and decide what needed to change.

I started by pasting the challenge brief into Claude Code and asking what it was really asking for, then asked for project ideas. It came back with five, each with a note on why voice suited it and how risky it would be to build in a day. It recommended the scam-call one, and I went with that.

It built everything in one session: the server, the scenarios, the prompts, the voice loop in the browser, the styling and the tests. Along the way it explained the main decisions. The app takes turns instead of letting both sides talk at once, so the mic doesn't pick up the caller. The caller's reply is streamed and spoken a sentence at a time so you're not left waiting. You play a made-up identity, so leaks can be checked exactly. And there's a scripted caller to fall back on, so the app still works with no API key.

To test it, Claude Code ran the unit tests and went through a whole call in its own browser, typing replies because that browser has no microphone. That found a bug where the score it said out loud didn't always match the one on screen, and it fixed it. It also tried starting the server with a bad key for each provider, to make sure a failed AI call drops back to the scripted caller.

The first version only worked with the Claude API, but Claude Pro doesn't come with API access, so I asked it to add Gemini, which has a free tier. It read the Gemini SDK docs and restructured `lib/ai.js` so both providers share the same prompts. Once my Gemini key was in, it timed the different Flash models and set them to think as little as possible, so the caller starts talking after about a second. It checked the AI caller and debrief with typed replies, and I tested the voice side myself in Chrome with a microphone.

That's when I found the biggest problem. I gave the caller a fake birthday and a fake PIN, and the debrief told me I'd given my details away. I asked Claude Code to check whether what I said actually matched the card, to make the caller sound more emotional, and to make the coach smarter. It changed four things.

1. The code now tells real leaks apart from made-up numbers, and the caller reacts when details don't match.
2. The score is calculated from a fixed rubric instead of being picked by the AI, and the coach's quotes are checked against the transcript.
3. The caller now picks a tone for every line.
4. When the main Gemini model ran out of free requests during testing, it added automatic switching between models. The caller now starts on `gemini-3.5-flash-lite` and the coach on `gemini-3.5-flash`.

It tried Gemini's own speech model too, but that isn't on the free tier, so it used the browser's "Natural" voices and added ElevenLabs as an optional extra. By the end of that round there were 16 unit tests, and it replayed my fake birthday and PIN against Gemini to check the fix.

When I added an ElevenLabs key, it listed the voices on my account, picked one for each character, and compared clip lengths to make sure the acting directions weren't being read out loud. There was a long pause before the caller spoke, so it started voicing the first sentence straight away and limited each line to 35 words. It can't hear audio, so whether the voices actually sounded right was down to me.

It also wrote the README and the first drafts of this file and the write-up.

## How I used Claude (claude.ai)

Once the build was done, I had Claude read the whole repo and explain it to me. It found a few bugs in the scoring and checking logic. For example, saying a money amount like "5,000" gets counted as a made-up detail. It then rewrote this file and `WRITEUP.md` so they sound more like me, and fixed claims that didn't match what the code actually does.

## How the app uses AI

On every turn, the server sends the conversation so far to Gemini or Claude, with a system prompt that sets up the training simulation, who the scammer is and what they're after, and some rules: short lines, no formatting, and only made-up organisations. The reply streams back. Each line starts with a tone in curly braces, and `[END_CALL]` lets the model hang up.

After the call, one request goes to the coach. It gets the transcript (with the caller's tone on each line and any long pauses before my replies), how long the call took, who hung up, and what the code found. Its reply has to fit a fixed JSON format: a verdict, a summary to read out, three yes/no answers, the tactics used, my key moments, and a line to try next time.

Some things deliberately aren't left to the AI. Whether a secret leaked, and whether a number was made up, is decided by exact matching in `lib/analysis.js`, and the score is worked out there too. The coach's three yes/no answers still decide 30 of the 100 points. The coach is told the leak result is final, quotes that don't appear in the transcript are thrown out, and a fake detail that's been labelled as "gave ground" is relabelled as a bluff. The summary it reads out isn't checked, though, so it could still describe a bluff badly.
