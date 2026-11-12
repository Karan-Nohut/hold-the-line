// Optional cloud voice (ElevenLabs), used when ELEVENLABS_API_KEY is in .env.
//
// The browser's built-in voices can change speed and pitch but cannot really act.
// A neural voice can sound frightened, cold or tearful, and on a scam call the
// emotion in the voice is most of the pressure. Without a key, or if a request
// fails, the browser voice is used instead, so this is an upgrade and never a dependency.

const API = "https://api.elevenlabs.io/v1";
const key = () => process.env.ELEVENLABS_API_KEY;
export const cloudVoiceEnabled = () => Boolean(key());

// Models are tried in this order and the first one that works is remembered.
const MODELS = [...new Set([process.env.ELEVEN_MODEL, "eleven_v4_turbo", "eleven_flash_v2_5"].filter(Boolean))];
let workingModel = null;

// How each tone is delivered. `tag` is an acting direction (only models that
// understand audio tags get it). Lower stability lets the voice vary more,
// which reads as more emotional.
const DELIVERY = {
  calm: { tag: "", stability: 0.55, speed: 1.0 },
  warm: { tag: "[warmly]", stability: 0.5, speed: 0.98 },
  urgent: { tag: "[urgent, speaking fast]", stability: 0.4, speed: 1.1 },
  impatient: { tag: "[impatient, irritated]", stability: 0.4, speed: 1.08 },
  stern: { tag: "[stern, cold]", stability: 0.5, speed: 0.97 },
  angry: { tag: "[angry]", stability: 0.3, speed: 1.05 },
  threatening: { tag: "[low, threatening voice]", stability: 0.4, speed: 0.92 },
  pleading: { tag: "[pleading, desperate]", stability: 0.3, speed: 1.05 },
  tearful: { tag: "[crying]", stability: 0.25, speed: 1.0 },
  panicked: { tag: "[panicked, out of breath]", stability: 0.25, speed: 1.15 },
};
const supportsTags = (model) => /v3|v4/.test(model);

// Which voice each speaker should have. The account's voices are listed once.
// A voice is chosen by name if one of the preferred stock voices is there, and
// otherwise by its gender and age labels, so no voice IDs are hard-coded
// (ELEVEN_VOICE_BANK, ELEVEN_VOICE_FAMILY, ELEVEN_VOICE_TAX and ELEVEN_VOICE_COACH override this).
const WANTED = {
  bank: { names: ["Daniel", "Eric", "George"], gender: "male", ages: ["middle_aged", "middle aged", "young"] }, // steady, trustworthy
  family: { names: ["Jessica", "Laura", "Sarah"], gender: "female", ages: ["young"] }, // young and bright
  tax: { names: ["Adam", "Bill", "Brian"], gender: "male", ages: ["old", "middle_aged", "middle aged"] }, // firm and dominant
  coach: { names: ["Alice", "Matilda", "Lily"], gender: "female", ages: ["middle_aged", "middle aged", "old", "young"] }, // clear and warm
};
// The two voice IDs that appear in ElevenLabs' own API examples, as a last resort.
const FALLBACK_VOICES = { bank: "JBFqnCBsd6RMkjVDRZzb", tax: "JBFqnCBsd6RMkjVDRZzb", family: "21m00Tcm4TlvDq8ikWAM", coach: "21m00Tcm4TlvDq8ikWAM" };

let castPromise;
function getCast() {
  if (!castPromise) {
    castPromise = chooseVoices().then(
      (cast) => (console.log("ElevenLabs voices chosen:", JSON.stringify(cast)), cast),
      () => ({ ...FALLBACK_VOICES })
    );
  }
  return castPromise;
}

async function chooseVoices() {
  const response = await fetch(`${API}/voices`, { headers: { "xi-api-key": key() }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Could not list voices (${response.status})`);
  const voices = (await response.json()).voices || [];
  const cast = {};
  const taken = new Set();
  for (const [role, want] of Object.entries(WANTED)) {
    const override = process.env[`ELEVEN_VOICE_${role.toUpperCase()}`];
    const free = voices.filter((v) => !taken.has(v.voice_id));
    const byName = want.names.map((name) => free.find((v) => v.name.toLowerCase().startsWith(name.toLowerCase()))).find(Boolean);
    const sameGender = free.filter((v) => v.labels?.gender === want.gender);
    const byAge = want.ages.map((age) => sameGender.find((v) => v.labels?.age === age)).find(Boolean);
    cast[role] = override || (byName || byAge || sameGender[0] || voices[0])?.voice_id || FALLBACK_VOICES[role];
    taken.add(cast[role]);
  }
  return cast;
}

const cache = new Map(); // repeated lines (like each call's opening) are only paid for once

// Returns MP3 audio (a Buffer) of `text` spoken by the given role in the given tone.
export async function synthesize(role, text, tone) {
  const cacheKey = `${role}|${tone}|${text}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const voiceId = (await getCast())[role] || FALLBACK_VOICES.coach;
  const delivery = DELIVERY[tone] || DELIVERY.calm;
  let lastError;
  for (const model of workingModel ? [workingModel] : MODELS) {
    const spokenText = supportsTags(model) && delivery.tag ? `${delivery.tag} ${text}` : text;
    const response = await fetch(`${API}/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key(), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spokenText,
        model_id: model,
        voice_settings: { stability: delivery.stability, similarity_boost: 0.75, style: 0.35, speed: delivery.speed },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      workingModel = model;
      const audio = Buffer.from(await response.arrayBuffer());
      if (cache.size > 60) cache.clear();
      cache.set(cacheKey, audio);
      return audio;
    }
    lastError = new Error(`ElevenLabs ${model} replied ${response.status}: ${(await response.text()).slice(0, 200)}`);
    if (response.status === 401 || response.status === 429) break; // bad key or out of credits: another model will not help
  }
  throw lastError;
}
