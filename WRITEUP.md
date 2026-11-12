# Hold the Line: a sparring partner for scam calls

**Track:** Security (with Real-Time Assistance)

## What I built

Hold the Line is a voice app where an AI plays a phone scammer and you practise resisting it out loud. You pick a call (a bank "fraud team", a grandchild in trouble, or an arrest-warrant threat), answer it, and talk. The caller responds to what you say and its tone shifts as the call goes on, from calm to stern, or from panicked to tearful. When you hang up, a coach voice gives you a score, shows how it was worked out, and gives you one sentence to say next time.

## Who it is for

People who are most often targeted by phone scams, and their families: older adults, and the children and grandchildren who worry about them. A bank or phone carrier could also offer it to customers as a few minutes of practice.

## The problem

Most scam advice is a list of tips that people read calmly. Scam calls do not happen calmly. They work because a live voice is rushing you, sounding official and making you afraid, and under that pressure people who know the rules still break them. Knowing "never share a code" is different from being able to say "no, I'm hanging up" to someone who is insisting. That is a spoken reflex, and reflexes are built by rehearsal.

## Why voice

A keyboard would not do this job. Typing gives you time to think, which is the one thing a scammer takes away. The pressure is carried by pace, tone and the awkwardness of cutting off someone who is speaking to you, so the practice has to be spoken and in real time. Silence matters too: if you freeze, the caller pushes into it. And the skill being trained is itself vocal. The app treats "I'm hanging up" as the winning move.

## How it works

Speech recognition runs in the browser. A small Node server sends the conversation to an AI model, which plays the caller and tags each line with a tone; a neural voice then acts that tone. You play a made-up identity with four known "secrets", so nobody says real details aloud and the facts can be checked in code: a real secret is a leak, a made-up one is a bluff, and the caller is told when details "do not match", as a real scam would find out. The AI coach writes the feedback, but the score is calculated from a fixed rubric and the coach's quotes are checked against the transcript. If a key is missing, a free quota runs out or a request fails, the app falls back rather than breaking.

## What I would do next

- **An interruptible caller.** It is still turn by turn. A speech-to-speech model would let the caller talk over you and let you cut in, which is how real pressure feels.
- **Real phone calls.** Have it ring your actual phone, unannounced, some time in the next week. A drill you are not expecting is far closer to the real thing.
- **Fresh scripts.** Feed the scenarios from current scam reports, so people rehearse what is going around now.
- **Measure it.** Test whether people who rehearse resist better a month later than people who only read the usual tips.
