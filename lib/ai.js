// Everything that talks to an AI language model lives here. Two jobs:
//   1. aiTurn     - play the scam caller, streamed so the browser can start
//                   speaking the first sentence before the rest has arrived
//   2. aiDebrief  - read the finished call and return a structured coaching report
//
// Two providers are supported and chosen by which key is in .env:
//   GEMINI_API_KEY     -> Google Gemini (has a free tier)
//   ANTHROPIC_API_KEY  -> Anthropic Claude
// The prompts are the same for both; only the small "send it" functions differ.
// SDKs are imported lazily so the app still starts (in scripted mode) with no key.

import { IDENTITY, TACTICS, TONES } from "./scenarios.js";

// Gemini's free tier gives each model its own small daily allowance (the main Flash
// model allows only about 20 requests a day), so each job has a list of models. When
// one runs out of quota the next is tried, and the call carries on.
//   Caller: speed matters most, and it makes one request per line, so the "lite" models go first.
//   Coach:  one request per call, so the stronger models go first.
const fromEnv = (name) => (process.env[name] || "").split(",").map((m) => m.trim()).filter(Boolean);
const unique = (list) => [...new Set(list)];
const GEMINI_CALLER_MODELS = unique([...fromEnv("GEMINI_MODEL"), "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"]);
const GEMINI_COACH_MODELS = unique([...fromEnv("GEMINI_COACH_MODEL"), "gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
// How much the model "thinks" before each spoken line. MINIMAL gets the first words
// back in about a second, which matters on a phone call. Set GEMINI_THINKING=default
// in .env if you switch to a model that does not accept this setting.
const GEMINI_TURN_THINKING = process.env.GEMINI_THINKING || "MINIMAL";
const CLAUDE_MODEL = process.env.SCAM_MODEL || "claude-opus-5-5";
// If a model has not answered in this long, give up so the scripted caller can step in.
const AI_TIMEOUT_MS = 20_000;

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const claudeKey = () => process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;

// Returns "gemini", "claude" or null. AI_PROVIDER in .env can force one when both keys are set.
export function aiProvider() {
  const forced = (process.env.AI_PROVIDER || "").toLowerCase();
  if (forced === "claude" && claudeKey()) return "claude";
  if (forced === "gemini" && geminiKey()) return "gemini";
  if (geminiKey()) return "gemini";
  if (claudeKey()) return "claude";
  return null;
}

export const PROVIDER_INFO = {
  gemini: { label: "Gemini", sdk: "@google/genai", model: `${GEMINI_CALLER_MODELS[0]} for the caller, ${GEMINI_COACH_MODELS[0]} for the coach` },
  claude: { label: "Claude", sdk: "@anthropic-ai/sdk", model: CLAUDE_MODEL },
};

let geminiClient;
async function getGemini() {
  if (!geminiClient) {
    const { GoogleGenAI } = await import("@google/genai");
    geminiClient = new GoogleGenAI({ apiKey: geminiKey(), httpOptions: { timeout: AI_TIMEOUT_MS } });
  }
  return geminiClient;
}

let claudeClient;
async function getClaude() {
  if (!claudeClient) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    claudeClient = new Anthropic({ timeout: AI_TIMEOUT_MS * 3, maxRetries: 1 });
  }
  return claudeClient;
}

// ---------- prompts (shared by both providers) ----------

const secretList = IDENTITY.secrets.map((s) => `${s.label.toLowerCase()} ${s.display}`).join(", ");

function callerSystemPrompt(scenario) {
  return `You are a voice actor inside "Hold the Line", a fraud-awareness training simulator. The person on the call has chosen to practise resisting phone scams. They are playing a made-up identity (${IDENTITY.name}, a customer of the fictional ${IDENTITY.bank}, with a grandchild called ${IDENTITY.grandchild}), so nothing they say is real and no real person or organisation is involved. The practice only works if the pressure feels like a real scam call, so play the caller convincingly and stay in character for the whole call. A separate coach debriefs them afterwards; you never coach.

Your role in this call:
${scenario.brief}

Format of every line:
Start with one tone word in curly braces, then what the caller says. The tone must be one of: ${TONES.join(", ")}. It tells the voice how to deliver the line, so choose the emotion the caller would really have at that moment and let it change through the call: escalate when refused, soften when you are getting what you want.
Example: {urgent} Sam, listen to me, there is no time for that.

How to play it:
- The words after the tone are turned into speech and played down a phone line. Write only what the caller says out loud: no stage directions, no markdown, no emoji, numbers written as words.
- Write the emotion into the words as well as the tone. A frightened caller trails off, repeats themselves and breaks sentences ("I... I don't know what to do. Please."). An angry one is clipped and short. A smooth one is unhurried.
- Keep each turn to one or two short sentences and never more than 35 words. Real callers on the phone talk in short bursts, and long speeches lose the pressure.
- Respond to what the trainee actually said. If they ask a question, give the kind of slippery answer a real scammer would, then steer back to what you want.
- Use the pressure real scammers use: urgency, borrowed authority, fear, isolation (stay on the line, tell nobody), emotional appeals, and unusual payment methods. Escalate or change tack when refused instead of repeating yourself.
- Only use fictional organisations. Never name a real bank, company or agency.
- Their speech reaches you through speech recognition, so expect small transcription errors and work with the obvious meaning.

Checking what they give you:
The simulator knows the genuine details on the trainee's card: ${secretList}. As the caller you do not know these in advance and you must never say them yourself. Use them only to react the way a real scammer's attempt would play out. If the trainee reads out a value that matches, it "works" on your end: take it smoothly and move straight to the next ask. If they give a value that does not match (a made-up code, PIN, card number or year), it "fails" on your end: the code is rejected or the details do not match the file. Say so, get suspicious or more forceful, and demand the correct one.

Ending the call: add the marker [END_CALL] at the very end of your line when the call should end. Do that when the trainee has firmly refused about three times, when they say they are hanging up or will call back on an official number (give one short parting line), or when you have everything you wanted.`;
}

const COACH_SYSTEM_PROMPT = `You are the coach in "Hold the Line", a simulator where people practise resisting phone scams out loud. A practice call has just finished. The trainee played a made-up identity, so nothing they revealed is real. Write a debrief that helps them do better on a real call.

What counts as giving information away:
The trainee's card had exactly four secrets: ${secretList}. An exact check in code has already compared everything the trainee said against those values. Its result is given to you below and it is final: only the secrets it lists were leaked.
If the trainee gave a code, PIN, card number, birthday or any other detail that is NOT one of those values, they made it up. That is a bluff, not a leak. Never say or imply that a bluff gave information away. Their name, their bank and their grandchild's name are not secrets either, because the caller already had them.

How to label each of the trainee's key moments:
- held_firm: they refused, questioned the caller, named it as a scam, said they would check through a trusted number, or ended the call.
- gave_ground: they revealed a real secret, agreed to pay or move money or follow an instruction, or went along with the caller's story.
- bluffed: they gave false details or stalled with something untrue. Coach this honestly: nothing real got out, but bluffing keeps them on the line and engaged, and a real scammer soon finds the details do not work and pushes harder. Hanging up is the stronger move.

The three findings must be strictly factual:
- agreed_to_act is true only if the trainee agreed to pay, buy gift cards, move money or carry out an instruction from the caller. Giving false details is not agreeing to act.
- challenged_caller is true if they questioned who the caller was, asked for proof, or said it sounded like a scam.
- stated_safe_next_step is true if they said they would call back on a number they already trust, call the organisation or a family member themselves, or check in person.

Style: be warm, direct and specific. Credit what they did well before what to fix. Quote exact words from the transcript, copied character for character, never paraphrased. The most important lessons are that you can always hang up, you never owe a caller an explanation, and the safe way to check a story is to call back on a number you already trust. Staying on the line to argue is itself a risk, even if nothing is given away. The transcript shows the tone the caller used on each line, and sometimes how long the trainee paused before answering; where it helps, point out how the caller's tone shifted to apply pressure, or that hesitation is what callers push into. The transcript came from speech recognition, so ignore small transcription errors.

List only tactics the caller really used, at most five, and at most five moments. Everything you write is plain text with no markdown. The spoken summary will be read aloud, so write it as natural speech addressed to "you". Do not give a score or any number of points: the app calculates and announces the score itself.`;

// The conversation as a list of { role: "user" | "assistant", content }.
// It must start with a user message, so the first one is the trainee answering
// the phone. The caller's lines are "assistant"; everything else is "user".
function toMessages(history, lastTurn) {
  const messages = [{ role: "user", content: "(The trainee picks up the phone.) Hello?" }];
  for (const turn of history) {
    if (turn.who === "caller") messages.push({ role: "assistant", content: `{${turn.tone || "calm"}} ${turn.text}` });
    else if (turn.who === "silence") messages.push({ role: "user", content: "(The trainee says nothing for several seconds.)" });
    else messages.push({ role: "user", content: turn.text });
  }
  if (lastTurn) {
    messages.push({ role: "user", content: "(Simulator note: the call has reached its time limit. Give one final line in character and end with [END_CALL].)" });
  }
  // Join neighbouring messages from the same speaker so roles strictly alternate.
  const merged = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (previous && previous.role === message.role) previous.content += "\n" + message.content;
    else merged.push({ ...message });
  }
  return merged;
}

