import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync("index.html", "utf8");
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) throw new Error("No script block found in index.html.");

function fakeElement() {
  return {
    value: "",
    style: {},
    classList: { add() {}, remove() {} },
    focus() {},
    select() {},
    set innerHTML(value) {},
    get innerHTML() { return ""; },
    set textContent(value) {},
    get textContent() { return ""; }
  };
}

const sandbox = {
  console,
  setTimeout() {},
  sessionStorage: { getItem() { return "Sam"; }, setItem() {} },
  document: {
    getElementById() { return fakeElement(); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    body: { classList: { add() {}, remove() {} } }
  },
  window: { scrollTo() {} },
  alert() {},
  Math: Object.create(Math)
};

vm.createContext(sandbox);
vm.runInContext(scriptMatch[1], sandbox);

function readContext(expr) {
  return vm.runInContext(expr, sandbox);
}

const resp = readContext("RESP");
const guidance = readContext("FINAL_QUESTION_GUIDANCE");
const competitorIntel = readContext("COMPETITOR_INTEL");
const sqlSignalMap = readContext("SQL_SIGNAL_MAP");
const phases = new Set(Object.keys(resp));
const missingTargets = [];
const missingGuidance = [];

for (const [phase, options] of Object.entries(resp)) {
  if (options.length && !guidance[phase] && !competitorIntel[phase]) missingGuidance.push(phase);
  for (const option of options) {
    if (!phases.has(option.id)) {
      missingTargets.push(`${phase} -> ${option.id} (${option.label})`);
    }
  }
}

if (missingTargets.length || missingGuidance.length) {
  console.error(JSON.stringify({ missingTargets, missingGuidance }, null, 2));
  process.exit(1);
}

readContext(`prospectInfo = {
  brand: "Ace Hardware",
  industry: "Retail",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql();`);

for (const options of Object.values(resp)) {
  for (const option of options) {
    const prompt = sandbox.buildNextPrompt(option.id, option.label);
    const nextOptions = resp[option.id] || [];
    for (const next of nextOptions) {
      if (!prompt.includes(next.label)) {
        throw new Error(`Prompt for ${option.id} is missing response label "${next.label}".`);
      }
    }
  }
}

for (const [brand, industry] of [["Ace Hardware", "Retail"], ["Subway #441", "Food & Beverage"], ["Local Burger Shop", "Food & Beverage"]]) {
  for (const randomValue of [0.05, 0.45, 0.85]) {
    sandbox.Math.random = () => randomValue;
    const text = sandbox.buildOpeningInstant({
      brand,
      industry,
      lead_name: "Maria",
      num_locs: "3",
      prospect_role: "owner",
      known_pain: ""
    });
    const spoken = text.replace(/\[[^\]]*\]/g, "");
    if (/bad time|catch you at a bad time/i.test(spoken)) {
      throw new Error(`Bad-time wording appeared in spoken opener for ${brand}.`);
    }
    if (!/(30-second|30 seconds|short version)/i.test(spoken)) {
      throw new Error(`Missing compact permission ask in opener for ${brand}.`);
    }
  }
}

const brandProof = sandbox.buildOpeningInstant({
  brand: "Ace Hardware",
  industry: "Retail",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  known_pain: ""
});
if (!brandProof.includes("25 Ace Hardware locations")) {
  throw new Error("Brand-level social proof did not render for Ace Hardware.");
}

const toastPrompt = sandbox.buildNextPrompt("competitor_toast", "We use Toast");
if (!toastPrompt.includes("Toast") || !toastPrompt.includes("Homebase") || !toastPrompt.includes("cost")) {
  throw new Error("Toast competitor prompt did not include expected competitor guidance.");
}

const competitorFallback = sandbox.buildFallbackTalkTrack("competitor_connecteam", "We use Connecteam");
if (!competitorFallback.includes("Connecteam") || !competitorFallback.includes("payroll")) {
  throw new Error("Connecteam fallback did not include expected competitor guidance.");
}

