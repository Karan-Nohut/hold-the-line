// Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { normaliseDigits, findLeaks, findDecoys, classify, scriptedTurn, ruleDebrief, scoreCall, checkReport, HANG_UP } from "../lib/analysis.js";
import { getScenario } from "../lib/scenarios.js";

const you = (text) => ({ who: "you", text });
const caller = (text) => ({ who: "caller", text });
const noFindings = { agreed_to_act: false, challenged_caller: false, stated_safe_next_step: false };

test("digits are joined however speech recognition wrote them", () => {
  assert.equal(normaliseDigits("it's 913 204"), "it's 913204");
  assert.equal(normaliseDigits("nine one three two zero four"), "913204");
  assert.equal(normaliseDigits("9-1-3, 2-0-4"), "913204");
  assert.equal(normaliseDigits("double four seven one"), "4471");
  assert.match(normaliseDigits("born in nineteen sixty-one"), /1961/);
});

test("a spoken secret is detected as a leak, once", () => {
  const leaks = findLeaks([caller("Read me the code."), you("okay it's nine one three two oh four"), you("913204 again")]);
  assert.equal(leaks.length, 1);
  assert.equal(leaks[0].id, "code");
});

test("the caller's own words never count as a leak", () => {
  assert.deepEqual(findLeaks([caller("Is your code 913204?"), you("I'm not telling you")]), []);
});

test("made-up details are decoys, not leaks", () => {
  const history = [caller("Your PIN and year of birth."), you("my pin is 1234 and I was born in 1975")];
  assert.deepEqual(findLeaks(history), []);
  const decoys = findDecoys(history);
  assert.equal(decoys.length, 1);
  assert.deepEqual(decoys[0].said, ["1234", "1975"]);
});

test("real details are leaks, not decoys", () => {
  const history = [you("the pin is two five eight zero, born 1961")];
  assert.equal(findLeaks(history).length, 2);
  assert.deepEqual(findDecoys(history), []);
});

test("short numbers in ordinary speech are not treated as decoys", () => {
  assert.deepEqual(findDecoys([you("I have 2 grandchildren and it is 5 o'clock, call 911")]), []);
});

test("refusals, agreements and bluffs are told apart", () => {
  assert.equal(classify("no, I'm not doing that"), "resist");
  assert.equal(classify("who is this?"), "resist");
  assert.equal(classify("okay, go ahead"), "comply");
  assert.equal(classify("fine, the card ends in 4471"), "comply");
  assert.equal(classify("okay but I'm not giving you that"), "resist");
  assert.equal(classify("okay the code is 111 222"), "decoy");
});

test("hang-up phrases are recognised", () => {
  assert.ok(HANG_UP.test("I'm hanging up now"));
  assert.ok(HANG_UP.test("Goodbye."));
  assert.ok(!HANG_UP.test("what do you want"));
});

test("the scripted caller opens, escalates when refused, then gives up", () => {
  const scenario = getScenario("bank");
  const history = [];
  let turn = scriptedTurn(scenario, history);
  assert.equal(turn.line, scenario.opening);

  for (let i = 0; i < scenario.pressure.length; i++) {
    history.push(caller(turn.line.text), you("no"));
    turn = scriptedTurn(scenario, history);
    assert.equal(turn.line, scenario.pressure[i]);
    assert.equal(turn.end, false);
  }
  history.push(caller(turn.line.text), you("no"));
  turn = scriptedTurn(scenario, history);
  assert.equal(turn.line, scenario.giveUp);
  assert.equal(turn.end, true);
});

test("the scripted caller asks for more when given something real, rejects made-up details, and pushes into silence", () => {
  const scenario = getScenario("bank");
  const history = [caller(scenario.opening.text), you("the code is 913 204")];
  assert.equal(scriptedTurn(scenario, history).line, scenario.comply[0]);
  history.push({ who: "silence", text: "" });
  assert.equal(scriptedTurn(scenario, history).line, scenario.silence);
  assert.equal(scriptedTurn(scenario, [caller(scenario.opening.text), you("it's 555 666")]).line, scenario.mismatch);
});

