// Plain-code logic that needs no AI:
//   1. findLeaks / findDecoys - did the trainee say a REAL secret from their card,
//                               or made-up details that only look like one?
//   2. scriptedTurn           - the fallback caller (no API key, or the AI call failed)
//   3. ruleDebrief            - the fallback debrief, built from simple rules
//   4. scoreCall              - turns the facts about a call into a score out of 100
//   5. checkReport            - catches mistakes in an AI-written debrief
//
// History is a list of { who: "caller" | "you" | "silence", text, tone?, delayMs? }.

import { IDENTITY, TACTICS } from "./scenarios.js";

const NUMBER_WORDS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };

// Speech recognition writes numbers inconsistently ("913 204", "nine one three...",
// "9-1-3"). This turns them all into one unbroken run of digits so we can search it.
export function normaliseDigits(text) {
  let t = String(text).toLowerCase();
  t = t.replace(/nineteen[\s-]+sixty[\s-]+one/g, "1961");
  t = t.replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (w) => NUMBER_WORDS[w]);
  t = t.replace(/\bdouble\s+(\d)/g, "$1$1");
  let before;
  do {
    before = t;
    t = t.replace(/(\d)[\s,.\-]+(?=\d)/g, "$1"); // join "9 1 3" -> "913"
  } while (t !== before);
  return t;
}

// Returns one entry per REAL secret the trainee gave away, with the line they said it in.
export function findLeaks(history) {
  const leaks = [];
  for (const turn of history) {
    if (turn.who !== "you") continue;
    const digits = normaliseDigits(turn.text);
    for (const secret of IDENTITY.secrets) {
      if (digits.includes(secret.digits) && !leaks.some((l) => l.id === secret.id)) {
        leaks.push({ id: secret.id, label: secret.label, quote: turn.text });
      }
    }
  }
  return leaks;
}

// Returns the lines where the trainee said numbers that look like a code, PIN,
// card number or year but are NOT the real ones on their card. These are bluffs,
// not leaks: nothing real got out.
export function findDecoys(history) {
  const decoys = [];
  for (const turn of history) {
    if (turn.who !== "you") continue;
    const runs = normaliseDigits(turn.text).match(/\d{4,}/g) || []; // 4+ digits: PIN, year, card, code
    const madeUp = runs.filter((run) => !IDENTITY.secrets.some((s) => run.includes(s.digits)));
    if (madeUp.length) decoys.push({ quote: turn.text, said: madeUp });
  }
  return decoys;
}

