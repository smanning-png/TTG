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
  brand: "Holiday Inn",
  industry: "Lodging & Leisure",
  lead_name: "Pam",
  num_locs: "2",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); activeCompetitor = { name: "Inn-Flow" };`);

const genericFallbackPhases = [];
for (const [phase, options] of Object.entries(resp)) {
  if (!options.length) continue;
  const fallback = sandbox.buildFallbackTalkTrack(phase, phase);
  if (/The reason I am asking is|What part of that is most painful/i.test(fallback)) {
    genericFallbackPhases.push(phase);
  }
}
if (genericFallbackPhases.length) {
  throw new Error(`Response phases using generic fallback question: ${genericFallbackPhases.join(", ")}`);
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
const openingOptionIds = new Set(readContext('getResponseOptions("opening")').map(option => option.id));
for (const simpleId of ["interested", "who_are_you", "too_busy", "callback_no", "not_interested", "happy_with_current", "decision_maker_no"]) {
  if (!openingOptionIds.has(simpleId)) {
    throw new Error(`Opening permission response options are missing ${simpleId}.`);
  }
}
for (const prematurePainId of ["pain_payroll", "pain_scheduling", "pain_hiring", "pain_comms", "pain_compliance"]) {
  if (openingOptionIds.has(prematurePainId)) {
    throw new Error("Opening permission question should not show pain options before the prospect hears the short version.");
  }
}
const competitorGapIds = new Set(readContext('getResponseOptions("competitor_gap")').map(option => option.id));
for (const scopeId of ["workflow_payroll_separate", "workflow_scheduling_separate", "workflow_hiring_separate", "workflow_comms_separate", "workflow_multiple_separate"]) {
  if (!competitorGapIds.has(scopeId)) {
    throw new Error(`Competitor gap scope options are missing ${scopeId}.`);
  }
}
for (const prematurePainId of ["pain_payroll", "pain_scheduling", "pain_hiring", "pain_comms", "want_demo"]) {
  if (competitorGapIds.has(prematurePainId)) {
    throw new Error("Competitor gap scope question should not show pain/demo options before the missing workflow is known.");
  }
}
if (/responseId === "competitor_gap"[\s\S]*markSql\("pain"/.test(sandbox.handleResponse.toString())) {
  throw new Error("Selecting competitor_gap should ask for scope, not immediately confirm pain.");
}
for (const neutralScopeId of ["workflow_comms_separate", "innflow_outside_comms"]) {
  if (sqlSignalMap[neutralScopeId]?.key === "pain") {
    throw new Error(`${neutralScopeId} should be tracked as scope/current solution, not pain.`);
  }
}
for (const commsPhase of ["workflow_comms_separate", "innflow_outside_comms", "pain_comms"]) {
  const ids = new Set(readContext(`getResponseOptions("${commsPhase}")`).map(option => option.id));
  for (const methodId of ["comms_group_texts", "comms_posted_notes", "comms_manager_relay", "comms_ops_tool", "comms_missed_messages", "comms_works_fine"]) {
    if (!ids.has(methodId)) {
      throw new Error(`${commsPhase} should offer communication-method responses; missing ${methodId}.`);
    }
  }
  for (const mismatchId of ["want_demo", "pain_payroll", "not_now"]) {
    if (ids.has(mismatchId)) {
      throw new Error(`${commsPhase} asks how they reach staff and should not show ${mismatchId} at that point.`);
    }
  }
}

const aceBrandProof = sandbox.buildOpeningInstant({
  brand: "Ace Hardware",
  industry: "Retail",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  known_pain: ""
});
if (!aceBrandProof.includes("over 20 Ace Hardware locations") || aceBrandProof.includes("25 Ace Hardware locations")) {
  throw new Error("Brand-level social proof should use rounded count wording for Ace Hardware.");
}

const holidayProofLine = readContext('brandSocialProofLine("Holiday Inn")');
if (!holidayProofLine.includes("over 100 Holiday Inn locations") || holidayProofLine.includes("110 Holiday Inn locations")) {
  throw new Error("Brand-level social proof should use rounded count wording for Holiday Inn.");
}

for (const randomValue of [0.05, 0.45, 0.85]) {
  sandbox.Math.random = () => randomValue;
  const holidayOpening = sandbox.buildOpeningInstant({
    brand: "holiday inn",
    industry: "Lodging & Leisure",
    lead_name: "Sam",
    num_locs: "1",
    prospect_role: "owner",
    known_pain: ""
  });
  const spoken = holidayOpening.replace(/\[[^\]]*\]/g, "");
  if (/reason I(?:'|’)m calling is we help hourly teams/i.test(spoken) || /keep scheduling, time tracking, payroll, and hiring in one app at holiday inn/i.test(spoken)) {
    throw new Error("Holiday Inn opener should not pitch the feature stack before asking for the 30-second window.");
  }
}

const toastPrompt = sandbox.buildNextPrompt("competitor_toast", "We use Toast");
if (!toastPrompt.includes("Toast") || !/what does Toast handle/i.test(toastPrompt) || /cost, support, switching, or gaps until/i.test(toastPrompt) === false) {
  throw new Error("Toast competitor prompt should ask scope before pain.");
}
const toastOptionIds = new Set(readContext('getResponseOptions("competitor_toast")').map(option => option.id));
for (const neutralId of ["competitor_scope_payroll_hr", "competitor_scope_scheduling_time", "competitor_scope_pos_ops", "competitor_scope_finance_reporting", "competitor_scope_comms_ops", "competitor_scope_all_in_one", "competitor_scope_unsure"]) {
  if (!toastOptionIds.has(neutralId)) {
    throw new Error(`Toast scope options are missing ${neutralId}.`);
  }
}
for (const painId of ["competitor_cost", "competitor_support", "competitor_gap", "competitor_switching"]) {
  if (toastOptionIds.has(painId)) {
    throw new Error("Generic competitor first follow-up should not show pain/objection options before scope is known.");
  }
}

for (const competitorId of Object.keys(competitorIntel).filter(id => id !== "competitor_innflow")) {
  const ids = new Set(readContext(`getResponseOptions("${competitorId}")`).map(option => option.id));
  if (!ids.has("competitor_scope_payroll_hr") || !ids.has("competitor_scope_unsure")) {
    throw new Error(`${competitorId} should use neutral scope options first.`);
  }
  if (ids.has("competitor_cost") || ids.has("competitor_support") || ids.has("competitor_gap") || ids.has("competitor_switching")) {
    throw new Error(`${competitorId} should not show pain options before scope is known.`);
  }
}

const competitorFallback = sandbox.buildFallbackTalkTrack("competitor_connecteam", "We use Connecteam");
if (!competitorFallback.includes("Connecteam") || !/What does Connecteam handle/i.test(competitorFallback) || /owners still compare/i.test(competitorFallback)) {
  throw new Error("Connecteam fallback should ask scope before comparison/pain.");
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

const broadStackPhases = ["interested", "give_more", "who_are_you", "after_pitch_yes"];
const requiredStackOptions = [
  "competitor_toast",
  "competitor_gusto",
  "competitor_adp",
  "competitor_7shifts",
  "competitor_hotschedules",
  "competitor_other",
  "curious_why",
  "franchise_hq"
];
for (const phase of broadStackPhases) {
  const ids = new Set(resp[phase].map(option => option.id));
  for (const required of requiredStackOptions) {
    if (!ids.has(required)) {
      throw new Error(`${phase} is missing current-stack response option ${required}.`);
    }
  }
  if (ids.has("give_more") || ids.has("price_question")) {
    throw new Error(`${phase} should answer the current-stack question, not offer pitch/price detours.`);
  }
}
const broadStackPrompt = sandbox.buildNextPrompt("interested", "Yeah, what does it do?");
if (!broadStackPrompt.includes("Toast handles POS / some team tools") || !broadStackPrompt.includes("Gusto handles payroll")) {
  throw new Error("Broad discovery prompt is missing competitor/current-stack response labels.");
}

const accorIndustry = readContext('detectIndustry("Accor").industry');
if (accorIndustry !== "Lodging & Leisure") {
  throw new Error("Accor should auto-detect as Lodging & Leisure.");
}
const cinnabonIndustry = readContext('detectIndustry("Cinnabon").industry');
if (cinnabonIndustry !== "Food & Beverage") {
  throw new Error("Cinnabon should not be misclassified as lodging because it contains 'inn'.");
}

readContext(`prospectInfo = {
  brand: "Holiday Inn",
  industry: "Lodging & Leisure",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql();`);

const hotelStackOptions = readContext('getResponseOptions("interested")');
const hotelStackIds = new Set(hotelStackOptions.map(option => option.id));
const requiredHotelOptions = [
  "competitor_innflow",
  "competitor_actabl",
  "competitor_m3",
  "competitor_unifocus",
  "competitor_harri",
  "competitor_wheniwork_deputy_sling",
  "competitor_hotel_ops",
  "competitor_hcm_hotel"
];
for (const required of requiredHotelOptions) {
  if (!hotelStackIds.has(required)) {
    throw new Error(`Hotel current-stack options are missing ${required}.`);
  }
  if (!phases.has(required)) {
    throw new Error(`Hotel current-stack option ${required} has no response phase.`);
  }
}
if (hotelStackIds.has("competitor_toast") || hotelStackIds.has("competitor_gusto")) {
  throw new Error("Hotel current-stack options should not default to the generic F&B stack.");
}
const hotelPrompt = sandbox.buildNextPrompt("interested", "Yeah, what does it do?");
if (!hotelPrompt.includes("Inn-Flow handles hotel back office") || !hotelPrompt.includes("Quore / hotelkit / ALICE handles ops")) {
  throw new Error("Hotel discovery prompt is missing hospitality competitor response labels.");
}
if (!/managing and paying staff/i.test(hotelPrompt) || !/hotel suite/i.test(hotelPrompt)) {
  throw new Error("Hotel discovery prompt should ask about hotel-specific workforce stack.");
}
const hotelWhoAreYouPrompt = sandbox.buildNextPrompt("who_are_you", "What is Homebase?");
if (!/What are you using today for managing and paying staff/i.test(hotelWhoAreYouPrompt) || !/property-level people workflow for hotels/i.test(hotelWhoAreYouPrompt)) {
  throw new Error("Hotel who-are-you prompt should use the shorter managing-and-paying-staff talk track.");
}
const hotelWhoAreYouFallback = sandbox.buildFallbackTalkTrack("who_are_you", "What is Homebase?");
if (!/What are you using today for managing and paying staff/i.test(hotelWhoAreYouFallback) || /What are you using today for scheduling, time clocks, payroll, hiring, and team communication/i.test(hotelWhoAreYouFallback)) {
  throw new Error("Hotel who-are-you fallback should not repeat the long workflow list in the question.");
}
const hotelSystemPrompt = sandbox.buildSystemPrompt({
  brand: "Holiday Inn",
  industry: "Lodging & Leisure",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
});
if (!hotelSystemPrompt.includes("HOTEL / HOSPITALITY MODE") || !hotelSystemPrompt.includes("Never say Homebase replaces PMS")) {
  throw new Error("Hotel system prompt is missing hospitality-specific guardrails.");
}
const innFlowPrompt = sandbox.buildNextPrompt("competitor_innflow", "We use Inn-Flow");
if (!/What parts of the business does Inn-Flow handle/i.test(innFlowPrompt) || /bigger issue/i.test(innFlowPrompt)) {
  throw new Error("Inn-Flow prompt should ask a neutral scope question before assuming pain.");
}
const innFlowOptionIds = new Set(readContext('getResponseOptions("competitor_innflow")').map(option => option.id));
for (const neutralId of ["innflow_scope_accounting", "innflow_scope_labor", "innflow_scope_payroll", "innflow_scope_whole_platform", "innflow_scope_unsure"]) {
  if (!innFlowOptionIds.has(neutralId)) {
    throw new Error(`Inn-Flow scope options are missing ${neutralId}.`);
  }
}
for (const painId of ["competitor_cost", "competitor_support", "competitor_gap", "competitor_switching"]) {
  if (innFlowOptionIds.has(painId)) {
    throw new Error("Inn-Flow first follow-up should not show pain/objection options before scope is known.");
  }
}
const innFlowFallback = sandbox.buildFallbackTalkTrack("competitor_innflow", "Inn-Flow handles hotel back office");
if (!/What parts of the business does Inn-Flow handle/i.test(innFlowFallback) || /Cost or add-ons/i.test(innFlowFallback)) {
  throw new Error("Inn-Flow fallback should ask scope before pain.");
}
const innFlowPayrollIds = new Set(readContext('getResponseOptions("innflow_scope_payroll")').map(option => option.id));
for (const scopeId of ["innflow_outside_hiring", "innflow_outside_comms", "innflow_outside_manager_work", "innflow_property_covered", "innflow_scope_unsure"]) {
  if (!innFlowPayrollIds.has(scopeId)) {
    throw new Error(`Inn-Flow payroll-included scope options are missing ${scopeId}.`);
  }
}
for (const prematurePainId of ["competitor_gap", "competitor_cost", "competitor_support", "want_demo"]) {
  if (innFlowPayrollIds.has(prematurePainId)) {
    throw new Error("Inn-Flow payroll-included scope question should not show cost/support/demo options before the remaining scope is known.");
  }
}
const innFlowPayrollFallback = sandbox.buildFallbackTalkTrack("innflow_scope_payroll", "Payroll is in Inn-Flow too");
if (!/what, if anything, still sits outside Inn-Flow/i.test(innFlowPayrollFallback) || /expensive|support|setup is heavy/i.test(innFlowPayrollFallback)) {
  throw new Error("Inn-Flow payroll-included fallback should ask remaining scope before pain.");
}
const innFlowFullSuiteIds = new Set(readContext('getResponseOptions("innflow_scope_whole_platform")').map(option => option.id));
for (const neutralId of ["innflow_usage_property_team", "innflow_usage_back_office", "innflow_usage_both", "innflow_scope_unsure"]) {
  if (!innFlowFullSuiteIds.has(neutralId)) {
    throw new Error(`Inn-Flow full-suite usage options are missing ${neutralId}.`);
  }
}
for (const prematurePainId of ["competitor_gap", "competitor_cost", "competitor_support", "want_demo"]) {
  if (innFlowFullSuiteIds.has(prematurePainId)) {
    throw new Error("Inn-Flow full-suite usage question should not show pain/demo options before user type is known.");
  }
}
const innFlowFullSuiteFallback = sandbox.buildFallbackTalkTrack("innflow_scope_whole_platform", "The whole back-office suite");
if (!/Who actually uses Inn-Flow day to day/i.test(innFlowFullSuiteFallback) || /struggles|heavier than we need|compare/i.test(innFlowFullSuiteFallback)) {
  throw new Error("Inn-Flow full-suite fallback should ask a usage question before pain.");
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
