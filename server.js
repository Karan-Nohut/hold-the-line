// Hold the Line - server.
//
// A small Node HTTP server with no framework. It does four things:
//   GET  /            serves the browser app in ./public
//   POST /api/turn    returns the scam caller's next line (streamed text)
//   POST /api/speak   returns that line as audio, if a cloud voice is set up
//   POST /api/debrief returns the coaching report for a finished call (JSON)
//
// The server keeps no state. The browser sends the whole call transcript each time.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Read .env by hand (KEY=value per line) so there is no extra dependency and it
// works on every Node version. Must run before the lib files look at process.env.
try {
  for (const line of fs.readFileSync(path.join(here, ".env"), "utf8").split(/\r?\n/)) {
    const match = line.match(/^[ \t]*([A-Za-z0-9_]+)[ \t]*=[ \t]*(.*?)[ \t]*$/);
    if (match && match[2] && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env file: fine, the app runs in scripted mode.
}

const { SCENARIOS, IDENTITY, TONES, getScenario } = await import("./lib/scenarios.js");
const { findLeaks, findDecoys, scriptedTurn, ruleDebrief, scoreCall, checkReport } = await import("./lib/analysis.js");
const { aiProvider, PROVIDER_INFO, aiTurn, aiDebrief } = await import("./lib/ai.js");
const { cloudVoiceEnabled, synthesize } = await import("./lib/voice.js");

const PORT = Number(process.env.PORT) || 3000;
const MAX_CALLER_TURNS = 12; // hard cap so a call cannot run forever
const PUBLIC_DIR = path.join(here, "public");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };

// AI mode needs both a key (Gemini or Claude) and that provider's SDK to be installed.
const provider = aiProvider() ? PROVIDER_INFO[aiProvider()] : null;
let aiReady = Boolean(provider);
if (aiReady) {
  try {
    await import(provider.sdk);
  } catch {
    aiReady = false;
    console.warn("An API key is set but the SDK is missing. Run `npm install`. Falling back to scripted mode.");
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 200_000) reject(new Error("Request too large"));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// Never trust what the browser sends: keep only the fields and sizes we expect.
function cleanHistory(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((t) => t && ["caller", "you", "silence"].includes(t.who))
    .slice(0, 60)
    .map((t) => {
      const turn = { who: t.who, text: String(t.text || "").slice(0, 600) };
      if (t.who === "caller") turn.tone = TONES.includes(t.tone) ? t.tone : "calm";
      if (t.who === "you" && Number.isFinite(t.delayMs)) turn.delayMs = Math.max(0, Math.min(60_000, Math.round(t.delayMs)));
      return turn;
    });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

// The caller's next line, as streamed plain text in the form "{tone} words".
// A line ending in [END_CALL] tells the browser the caller has hung up.
async function handleTurn(req, res) {
  const body = await readJson(req);
  const scenario = getScenario(body.scenarioId);
  const history = cleanHistory(body.history);
  const callerTurns = history.filter((t) => t.who === "caller").length;

  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  const sendScripted = () => {
    const { line, end } = scriptedTurn(scenario, history);
    res.end(`{${line.tone}} ${line.text}${end ? " [END_CALL]" : ""}`);
  };

  // The opening line is always the fixed one, so the caller speaks the instant you answer.
  if (!aiReady || history.length === 0) return sendScripted();

  let wroteSomething = false;
  try {
    for await (const chunk of aiTurn(scenario, history, { lastTurn: callerTurns >= MAX_CALLER_TURNS - 1 })) {
      wroteSomething = true;
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error("AI turn failed, using the scripted line instead:", String(err.message).slice(0, 300));
    if (wroteSomething) res.end();
    else sendScripted();
  }
}

// One line of speech as MP3, from the cloud voice. The browser falls back to its
// own voice if this fails for any reason.
async function handleSpeak(req, res) {
  const body = await readJson(req);
  if (!cloudVoiceEnabled()) return sendJson(res, 404, { error: "No cloud voice is set up" });
  const role = body.role === "coach" ? "coach" : getScenario(body.role).id;
  const text = String(body.text || "").slice(0, 900);
  const tone = TONES.includes(body.tone) ? body.tone : "calm";
  if (!text.trim()) return sendJson(res, 400, { error: "No text to speak" });
  try {
    const audio = await synthesize(role, text, tone);
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    res.end(audio);
  } catch (err) {
    console.error("Cloud voice failed, the browser voice will be used instead:", String(err.message).slice(0, 300));
    sendJson(res, 502, { error: "Cloud voice unavailable" });
  }
}

async function handleDebrief(req, res) {
  const body = await readJson(req);
  const scenario = getScenario(body.scenarioId);
  const history = cleanHistory(body.history);
  const meta = {
    endedBy: body.endedBy === "you" ? "you" : "caller",
    durationSec: Math.max(0, Math.min(3600, Math.round(Number(body.durationSec) || 0))),
  };
  const yours = history.filter((t) => t.who === "you");

  // Step 1: exact checks in plain code. What was really given away, and what was made up?
  const leaks = findLeaks(history);
  const decoys = findDecoys(history);

  // Step 2: the coaching report. The AI writes it when it can; simple rules otherwise.
  let report;
  let mode = "scripted";
  if (aiReady && yours.length) {
    try {
      // Step 3: do not take the AI's word for it. Drop misquotes and fix mislabelled bluffs.
      report = checkReport(await aiDebrief(scenario, history, leaks, decoys, meta), history, leaks, decoys);
      mode = "ai";
    } catch (err) {
      console.error("AI debrief failed, using the rule-based one instead:", String(err.message).slice(0, 300));
    }
  }
  if (!report) report = ruleDebrief(scenario, history, leaks, decoys, meta);

  // Step 4: the score is calculated in code from the facts, never chosen by the AI.
  const { rubric, score } = scoreCall({ leaks, decoys, findings: report.findings, endedBy: meta.endedBy, yourTurns: yours.length });

  const pauses = yours.map((t) => t.delayMs).filter(Number.isFinite);
  const tones = history.filter((t) => t.who === "caller").map((t) => t.tone);
  sendJson(res, 200, {
    ...report,
    score,
    rubric,
    mode,
    leaks,
    decoys,
    stats: {
      ...meta,
      yourTurns: yours.length,
      avgPauseMs: pauses.length ? Math.round(pauses.reduce((a, b) => a + b, 0) / pauses.length) : null,
      toneArc: tones.filter((tone, i) => tone !== tones[i - 1]), // e.g. calm -> urgent -> stern
    },
  });
}

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.normalize(path.join(PUBLIC_DIR, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/config") {
      return sendJson(res, 200, {
        mode: aiReady ? "ai" : "scripted",
        provider: aiReady ? provider.label : null,
        voice: cloudVoiceEnabled() ? "elevenlabs" : "browser",
        tones: TONES,
        identity: { name: IDENTITY.name, bank: IDENTITY.bank, grandchild: IDENTITY.grandchild, secrets: IDENTITY.secrets.map((s) => ({ label: s.label, display: s.display })) },
        scenarios: SCENARIOS.map((s) => ({ id: s.id, title: s.title, blurb: s.blurb, caller: s.caller, voice: { rate: s.voice.rate, pitch: s.voice.pitch, prefer: s.voice.prefer } })),
      });
    }
    if (req.method === "POST" && req.url === "/api/turn") return await handleTurn(req, res);
    if (req.method === "POST" && req.url === "/api/speak") return await handleSpeak(req, res);
    if (req.method === "POST" && req.url === "/api/debrief") return await handleDebrief(req, res);
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405);
    res.end("Method not allowed");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 400, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, () => {
  console.log(`\nHold the Line is running at http://localhost:${PORT}`);
  console.log(aiReady ? `Caller: AI (${provider.label}, model ${provider.model}).` : "Caller: scripted (no API key found in .env, see README).");
  console.log(cloudVoiceEnabled() ? "Voice:  ElevenLabs, with the browser voice as a fallback." : "Voice:  the browser's built-in voices (Edge has the most natural ones).");
  console.log("Open it in Chrome or Edge so voice recognition works.\n");
});