const demoPrompt = sandbox.buildNextPrompt("want_demo", "I'd like to see it");
const demoFallback = sandbox.buildFallbackTalkTrack("want_demo", "I'd like to see it");
const weakDemoClose = /(get info first|talk price first|think it over|send the short version|short note first)/i;
const wrongMeetingName = /(30[- ]minute discovery|discovery and demo|discovery \+ demo|30[- ]minute demo|30-min demo)/i;
if (weakDemoClose.test(demoPrompt) || weakDemoClose.test(demoFallback)) {
  throw new Error("Demo-interest path offered a weak next step instead of calendar options.");
}
if (wrongMeetingName.test(demoPrompt) || wrongMeetingName.test(demoFallback)) {
  throw new Error("Demo-interest path used discovery/demo wording instead of product specialist call.");
}
if (!/product specialist/i.test(demoPrompt) || !/product specialist/i.test(demoFallback)) {
  throw new Error("Demo-interest path should position the meeting as a product specialist call.");
}
if (!/tomorrow at 10am/i.test(demoFallback) || !/following day at 2pm/i.test(demoFallback)) {
  throw new Error("Demo-interest fallback did not offer two concrete calendar options.");
}
if (resp.want_demo.some(option => ["wants_info", "price_question"].includes(option.id))) {
  throw new Error("Demo-interest response options should move toward scheduling, not info or pricing gates.");
}

readContext(`prospectInfo = {
  brand: "Buffalo Wild Wings",
  industry: "Food & Beverage",
  lead_name: "Dave",
  num_locs: "2",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); markSql("pain", "Scheduling pain confirmed", true);`);

if (resp.pain_scheduling.some(option => ["size_small", "size_medium", "size_large"].includes(option.id))) {
  throw new Error("Scheduling pain should route to scheduling-specific size branches.");
}
const schedulingSizePrompt = sandbox.buildNextPrompt("sched_size_medium", "Around 15-30 people");
const schedulingSizeFallback = sandbox.buildFallbackTalkTrack("sched_size_medium", "Around 15-30 people");
if (/payroll/i.test(schedulingSizePrompt) || /payroll/i.test(schedulingSizeFallback)) {
  throw new Error("Scheduling size path pivoted to payroll.");
}
if (!/building the schedule/i.test(schedulingSizePrompt) || !/callouts/i.test(schedulingSizeFallback)) {
  throw new Error("Scheduling size path did not dig into scheduling issues.");
}
if (!resp.sched_size_medium.every(option => option.id.startsWith("schedule_"))) {
  throw new Error("Scheduling size responses should stay in scheduling-specific branches.");
}

for (const phase of ["size_small", "size_medium", "size_large", "sched_size_small", "sched_size_medium", "sched_size_large"]) {
  if (sqlSignalMap[phase]?.key !== "impact") {
    throw new Error(`${phase} should populate Estimated users, not Company size.`);
  }
}
readContext(`prospectInfo = {
  brand: "Buffalo Wild Wings",
  industry: "Food & Beverage",
  lead_name: "Dave",
  num_locs: "2",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); seedSqlFromForm();`);
const seededSize = readContext("sqlState.size");
if (seededSize.val !== "2 location(s)" || seededSize.status !== "done") {
  throw new Error("Company size should be confirmed from number of locations.");
}
const estimatedUserValue = readContext(`estimatedUsersFromEmployeeRange("sched_size_medium")`);
if (!/15-30 employees \+ owner\(s\)/.test(estimatedUserValue)) {
  throw new Error("Estimated users should include employees plus owner(s).");
}

console.log(JSON.stringify({
  ok: true,
  phases: phases.size,
  transitions: Object.values(resp).flat().length,
  competitors: Object.keys(competitorIntel).length,
  terminalPhases: Object.entries(resp).filter(([, options]) => !options.length).map(([phase]) => phase)
}, null, 2));
