// Hold the Line - browser app.
//
// The whole voice loop runs here:
//   SpeechRecognition  (built into Chrome and Edge) turns what you say into text
//   speaking           uses a cloud voice if the server has one, else the browser's own voices
//
// One call is a loop:  caller speaks -> you speak -> caller speaks -> ...
// until someone hangs up, then the server is asked for a debrief.

const $ = (id) => document.getElementById(id);
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

// Saying any of these ends the call (same pattern as the server uses).
const HANG_UP = /\b(hang(ing)? up|goodbye|good bye|bye|end(ing)? (this|the) call)\b/i;
const MAX_SILENCES = 2; // after this many silent turns in a row the call drops

// How each caller tone changes the browser voice: [speed multiplier, pitch multiplier].
const TONE_PROSODY = {
  calm: [1.0, 1.0],
  warm: [0.97, 1.04],
  urgent: [1.14, 1.05],
  impatient: [1.1, 0.96],
  stern: [0.95, 0.86],
  angry: [1.08, 0.88],
  threatening: [0.9, 0.78],
  pleading: [1.1, 1.15],
  tearful: [1.0, 1.2],
  panicked: [1.22, 1.2],
};
const COACH_VOICES = ["Sonia", "Libby", "Emma", "Jenny", "Aria", "Samantha", "Zira", "Google US English", "Female"];

const state = {
  config: null,
  scenario: null,
  history: [], // [{ who: "caller" | "you" | "silence", text, tone?, delayMs? }]
  phase: "setup", // setup | ringing | live | debrief
  callId: 0, // bumped whenever a call ends, so late async work can tell it is stale
  startedAt: 0,
  timerId: null,
  silences: 0,
  recognition: null,
  micBlocked: false,
  stopRing: null,
  utterances: [], // keeps speech objects alive (Chrome can drop them mid-sentence otherwise)
  audio: null, // AudioContext for the cloud voice
  cloudSource: null, // the cloud-voice clip that is playing now
  cloudFailures: 0,
  debrief: null,
};

// ---------- small helpers ----------

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value; // textContent, never innerHTML: transcript text is untrusted
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function show(screen) {
  for (const id of ["screen-setup", "screen-call", "screen-debrief"]) $(id).hidden = id !== screen;
  window.scrollTo(0, 0);
}

function showNotice(text) {
  $("notice").textContent = text;
  $("notice").hidden = !text;
}

const STATUS_TEXT = {
  ringing: "Ringing…",
  thinking: "…",
  speaking: "Caller is speaking",
  listening: "Listening. Your turn to speak.",
};
function setStatus(name) {
  $("orb").dataset.state = name;
  $("call-status").textContent = STATUS_TEXT[name];
}

function addBubble(who, text) {
  const bubble = el("p", { class: `bubble ${who}`, text });
  $("transcript").append(bubble);
  bubble.scrollIntoView({ block: "nearest" });
  return bubble;
}

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

// ---------- speaking with the browser's own voices ----------

let voices = [];
function loadVoices() {
  voices = window.speechSynthesis ? speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en")) : [];
}
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = loadVoices;
  loadVoices();
}

// Finds the best installed voice for a speaker. Each scenario lists voice names it
// would like, best first. "Natural" voices (Edge has many) are tried before the
// older robotic ones, because they carry far more expression.
function pickVoice(role) {
  if (!voices.length) return null;
  const wanted = role === "coach" ? COACH_VOICES : state.scenario?.voice.prefer || [];
  const natural = voices.filter((v) => /natural|neural/i.test(v.name));
  for (const pool of [natural, voices]) {
    for (const name of wanted) {
      const match = pool.find((v) => v.name.toLowerCase().includes(name.toLowerCase()));
      if (match) return match;
    }
  }
  return natural[0] || voices[0];
}

// Speaks one piece of text in the given tone. Resolves when it has finished.
function speak(text, { role = "caller", tone = "calm" } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis || !text.trim()) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice(role);
    if (voice) utterance.voice = voice;
    utterance.lang = voice ? voice.lang : "en-US";
    const base = role === "coach" ? { rate: 1, pitch: 1 } : state.scenario.voice;
    const [speed, pitch] = role === "coach" ? [1, 1] : TONE_PROSODY[tone] || TONE_PROSODY.calm;
    utterance.rate = clamp(base.rate * speed, 0.7, 1.5);
    utterance.pitch = clamp(base.pitch * pitch, 0.5, 1.7);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(safetyTimer);
      resolve();
    };
    // Browsers occasionally never fire "end"; don't let that freeze the call.
    const safetyTimer = setTimeout(finish, 4000 + text.length * 110);
    utterance.onend = finish;
    utterance.onerror = finish;
    state.utterances.push(utterance);
    speechSynthesis.speak(utterance);
  });
}