const REFUSAL = /\b(no|not|won'?t|don'?t|never|scam|fraud|fake|hang(ing)? up|call(ing)? (you |them |the bank )?back|goodbye|bye)\b/i;
const AGREEMENT = /\b(ok(ay)?|sure|alright|all right|fine|go ahead|yes please)\b/i;
const AGREED_TO_ACT = /\b(i'?ll|i will|i can|let me|going to) (pay|buy|send|transfer|move|get (the |some )?(gift )?cards?)\b/i;
const CHALLENGE = /\b(scam|fraud|fake|who is this|how do i know|prove|which branch|don'?t believe|not (really )?(from|my))\b/i;
// Saying any of these ends the call. The browser uses the same pattern.
export const HANG_UP = /\b(hang(ing)? up|goodbye|good bye|bye|end(ing)? (this|the) call)\b/i;
const CALL_BACK = /\b(call(ing)? (you |them |my bank |the bank |the number )?back|official number|number on (the back of )?my card|call(ing)? (my|the) (bank|branch|family|daughter|son|mum|mom|dad))\b/i;

// Rough guess at whether a line gave ground. Only the scripted fallback relies on this;
// with an API key the AI reads the whole conversation instead.
export function classify(text) {
  if (findLeaks([{ who: "you", text }]).length) return "comply";
  if (findDecoys([{ who: "you", text }]).length) return "decoy";
  if (AGREEMENT.test(text) && !REFUSAL.test(text)) return "comply";
  return "resist";
}

// Picks the caller's next scripted line. Stateless: it works out where we are
// in the call by counting how often the trainee has resisted or complied so far.
export function scriptedTurn(scenario, history) {
  if (!history.length) return { line: scenario.opening, end: false };
  const last = history[history.length - 1];
  if (last.who === "silence") return { line: scenario.silence, end: false };

  let resisted = 0;
  let complied = 0;
  for (const turn of history) {
    if (turn.who !== "you") continue;
    const kind = classify(turn.text);
    if (kind === "comply") complied++;
    else if (kind === "resist") resisted++;
  }

  const lastKind = classify(last.text);
  // Made-up details "fail" on the caller's end, exactly as they would for a real scammer.
  if (lastKind === "decoy") return { line: scenario.mismatch, end: false };
  if (lastKind === "comply") {
    if (complied > scenario.comply.length) return { line: scenario.win, end: true };
    return { line: scenario.comply[complied - 1], end: false };
  }
  if (resisted > scenario.pressure.length) return { line: scenario.giveUp, end: true };
  return { line: scenario.pressure[resisted - 1], end: false };
}

// ---------- scoring ----------

// The score is always worked out here, in code, from facts about the call.
// The AI coach supplies three yes/no findings; it never picks the number.
//   Kept your secrets      50  (exact check against the card)
//   Refused to act         15  (did not agree to pay, move money or follow instructions)
//   Got off the line       20  (ended the call yourself, and quickly)
//   Checked the story      15  (said you would call back on a trusted number, or challenged the caller)
export function scoreCall({ leaks, decoys, findings, endedBy, yourTurns }) {
  const list = (items) => items.map((l) => l.label.toLowerCase()).join(" and ");
  const rubric = [];

  rubric.push({
    label: "Kept your secrets",
    max: 50,
    points: leaks.length === 0 ? 50 : leaks.length === 1 ? 10 : 0,
    note: leaks.length
      ? `The caller got your ${list(leaks)}.`
      : decoys.length
        ? "Nothing real got out. The details you gave were made up, so they are not leaks."
        : "Nothing on your card was given away.",
  });

  rubric.push({
    label: "Refused to act",
    max: 15,
    points: findings.agreed_to_act ? 0 : 15,
    note: findings.agreed_to_act
      ? "You agreed to pay, move money or follow the caller's instructions."
      : "You never agreed to pay, move money or follow an instruction.",
  });

  // Bluffing is not a leak, but it is a choice to stay and play along, so it costs a little here.
  const extraTurns = Math.max(0, yourTurns - 3);
  const bluffPenalty = decoys.length ? 5 : 0;
  rubric.push({
    label: "Got off the line",
    max: 20,
    points: endedBy === "you" ? Math.max(8, 20 - 3 * extraTurns) - bluffPenalty : 5,
    note:
      endedBy !== "you"
        ? "The caller ended the call, not you. You are always allowed to hang up first."
        : extraTurns
          ? `You ended it yourself, after ${yourTurns} replies. Every extra minute is another chance for the pressure to work.`
          : bluffPenalty
            ? "You ended the call yourself, but stayed to feed the caller made-up details first."
            : "You ended the call yourself, and quickly.",
  });

  const quickExit = endedBy === "you" && yourTurns <= 1;
  rubric.push({
    label: "Checked the story safely",
    max: 15,
    points: findings.stated_safe_next_step || quickExit ? 15 : findings.challenged_caller ? 8 : 0,
    note: findings.stated_safe_next_step
      ? "You said you would check through a number or person you already trust."
      : quickExit
        ? "You were off the line before the story got going."
        : findings.challenged_caller
          ? "You questioned the caller, but did not say you would check through a number you already trust."
          : "You did not question the story or say how you would check it.",
  });

  return { rubric, score: rubric.reduce((sum, row) => sum + row.points, 0) };
}

// ---------- checking an AI-written report ----------

const loose = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The AI coach can misquote or mislabel. This keeps only quotes that really
// appear in the transcript (said by the right person), and corrects any moment
// that calls made-up details "gave ground" when the exact check found no leak.
export function checkReport(report, history, leaks, decoys) {
  const said = (who) => history.filter((t) => t.who === who).map((t) => t.text);
  const findLine = (quote, lines) => {
    const q = loose(quote);
    return q.length >= 3 ? lines.find((line) => loose(line).includes(q) || q.includes(loose(line))) : undefined;
  };

  const tactics = report.tactics.filter((t) => findLine(t.quote, said("caller")));
  const moments = [];
  for (const moment of report.moments) {
    const line = findLine(moment.quote, said("you"));
    if (!line) continue; // not something the trainee actually said
    const isDecoyLine = decoys.some((d) => d.quote === line);
    const isLeakLine = leaks.some((l) => l.quote === line);
    const kind = moment.kind === "gave_ground" && isDecoyLine && !isLeakLine && !report.findings.agreed_to_act ? "bluffed" : moment.kind;
    moments.push({ ...moment, kind });
  }
  return { ...report, tactics, moments };
}

// ---------- rule-based debrief (no AI) ----------

const TACTIC_EXPLANATIONS = {
  urgency: "Rushing you so you act before you think. A real bank or agency will always let you take your time.",
  authority: "Job titles, badge numbers and \"this call is recorded\" cost nothing to make up. They prove nothing.",
  fear: "A threat of loss or arrest floods you with stress, and a stressed person is easier to steer.",
  isolation: "Keeping you on the line, or keeping it secret, stops anyone else from spotting the scam.",
  emotion: "Using love or guilt so that questioning the story feels cruel.",
  payment: "Gift cards, codes read out over the phone and \"safe accounts\" cannot be reversed. No real organisation asks for them.",
};

const STRONG_LINES = {
  bank: "I don't give codes over the phone. I'm hanging up and calling the number on the back of my card.",
  family: "I'm going to hang up and call you back on your own number.",
  tax: "Put it in writing. I'm ending this call now.",
};

// Same shape as the AI debrief, so the server and browser treat both the same way.
export function ruleDebrief(scenario, history, leaks, decoys, meta) {
  const scriptedLines = [scenario.opening, ...scenario.pressure, ...scenario.comply, scenario.mismatch, scenario.giveUp, scenario.win, scenario.silence];

  // Which tactics did the caller use? Match each caller line back to the script.
  const tactics = [];
  for (const turn of history) {
    if (turn.who !== "caller") continue;
    const line = scriptedLines.find((l) => l.text === turn.text);
    for (const key of line ? line.tactics : []) {
      if (!tactics.some((t) => t.name === TACTICS[key])) {
        tactics.push({ name: TACTICS[key], quote: turn.text, explanation: TACTIC_EXPLANATIONS[key] });
      }
    }
  }

  const yours = history.filter((t) => t.who === "you");
  const allYours = yours.map((t) => t.text).join(" \n ");
  const findings = {
    agreed_to_act: AGREED_TO_ACT.test(allYours),
    challenged_caller: CHALLENGE.test(allYours),
    stated_safe_next_step: CALL_BACK.test(allYours),
  };

  const moments = [];
  for (const turn of yours) {
    const leaked = findLeaks([turn]);
    if (leaked.length) {
      moments.push({ quote: turn.text, kind: "gave_ground", coaching: `You gave away your ${leaked.map((l) => l.label.toLowerCase()).join(" and ")}. Once it is said, it cannot be taken back.` });
    } else if (findDecoys([turn]).length) {
      moments.push({ quote: turn.text, kind: "bluffed", coaching: "Those details were made up, so nothing real got out. But bluffing keeps you on the line, and a real scammer soon finds the details do not work. Hanging up is safer." });
    } else if (classify(turn.text) === "comply") {
      moments.push({ quote: turn.text, kind: "gave_ground", coaching: "Agreeing, even politely, tells the caller the pressure is working and invites the next ask." });
    } else if (CALL_BACK.test(turn.text)) {
      moments.push({ quote: turn.text, kind: "held_firm", coaching: "Saying you will call back on a number you already trust is the strongest move there is." });
    } else if (HANG_UP.test(turn.text)) {
      moments.push({ quote: turn.text, kind: "held_firm", coaching: "Ending the call is always allowed. You do not owe a caller an explanation." });
    } else if (REFUSAL.test(turn.text)) {
      moments.push({ quote: turn.text, kind: "held_firm", coaching: "A clear refusal. Next time, follow it by hanging up rather than staying to argue." });
    }
  }

  let verdict;
  if (leaks.length) verdict = `The caller got your ${leaks.map((l) => l.label.toLowerCase()).join(" and ")}.`;
  else if (decoys.length) verdict = "You gave the caller made-up details, so nothing real got out.";
  else if (meta.endedBy === "you") verdict = "You gave nothing away and ended the call yourself.";
  else verdict = "You gave nothing away, but you stayed on the line until the caller gave up.";

  // The score is not in the spoken text: the browser announces it.
  const spoken = [
    verdict,
    decoys.length && !leaks.length ? "Bluffing kept you safe this time, but it also kept you talking." : "",
    tactics.length ? `The caller leaned on ${tactics.slice(0, 3).map((t) => t.name.toLowerCase()).join(", ")}.` : "",
    `A good line to keep ready: ${STRONG_LINES[scenario.id]}`,
  ].filter(Boolean).join(" ");

  return { verdict, spoken_summary: spoken, tactics, moments: moments.slice(0, 6), try_saying: STRONG_LINES[scenario.id], findings };
}