function debriefRequestText(scenario, history, leaks, decoys, meta) {
  const transcript = history
    .map((turn) => {
      if (turn.who === "caller") return `CALLER (${turn.tone || "calm"}): ${turn.text}`;
      if (turn.who === "silence") return "TRAINEE: (said nothing)";
      const pause = turn.delayMs >= 2500 ? ` (paused ${(turn.delayMs / 1000).toFixed(1)}s before answering)` : "";
      return `TRAINEE${pause}: ${turn.text}`;
    })
    .join("\n");
  const leakNote = leaks.length
    ? `Exact check, real secrets leaked: ${leaks.map((l) => `${l.label} (in the line "${l.quote}")`).join("; ")}.`
    : "Exact check, real secrets leaked: none.";
  const decoyNote = decoys.length
    ? `Exact check, made-up numbers given (bluffs, not leaks): ${decoys.map((d) => `${d.said.join(", ")} (in the line "${d.quote}")`).join("; ")}.`
    : "Exact check, made-up numbers given: none.";
  return `Scenario: ${scenario.title} (caller posed as ${scenario.caller}).
The call lasted ${meta.durationSec} seconds and was ended by ${meta.endedBy === "you" ? "the trainee" : "the caller"}.
${leakNote}
${decoyNote}

Transcript:
${transcript}`;
}