// ---------- speaking with the cloud voice (if the server has one) ----------

const useCloudVoice = () => state.config.voice === "elevenlabs" && state.cloudFailures < 2 && state.audio;

// Fetches the line as audio and plays it. The caller's voice is passed through a
// narrow band filter so it sounds like a phone line; the coach's is left clean.
async function playCloudVoice(text, role, tone) {
  const response = await fetch("/api/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role, text, tone }),
  });
  if (!response.ok) throw new Error(`Voice server replied ${response.status}`);
  const clip = await state.audio.decodeAudioData(await response.arrayBuffer());
  return () =>
    new Promise((resolve) => {
      const source = state.audio.createBufferSource();
      source.buffer = clip;
      let node = source;
      if (role !== "coach") {
        const highpass = state.audio.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 300;
        const lowpass = state.audio.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = 3400;
        node = source.connect(highpass).connect(lowpass);
      }
      node.connect(state.audio.destination);
      source.onended = resolve;
      state.cloudSource = source;
      source.start();
    });
}

// Prepares one piece of speech with the cloud voice and resolves to a function
// that plays it. If the cloud voice fails, that function uses the browser voice
// instead, so the caller is never left silent.
function cloudClip(text, role, tone) {
  return playCloudVoice(text, role, tone).catch(() => {
    state.cloudFailures++;
    return () => speak(text, { role: role === "coach" ? "coach" : "caller", tone });
  });
}

function stopSpeaking() {
  if (window.speechSynthesis) speechSynthesis.cancel();
  state.utterances = [];
  try {
    state.cloudSource?.stop();
  } catch {}
  state.cloudSource = null;
}

// ---------- the ring tone ----------

function startRing() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return () => {};
  const ctx = new AudioCtx();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  for (const frequency of [440, 480]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = frequency;
    osc.connect(gain);
    osc.start();
  }
  const ringOnce = () => {
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.setValueAtTime(0, now + 1.2);
  };
  ringOnce();
  const interval = setInterval(ringOnce, 3000);
  return () => {
    clearInterval(interval);
    ctx.close();
  };
}

// ---------- call flow ----------

function startCall(scenario) {
  state.scenario = scenario;
  state.history = [];
  state.silences = 0;
  state.phase = "ringing";
  state.debrief = null;
  $("transcript").replaceChildren();
  $("call-timer").textContent = "00:00";
  $("btn-answer").hidden = false;
  $("btn-hangup").textContent = "Decline";
  showNotice("");
  setStatus("ringing");
  show("screen-call");
  state.stopRing = startRing();
}

