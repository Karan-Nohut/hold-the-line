# Hold the Line

**Track:** Security (with Real-Time Assistance)

## What it is

Hold the Line lets you practise a scam call out loud. An AI plays the scammer, you answer, and you try to get through the call without giving anything away. There are three calls to pick from: someone from your bank's "fraud team", a grandchild who's been in an accident, and an officer saying there's a warrant out for your arrest over unpaid tax.

When an AI key is set, the caller actually listens to what you say and changes how it talks as the call goes on. The bank caller starts out polite and gets colder every time you refuse. The grandchild gets more upset. Once you hang up, a coach tells you your score, shows you where the points came from, and gives you one line you could say next time.

## Who it's for

People who get scam calls and find it hard to cut off someone who sounds official or upset, and the family members who worry about them. I could also see a bank or phone network giving it to customers as a quick bit of practice.

## Why I built it

Most scam advice is a list of tips, and you read it when nothing is happening. A scam call is the opposite. Someone is rushing you, they sound like they know what they're talking about, and they're trying to scare you. Knowing you shouldn't read out a code is one thing. Actually saying "no, I'm hanging up" to someone who won't stop talking is harder.

I think saying it out loud a few times makes it easier to say for real, but I haven't tested that. If I took this further, it's the first thing I'd want to measure.

## Why voice

If you type your replies, you get time to think, and taking that time away is the whole trick a scammer relies on. Most of the pressure is in the pace, the tone of voice and how awkward it feels to interrupt someone, so the practice has to be spoken. Going quiet counts as well: if you freeze, the caller fills the silence and pushes harder.

That's the real-time part. The caller reacts to each thing you say as you say it, and you get your feedback the moment you hang up.

## How it works

The browser handles speech recognition (it needs Chrome or Edge), and a small Node server passes the conversation to Gemini or Claude, which plays the caller. Every line the model writes starts with a tone like `{urgent}` or `{tearful}`. By default the browser's built-in voice reads the line and speeds up or changes pitch to match. If you add an ElevenLabs key, a much more expressive voice reads it instead, filtered so it sounds like it's coming down a phone line.

You play a made-up person, Sam Rivera, with four secrets on a card: a one-time code, the last four digits of a card, a PIN and a year of birth. Nobody has to say anything real into the microphone, and the code can check exactly whether a secret came out. Saying a real one counts as a leak. Making a number up counts as a bluff. The caller knows the real values, so if you give it a fake code it gets "rejected" and the caller pushes harder, which is what would happen on a real scam call.

I didn't want an AI deciding the score on its own. Leaks are checked in code. The AI coach writes the feedback and answers three yes/no questions: did you agree to pay, did you question the caller, and did you say you'd check through a number you trust. Those answers are worth 30 of the 100 points, and the rest of the score is worked out in code from a fixed rubric. Anything the coach quotes gets checked against the transcript.

If there's no key, the free quota runs out or a request fails, the app falls back to another model, then to a scripted caller, and to the browser voice for speech. It shouldn't ever cut out halfway through a call.

## What I'd do next

The caller is still turn by turn, so you can't talk over each other. A speech-to-speech model would fix that and would feel a lot closer to a real call.

It would also be much more realistic if it rang your actual phone at some random point in the week, when you're not expecting it.

I'd build the scenarios from recent scam reports, so people practise the scams that are actually going around.

And I'd test whether it works: compare people who practised with it against people who only read the usual tips, and see who resists better a month later.