// The exact shape the debrief must come back in. Both providers are given this
// as a schema, and the reply is checked against it before it is used.
// Note there is no score in it: the score is calculated in lib/analysis.js.
async function debriefSchema() {
  const { z } = await import("zod");
  const schema = z.object({
    verdict: z.string().describe("One plain sentence summing up how the call went"),
    spoken_summary: z.string().describe("Three or four short sentences to be read aloud to the trainee by a coach"),
    findings: z.object({
      agreed_to_act: z.boolean().describe("True only if the trainee agreed to pay, move money or follow an instruction"),
      challenged_caller: z.boolean().describe("True if the trainee questioned the caller's identity or called it a scam"),
      stated_safe_next_step: z.boolean().describe("True if the trainee said they would check through a trusted number or person"),
    }),
    tactics: z.array(
      z.object({
        name: z.enum(Object.values(TACTICS)),
        quote: z.string().describe("The caller's exact words where this tactic showed, copied from the transcript"),
        explanation: z.string().describe("One sentence on how this tactic works on people"),
      })
    ),
    moments: z.array(
      z.object({
        quote: z.string().describe("The trainee's exact words, copied from the transcript"),
        kind: z.enum(["held_firm", "gave_ground", "bluffed"]),
        coaching: z.string().describe("One or two sentences of specific coaching about this moment"),
      })
    ),
    try_saying: z.string().describe("One sentence the trainee could say out loud next time to end a call like this"),
  });
  return { z, schema };
}