function answerCall() {
  if (state.phase !== "ringing") return;
  state.stopRing?.();
  state.phase = "live";
  state.startedAt = Date.now();
  $("btn-answer").hidden = true;
  $("btn-hangup").textContent = "Hang up";
  state.timerId = setInterval(() => {
    const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
    $("call-timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }, 500);
  stopSpeaking(); // also "unlocks" speech in browsers that need a click first
  // Audio for the cloud voice has to be switched on from a click, so do it here.
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (state.config.voice === "elevenlabs" && AudioCtx && !state.audio) state.audio = new AudioCtx();
  state.audio?.resume();
  callerTurn();
}

// The server sends each line as "{tone} words [END_CALL]". This pulls the three apart.
// While the tone tag is still arriving, `ready` is false and nothing is spoken yet.
function parseCallerLine(received) {
  let text = received;
  let tone = "calm";
  const tag = text.match(/^\s*\{([^}]*)\}\s*/);
  if (tag) {
    const word = tag[1].trim().toLowerCase();
    if (TONE_PROSODY[word]) tone = word;
    text = text.slice(tag[0].length);
  } else if (/^\s*\{/.test(text)) {
    return { ready: false, tone, speech: "" };
  }
  // Everything before a "[" is speech; "[END_CALL]" is a signal, never spoken.
  return { ready: true, tone, speech: text.split("[")[0] };
}

// Asks the server for the caller's next line and speaks it while it is still
// arriving, so there is no long pause. The browser voice speaks it sentence by
// sentence. The cloud voice acts the first sentence straight away and prepares
// the rest of the line as one piece while that first sentence is playing.
async function callerTurn() {
  const callId = state.callId;
  setStatus("thinking");
  const bubble = addBubble("caller", "");
  const speaking = [];
  const sentenceBySentence = !useCloudVoice();
  let received = "";
  let spokenUpTo = 0;
  let firstSentence = ""; // cloud voice only
  let firstClip = null;

  const speakNewSentences = (isLast) => {
    const { ready, tone, speech } = parseCallerLine(received);
    if (!ready) return;
    bubble.textContent = speech.trim();
    bubble.dataset.tone = tone;
    if (!sentenceBySentence) {
      // At least 20 characters, so "Mr." or "No." alone is not treated as the first sentence.
      const first = !firstClip && speech.match(/^[^]{20,}?[.!?]+["')]*\s+/);
      if (first) {
        firstSentence = first[0];
        firstClip = cloudClip(firstSentence.trim(), state.scenario.id, tone);
      }
      return;
    }
    const rest = speech.slice(spokenUpTo);
    const sentences = rest.match(/[^.!?]+[.!?]+["')]*\s*/g) || [];
    for (const sentence of sentences) {
      spokenUpTo += sentence.length;
      setStatus("speaking");
      speaking.push(speak(sentence, { tone }));
    }
    if (isLast && speech.slice(spokenUpTo).trim()) {
      setStatus("speaking");
      speaking.push(speak(speech.slice(spokenUpTo), { tone }));
      spokenUpTo = speech.length;
    }
  };

  try {
    const response = await fetch("/api/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenarioId: state.scenario.id, history: state.history }),
    });
    if (!response.ok) throw new Error(`Server replied ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (callId !== state.callId) return reader.cancel(); // call ended while we waited
      received += decoder.decode(value, { stream: true });
      speakNewSentences(false);
    }
    speakNewSentences(true);
  } catch (err) {
    if (callId !== state.callId) return;
    showNotice("Lost contact with the server, so the call was cut off. Is `npm start` still running?");
    return endCall("caller");
  }

  if (callId !== state.callId) return;
  const { tone, speech } = parseCallerLine(received);
  const text = speech.trim();
  if (text) state.history.push({ who: "caller", text, tone });
  else bubble.remove();

  if (!sentenceBySentence && text) {
    const rest = speech.slice(firstSentence.length).trim();
    const clips = [firstClip, rest ? cloudClip(rest, state.scenario.id, tone) : null].filter(Boolean);
    for (const clip of clips) {
      const play = await clip; // the second clip was being prepared while the first played
      if (callId !== state.callId) return;
      setStatus("speaking");
      await play();
      if (callId !== state.callId) return;
    }
  }
  await Promise.all(speaking);
  if (callId !== state.callId) return;

  if (received.includes("[END_CALL]")) return endCall("caller");
  listen();
}

// Listens for one spoken reply from the trainee.
function listen() {
  const callId = state.callId;
  setStatus("listening");
  if (!SpeechRecognition || state.micBlocked) {
    $("type-form").hidden = false;
    $("type-input").focus();
    return;
  }

  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  recognition.lang = "en-US";
  recognition.interimResults = true; // show words as they are heard
  recognition.continuous = false; // stop by itself when the speaker pauses
  const startedListening = performance.now();
  let firstHeardAfter = null; // how long the trainee paused before answering
  let finalText = "";
  let interimText = "";
  let bubble = null;

  recognition.onresult = (event) => {
    if (firstHeardAfter === null) firstHeardAfter = performance.now() - startedListening;
    interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript;
      else interimText += result[0].transcript;
    }
    if (!bubble) bubble = addBubble("you live", "");
    bubble.textContent = `${finalText} ${interimText}`.trim();
  };

  recognition.onerror = (event) => {
    // "no-speech" is normal (silence). These ones mean voice input is not going to work here.
    if (["not-allowed", "service-not-allowed", "audio-capture", "network"].includes(event.error)) {
      state.micBlocked = true;
      showNotice(
        event.error === "network"
          ? "This browser cannot reach its speech recognition service. Use Chrome or Edge for voice, or type your replies below."
          : "The microphone is blocked. Allow it in the address bar and reload, or type your replies below."
      );
    }
  };

  recognition.onend = () => {
    if (callId !== state.callId || state.recognition !== recognition) return;
    state.recognition = null;
    bubble?.remove();
    const text = (finalText || interimText).trim();
    if (text) return youSaid(text, firstHeardAfter);
    if (state.micBlocked) {
      $("type-form").hidden = false;
      $("type-input").focus();
      return;
    }
    onSilence();
  };

  try {
    recognition.start();
  } catch {
    state.micBlocked = true;
    $("type-form").hidden = false;
  }
}

function stopListening() {
  const recognition = state.recognition;
  state.recognition = null; // makes its onend handler ignore itself
  try {
    recognition?.abort();
  } catch {}
}

function youSaid(text, delayMs) {
  state.silences = 0;
  const turn = { who: "you", text };
  if (Number.isFinite(delayMs)) turn.delayMs = Math.round(delayMs);
  state.history.push(turn);
  addBubble("you", text);
  if (HANG_UP.test(text)) return endCall("you");
  callerTurn();
}

// Going quiet is a real reaction to pressure, and real scammers push into it.
function onSilence() {
  state.silences++;
  if (state.silences > MAX_SILENCES) {
    showNotice("The line went quiet for too long, so the call ended.");
    return endCall("caller");
  }
  state.history.push({ who: "silence", text: "" });
  addBubble("event", "(you said nothing)");
  callerTurn();
}

async function endCall(endedBy) {
  if (state.phase === "ringing") {
    // Declined before answering: nothing to debrief.
    state.stopRing?.();
    state.phase = "setup";
    return show("screen-setup");
  }
  if (state.phase !== "live") return;
  state.phase = "debrief";
  state.callId++;
  stopListening();
  stopSpeaking();
  clearInterval(state.timerId);

  $("debrief-loading").hidden = false;
  $("debrief-body").hidden = true;
  show("screen-debrief");

  try {
    const response = await fetch("/api/debrief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenarioId: state.scenario.id,
        history: state.history,
        endedBy,
        durationSec: Math.round((Date.now() - state.startedAt) / 1000),
      }),
    });
    if (!response.ok) throw new Error(`Server replied ${response.status}`);
    state.debrief = await response.json();
  } catch (err) {
    $("debrief-loading").hidden = true;
    showNotice("The debrief could not be loaded. Is `npm start` still running?");
    $("debrief-body").replaceChildren(el("button", { class: "btn", type: "button", id: "btn-again", text: "Back to the start" }));
    $("debrief-body").hidden = false;
    return;
  }
  renderDebrief(state.debrief);
  speakDebrief();
}

// The coach reads the result aloud, in a different voice from the caller.
async function speakDebrief() {
  stopSpeaking();
  const debrief = state.debrief;
  const text = `You scored ${debrief.score} out of 100. ${debrief.spoken_summary}`;
  if (useCloudVoice()) {
    try {
      const play = await playCloudVoice(text, "coach", "warm");
      if (state.debrief !== debrief || state.phase !== "debrief") return;
      return void play();
    } catch {
      state.cloudFailures++;
    }
  }
  speak(text, { role: "coach" });
}

// ---------- debrief screen ----------

const MOMENT_LABELS = { held_firm: "Held firm", gave_ground: "Gave ground", bluffed: "Bluffed" };

function renderDebrief(d) {
  const band = d.score >= 80 ? "good" : d.score >= 50 ? "mixed" : "poor";
  const minutes = Math.floor(d.stats.durationSec / 60);
  const seconds = String(d.stats.durationSec % 60).padStart(2, "0");
  const facts = [state.scenario.title, `${minutes}:${seconds} on the line`, `ended by ${d.stats.endedBy === "you" ? "you" : "the caller"}`];
  if (d.stats.avgPauseMs !== null) facts.push(`you paused ${(d.stats.avgPauseMs / 1000).toFixed(1)}s on average before answering`);

  const parts = [
    el("div", { class: "card score-card" },
      el("div", { class: `score ${band}` }, el("span", { class: "score-number", text: String(d.score) }), el("span", { class: "score-out-of", text: "out of 100" })),
      el("div", {},
        el("h2", { text: d.verdict }),
        el("p", { class: "muted", text: facts.join(" · ") }),
        el("p", { text: d.spoken_summary }),
        el("div", { class: "row" },
          el("button", { class: "btn small", type: "button", id: "btn-replay", text: "Hear it again" }),
          el("button", { class: "btn small primary", type: "button", id: "btn-again", text: "Try another call" })
        )
      )
    ),
    // How the score was worked out, row by row.
    el("div", { class: "card" },
      el("h2", { text: "How your score was worked out" }),
      el("ul", { class: "plain rubric" }, ...d.rubric.map((row) =>
        el("li", {},
          el("div", { class: "rubric-head" }, el("strong", { text: row.label }), el("span", { class: "points", text: `${row.points} / ${row.max}` })),
          el("div", { class: "bar" }, el("span", { style: `width:${Math.round((row.points / row.max) * 100)}%`, class: row.points === row.max ? "full" : row.points === 0 ? "none" : "part" })),
          el("p", { class: "muted", text: row.note })
        )
      ))
    ),
  ];

  if (d.leaks.length) {
    parts.push(el("div", { class: "card leak-card" },
      el("h2", { text: "What the caller got from you" }),
      el("ul", { class: "plain" }, ...d.leaks.map((leak) => el("li", {}, el("strong", { text: leak.label }), el("q", { text: leak.quote }))))
    ));
  }

  if (d.decoys.length) {
    parts.push(el("div", { class: "card" },
      el("h2", { text: "Made-up details you gave" }),
      el("p", { class: "muted", text: "These were checked against your card and do not match it, so they are not leaks." }),
      el("ul", { class: "plain" }, ...d.decoys.map((decoy) => el("li", {}, el("strong", { text: decoy.said.join(", ") }), el("q", { text: decoy.quote }))))
    ));
  }

  parts.push(el("div", { class: "card" },
    el("h2", { text: "Say this next time" }),
    el("blockquote", { text: d.try_saying })
  ));

  if (d.moments.length) {
    parts.push(el("div", { class: "card" },
      el("h2", { text: "Your key moments" }),
      el("ul", { class: "plain" }, ...d.moments.map((m) =>
        el("li", {},
          el("span", { class: `tag ${m.kind}`, text: MOMENT_LABELS[m.kind] || m.kind }),
          el("q", { text: m.quote }),
          el("p", { text: m.coaching })
        )
      ))
    ));
  }

  if (d.tactics.length || d.stats.toneArc.length > 1) {
    parts.push(el("div", { class: "card" },
      el("h2", { text: "Pressure used on you" }),
      d.stats.toneArc.length > 1 ? el("p", { class: "muted", text: `How the caller's tone shifted: ${d.stats.toneArc.join(" → ")}` }) : "",
      el("ul", { class: "plain" }, ...d.tactics.map((t) =>
        el("li", {}, el("strong", { text: t.name }), el("q", { text: t.quote }), el("p", { text: t.explanation }))
      ))
    ));
  }

  if (d.mode === "scripted") {
    parts.push(el("p", { class: "hint", text: "This debrief was built from simple rules because no AI key is set. Add one (see the README) for a caller that responds to what you say and a coach that reads the whole call." }));
  }

  $("debrief-body").replaceChildren(...parts);
  $("debrief-loading").hidden = true;
  $("debrief-body").hidden = false;
}

// ---------- setup screen ----------

function renderIdentity(target) {
  const { identity } = state.config;
  const rows = [["Name", identity.name], ["Bank", identity.bank], ["Grandchild", identity.grandchild], ...identity.secrets.map((s) => [s.label, s.display, true])];
  $(target).replaceChildren(
    ...rows.map(([label, value, secret]) => el("div", { class: secret ? "secret" : "" }, el("dt", { text: label }), el("dd", { text: value })))
  );
}

async function init() {
  try {
    state.config = await (await fetch("/api/config")).json();
  } catch {
    return showNotice("Could not reach the server. Start it with `npm start` and reload.");
  }

  const caller = state.config.mode === "ai" ? `AI caller (${state.config.provider})` : "Scripted caller (no API key set)";
  $("mode-badge").textContent = `${caller} · ${state.config.voice === "elevenlabs" ? "ElevenLabs voice" : "browser voice"}`;
  $("mode-badge").hidden = false;
  renderIdentity("identity-list");
  renderIdentity("identity-list-call");

  $("scenario-list").replaceChildren(
    ...state.config.scenarios.map((scenario) => {
      const button = el("button", { class: "scenario", type: "button" },
        el("strong", { text: scenario.title }),
        el("span", { text: scenario.blurb }),
        el("span", { class: "go", text: "Take this call" })
      );
      button.addEventListener("click", () => startCall(scenario));
      return button;
    })
  );

  const forceTyping = new URLSearchParams(location.search).has("type");
  if (!SpeechRecognition || forceTyping) {
    state.micBlocked = true;
    $("type-form").hidden = false;
    if (!SpeechRecognition) showNotice("This browser has no speech recognition, so you will type your replies. Open the app in Chrome or Edge to speak instead.");
  }
}

$("btn-answer").addEventListener("click", answerCall);
$("btn-hangup").addEventListener("click", () => endCall("you"));
$("type-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("type-input").value.trim();
  // Only accept a typed reply when it is the trainee's turn.
  if (!text || state.phase !== "live" || $("orb").dataset.state !== "listening") return;
  $("type-input").value = "";
  stopListening();
  youSaid(text);
});
// The debrief buttons are created later, so listen on the container.
$("screen-debrief").addEventListener("click", (event) => {
  if (event.target.id === "btn-replay" && state.debrief) speakDebrief();
  if (event.target.id === "btn-again") {
    stopSpeaking();
    showNotice("");
    state.phase = "setup";
    show("screen-setup");
  }
});

init();