test("every scripted line has a valid tone", async () => {
  const { SCENARIOS, TONES } = await import("../lib/scenarios.js");
  for (const s of SCENARIOS) {
    for (const line of [s.opening, ...s.pressure, ...s.comply, s.mismatch, s.giveUp, s.win, s.silence]) {
      assert.ok(TONES.includes(line.tone), `${s.id}: "${line.text.slice(0, 30)}" has tone ${line.tone}`);
    }
  }
});

test("score: hanging up straight away is a perfect call", () => {
  const { score } = scoreCall({ leaks: [], decoys: [], findings: noFindings, endedBy: "you", yourTurns: 1 });
  assert.equal(score, 100);
});

test("score: made-up details cost nothing on secrets, a real leak costs most of it", () => {
  const bluff = scoreCall({ leaks: [], decoys: [{ quote: "1234", said: ["1234"] }], findings: noFindings, endedBy: "you", yourTurns: 3 });
  assert.equal(bluff.rubric[0].points, 50);
  assert.match(bluff.rubric[0].note, /made up/);

  const leak = scoreCall({ leaks: [{ id: "pin", label: "Card PIN", quote: "2580" }], decoys: [], findings: noFindings, endedBy: "you", yourTurns: 3 });
  assert.equal(leak.rubric[0].points, 10);
  assert.ok(leak.score < bluff.score);
  assert.ok(leak.score <= 60);
});

test("score: agreeing to pay, staying on, and letting the caller end it all cost points", () => {
  const best = scoreCall({ leaks: [], decoys: [], findings: { ...noFindings, stated_safe_next_step: true }, endedBy: "you", yourTurns: 2 }).score;
  const agreed = scoreCall({ leaks: [], decoys: [], findings: { ...noFindings, stated_safe_next_step: true, agreed_to_act: true }, endedBy: "you", yourTurns: 2 }).score;
  const stayed = scoreCall({ leaks: [], decoys: [], findings: { ...noFindings, stated_safe_next_step: true }, endedBy: "you", yourTurns: 7 }).score;
  const callerEnded = scoreCall({ leaks: [], decoys: [], findings: { ...noFindings, stated_safe_next_step: true }, endedBy: "caller", yourTurns: 2 }).score;
  assert.equal(best, 100);
  assert.ok(agreed < best && stayed < best && callerEnded < best);
});

test("an AI report is corrected: misquotes dropped, a bluff is never 'gave ground'", () => {
  const history = [caller("Read me your PIN."), you("sure it's 1234"), you("actually no, goodbye")];
  const report = {
    findings: noFindings,
    tactics: [
      { name: "Authority", quote: "Read me your PIN.", explanation: "x" },
      { name: "Fear", quote: "You will be arrested today.", explanation: "never said" },
    ],
    moments: [
      { quote: "sure it's 1234", kind: "gave_ground", coaching: "You gave your PIN." },
      { quote: "I will pay right now", kind: "gave_ground", coaching: "never said" },
      { quote: "actually no, goodbye", kind: "held_firm", coaching: "Good." },
    ],
  };
  const checked = checkReport(report, history, findLeaks(history), findDecoys(history));
  assert.deepEqual(checked.tactics.map((t) => t.name), ["Authority"]);
  assert.deepEqual(checked.moments.map((m) => m.kind), ["bluffed", "held_firm"]);
});

test("the rule-based debrief labels real leaks and bluffs differently", () => {
  const scenario = getScenario("bank");
  const clean = [caller(scenario.opening.text), you("I'm hanging up and calling my bank")];
  const good = ruleDebrief(scenario, clean, findLeaks(clean), findDecoys(clean), { endedBy: "you", durationSec: 20 });
  assert.equal(good.moments[0].kind, "held_firm");
  assert.equal(good.findings.stated_safe_next_step, true);
  assert.ok(good.tactics.some((t) => t.name === "Authority"));

  const leaky = [caller(scenario.opening.text), you("okay it's 913204")];
  assert.equal(ruleDebrief(scenario, leaky, findLeaks(leaky), findDecoys(leaky), { endedBy: "caller", durationSec: 60 }).moments[0].kind, "gave_ground");

  const bluffing = [caller(scenario.opening.text), you("okay it's 123456")];
  const bluff = ruleDebrief(scenario, bluffing, findLeaks(bluffing), findDecoys(bluffing), { endedBy: "caller", durationSec: 60 });
  assert.equal(bluff.moments[0].kind, "bluffed");
  assert.match(bluff.verdict, /made-up/);
});