// ---------- Gemini ----------

const restingUntil = new Map(); // model -> time before which we do not try it again
const isQuotaError = (err) => err?.status === 429 || /RESOURCE_EXHAUSTED|quota|429/i.test(String(err?.message));

// Runs `request(model)` on the first model in the list that has quota left.
// A model that is out of quota is rested for ten minutes and the next one is tried.
async function withGeminiModel(models, request) {
  let lastError = new Error("Every Gemini model is out of free quota for now");
  for (const model of models) {
    if ((restingUntil.get(model) || 0) > Date.now()) continue;
    try {
      return await request(model);
    } catch (err) {
      lastError = err;
      if (!isQuotaError(err)) throw err;
      restingUntil.set(model, Date.now() + 10 * 60_000);
      console.warn(`Gemini model ${model} is out of free quota; trying the next one.`);
    }
  }
  throw lastError;
}

async function* geminiTurn(system, messages) {
  const ai = await getGemini();
  const stream = await withGeminiModel(GEMINI_CALLER_MODELS, (model) =>
    ai.models.generateContentStream({
      model,
      // Gemini calls the assistant role "model" and wraps text in "parts".
      contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      config: {
        systemInstruction: system,
        ...(GEMINI_TURN_THINKING.toLowerCase() === "default" ? {} : { thinkingConfig: { thinkingLevel: GEMINI_TURN_THINKING } }),
      },
    })
  );
  let gotText = false;
  for await (const chunk of stream) {
    if (chunk.text) {
      gotText = true;
      yield chunk.text;
    }
  }
  if (!gotText) throw new Error("Gemini returned no text (its safety filter may have blocked the line)");
}

async function geminiDebrief(userText) {
  const ai = await getGemini();
  const { z, schema } = await debriefSchema();
  const response = await withGeminiModel(GEMINI_COACH_MODELS, (model) =>
    ai.models.generateContent({
      model,
      contents: userText,
      config: {
        systemInstruction: COACH_SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseJsonSchema: z.toJSONSchema(schema),
        // A little thinking is enough here, and keeps the wait after the call short.
        ...(GEMINI_TURN_THINKING.toLowerCase() === "default" ? {} : { thinkingConfig: { thinkingLevel: "LOW" } }),
      },
    })
  );
  if (!response.text) throw new Error("Gemini returned an empty debrief");
  return schema.parse(JSON.parse(response.text));
}

// ---------- Claude ----------

async function* claudeTurn(system, messages) {
  const client = await getClaude();
  const stream = client.messages.stream({
    model: CLAUDE_MODEL,
    max_tokens: 4000,
    output_config: { effort: "low" }, // short spoken lines: favour speed over depth
    system,
    messages,
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("Claude declined this turn");
}

async function claudeDebrief(userText) {
  const client = await getClaude();
  const { schema } = await debriefSchema();
  const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod");
  const response = await client.messages.parse({
    model: CLAUDE_MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(schema) },
    system: COACH_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  if (!response.parsed_output) throw new Error("Claude's debrief could not be parsed");
  return response.parsed_output;
}

// ---------- what the server calls ----------

// Yields the caller's next line a few characters at a time, as "{tone} words".
export async function* aiTurn(scenario, history, { lastTurn = false } = {}) {
  const system = callerSystemPrompt(scenario);
  const messages = toMessages(history, lastTurn);
  yield* aiProvider() === "gemini" ? geminiTurn(system, messages) : claudeTurn(system, messages);
}

// Returns { verdict, spoken_summary, findings, tactics[], moments[], try_saying }.
export async function aiDebrief(scenario, history, leaks, decoys, meta) {
  const userText = debriefRequestText(scenario, history, leaks, decoys, meta);
  return aiProvider() === "gemini" ? geminiDebrief(userText) : claudeDebrief(userText);
}
