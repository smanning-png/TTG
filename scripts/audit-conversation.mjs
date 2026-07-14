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

const quickBattlecardIds = readContext("QUICK_BATTLECARD_IDS");
for (const requiredQuickCard of ["competitor_adp", "competitor_paychex", "competitor_gusto", "competitor_quickbooks_time", "competitor_toast", "competitor_7shifts", "competitor_connecteam", "competitor_innflow", "competitor_hotel_ops"]) {
  if (!quickBattlecardIds.includes(requiredQuickCard)) {
    throw new Error(`Quick battlecard tiles are missing ${requiredQuickCard}.`);
  }
}
for (const id of quickBattlecardIds) {
  if (!competitorIntel[id]) {
    throw new Error(`Quick battlecard ${id} has no competitor intel.`);
  }
}
const quickAdpQuestions = readContext('quickBattlecardQuestions(COMPETITOR_INTEL.competitor_adp)');
const quickInnFlowQuestions = readContext('quickBattlecardQuestions(COMPETITOR_INTEL.competitor_innflow)');
if (!quickAdpQuestions.some(q => /hours getting from schedules or timecards into payroll/i.test(q))) {
  throw new Error("ADP quick battlecard should include payroll handoff discovery.");
}
if (!quickInnFlowQuestions.some(q => /property team using it day to day/i.test(q))) {
  throw new Error("Inn-Flow quick battlecard should include property-team usage discovery.");
}
const quickRenderSource = readContext("selectQuickBattlecard.toString()");
for (const expectedLabel of ["Ask This", "Where We Win", "Careful"]) {
  if (!quickRenderSource.includes(expectedLabel)) {
    throw new Error(`Quick battlecard detail is missing ${expectedLabel}.`);
  }
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

let sawPermissionOpening = false;
let sawDiscoveryOpening = false;
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
    const mode = readContext("currentOpeningMode");
    if (mode === "permission") {
      sawPermissionOpening = true;
      if (!/(30-second|30 seconds|short version)/i.test(spoken)) {
        throw new Error(`Missing compact permission ask in permission opener for ${brand}.`);
      }
    } else if (mode === "discovery") {
      sawDiscoveryOpening = true;
      if (!/(compare notes|people side|mostly solved|completely off|taking more of your week|sanity-check|Which camp)/i.test(spoken)) {
        throw new Error(`Discovery opener for ${brand} is missing a natural discovery structure.`);
      }
    } else {
      throw new Error(`Unexpected opener mode ${mode} for ${brand}.`);
    }
  }
}
if (!sawPermissionOpening || !sawDiscoveryOpening) {
  throw new Error("Opening rotation should include both permission and discovery styles.");
}
readContext('currentOpeningMode = "permission"');
const openingOptionIds = new Set(readContext('getResponseOptions("opening")').map(option => option.id));
for (const simpleId of ["owner_check", "who_are_you", "too_busy", "callback_no", "not_interested", "happy_with_current", "decision_maker_no"]) {
  if (!openingOptionIds.has(simpleId)) {
    throw new Error(`Opening permission response options are missing ${simpleId}.`);
  }
}
if (openingOptionIds.has("interested")) {
  throw new Error("Opening permission should verify owner/operator before jumping into the pitch.");
}
const ownerCheckIds = new Set(readContext('getResponseOptions("owner_check")').map(option => option.id));
for (const ownerId of ["owner_one_location", "owner_multi_location", "operator_not_owner", "manager_not_dm", "wrong_contact"]) {
  if (!ownerCheckIds.has(ownerId)) {
    throw new Error(`Owner check response options are missing ${ownerId}.`);
  }
}
const locationCountIds = new Set(readContext('getResponseOptions("owner_multi_location")').map(option => option.id));
for (const locId of ["locs_two_three", "locs_four_nine", "locs_ten_plus", "locs_unsure"]) {
  if (!locationCountIds.has(locId)) {
    throw new Error(`Location-count response options are missing ${locId}.`);
  }
}
for (const prematurePainId of ["pain_payroll", "pain_scheduling", "pain_hiring", "pain_comms", "pain_compliance"]) {
  if (openingOptionIds.has(prematurePainId)) {
    throw new Error("Opening permission question should not show pain options before the prospect hears the short version.");
  }
}
readContext('currentOpeningMode = "discovery"');
const discoveryOpeningIds = new Set(readContext('getResponseOptions("opening")').map(option => option.id));
for (const discoveryId of ["happy_with_current", "curious_why", "pain_scheduling", "pain_payroll", "workflow_comms_separate", "too_busy", "not_interested", "decision_maker_no"]) {
  if (!discoveryOpeningIds.has(discoveryId)) {
    throw new Error(`Opening discovery response options are missing ${discoveryId}.`);
  }
}
if (discoveryOpeningIds.has("interested") || discoveryOpeningIds.has("callback_no")) {
  throw new Error("Opening discovery questions should not show permission-only responses.");
}
readContext('currentOpeningMode = "gatekeeper"');
const gatekeeperOpeningIds = new Set(readContext('getResponseOptions("opening")').map(option => option.id));
for (const gateId of ["gate_connects", "gate_name", "decision_maker_yes", "callback_yes", "gatekeeper_voicemail", "not_interested"]) {
  if (!gatekeeperOpeningIds.has(gateId)) {
    throw new Error(`Opening gatekeeper response options are missing ${gateId}.`);
  }
}
readContext('currentOpeningMode = "permission"');
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

sandbox.Math.random = () => 0.22;
const upsOpening = sandbox.buildOpeningInstant({
  brand: "UPS Store",
  industry: "Professional Services",
  lead_name: "Mark",
  num_locs: "2",
  prospect_role: "owner",
  known_pain: ""
});
const upsSpokenOpening = upsOpening.replace(/\[[^\]]*\]/g, "");
if (/ADP|Paychex|QuickBooks|Gusto|Deputy|When I Work|Sling|Connecteam/i.test(upsSpokenOpening)) {
  throw new Error("UPS Store opener should acknowledge existing tools without listing competitor examples before permission.");
}
if (!/already have tools in place/i.test(upsSpokenOpening) || !/30 seconds/i.test(upsSpokenOpening)) {
  throw new Error("UPS Store existing-tools opener should stay subtle and ask for a 30-second window.");
}

const toastPrompt = sandbox.buildNextPrompt("competitor_toast", "We use Toast");
if (!toastPrompt.includes("Toast") || !/what parts does Toast cover/i.test(toastPrompt) || /cost, support, switching, or gaps until/i.test(toastPrompt) === false) {
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
if (!competitorFallback.includes("Connecteam") || !/What parts does Connecteam cover/i.test(competitorFallback) || /owners still compare/i.test(competitorFallback)) {
  throw new Error("Connecteam fallback should ask scope before comparison/pain.");
}
if (/POS or department tools|finance or reporting/i.test(competitorFallback)) {
  throw new Error("Generic competitor fallback should keep the scope question short.");
}

readContext(`prospectInfo = {
  brand: "Dairy Queen",
  industry: "Food & Beverage",
  lead_name: "Sam",
  num_locs: "2",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); activeCompetitor = null;`);
const restaurant7shiftsFallback = sandbox.buildFallbackTalkTrack("competitor_7shifts", "We use 7shifts");
const restaurant7shiftsPrompt = sandbox.buildNextPrompt("competitor_7shifts", "We use 7shifts");
if (!/restaurant workflow|tips or POS handoff/i.test(restaurant7shiftsFallback) || /front desk|housekeeping|property workflow|hotel back-office|hotel departments/i.test(restaurant7shiftsFallback)) {
  throw new Error("Restaurant 7shifts fallback should use restaurant scope, not hotel language.");
}
if (!/Food & Beverage brands|tips\/POS handoff|restaurant/i.test(restaurant7shiftsPrompt) || /front desk|housekeeping|PMS|hotel back office/i.test(restaurant7shiftsPrompt)) {
  throw new Error("Restaurant 7shifts prompt should be explicitly non-hotel.");
}

readContext(`prospectInfo = {
  brand: "UPS Store",
  industry: "Professional Services",
  lead_name: "Sam",
  num_locs: "3",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); activeCompetitor = null;`);
const serviceConnecteamFallback = sandbox.buildFallbackTalkTrack("competitor_connecteam", "We use Connecteam");
if (!/store workflow|task or shift management|payroll approvals/i.test(serviceConnecteamFallback) || /front desk|housekeeping|property workflow|hotel back-office/i.test(serviceConnecteamFallback)) {
  throw new Error("Service/retail Connecteam fallback should use store workflow language, not hotel language.");
}

readContext(`prospectInfo = {
  brand: "Holiday Inn",
  industry: "Lodging & Leisure",
  lead_name: "Sam",
  num_locs: "2",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); activeCompetitor = null;`);
const hotelHotSchedulesFallback = sandbox.buildFallbackTalkTrack("competitor_hotschedules", "We use HotSchedules");
if (!/hotel scheduling|property workflow/i.test(hotelHotSchedulesFallback)) {
  throw new Error("Hotel HotSchedules fallback should still use hotel/property scope.");
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
const meetingContactIds = {
  willing: resp.willing_to_meet.map(option => option.id),
  emailConfirmed: resp.email_confirmed.map(option => option.id),
  phoneConfirmed: resp.phone_confirmed.map(option => option.id)
};
if (meetingContactIds.willing.includes("gives_phone") || !meetingContactIds.willing.includes("gives_email")) {
  throw new Error("After time is confirmed, the close should ask for invite email first, not phone-or-email.");
}
if (!meetingContactIds.emailConfirmed.includes("gives_phone")) {
  throw new Error("After email is confirmed, the close should ask for direct phone.");
}
if (meetingContactIds.phoneConfirmed.length !== 0) {
  throw new Error("Only phone confirmation after email should be the terminal booked state.");
}
const willingPrompt = sandbox.buildNextPrompt("willing_to_meet", "Tomorrow at 10am works");
const willingFallback = sandbox.buildFallbackTalkTrack("willing_to_meet", "Tomorrow at 10am works");
const emailConfirmedPrompt = sandbox.buildNextPrompt("email_confirmed", "Yep, that's right");
const emailConfirmedFallback = sandbox.buildFallbackTalkTrack("email_confirmed", "Yep, that's right");
const phoneConfirmedFallback = sandbox.buildFallbackTalkTrack("phone_confirmed", "Yep, that's the number");
if (!/best email/i.test(willingPrompt) || !/best email/i.test(willingFallback) || /email or direct number/i.test(willingFallback)) {
  throw new Error("Time-confirmed script should ask for the calendar invite email first.");
}
if (!/direct phone/i.test(emailConfirmedPrompt) || !/best direct number/i.test(emailConfirmedFallback)) {
  throw new Error("Email-confirmed script should ask for the direct phone next.");
}
if (!/confirmed email/i.test(phoneConfirmedFallback) || !/specialist/i.test(phoneConfirmedFallback)) {
  throw new Error("Final booked close should mention the confirmed email and product specialist.");
}
if (!/phone_confirmed/.test(sandbox.endSummary.toString()) || /email_confirmed[\s\S]*realMeeting/.test(sandbox.endSummary.toString())) {
  throw new Error("AE handoff should only be considered a real meeting after phone confirmation.");
}
if (!/phone_confirmed[\s\S]*markSql\("contact","Best email and direct phone confirmed", true\)/.test(sandbox.handleResponse.toString())) {
  throw new Error("Phone confirmation should mark email and phone contact info as confirmed.");
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
}; sqlState = freshSql(); activeCompetitor = null;`);

const broadStackPhases = ["interested", "give_more", "who_are_you", "after_pitch_yes", "owner_one_location", "locs_two_three", "locs_four_nine", "locs_ten_plus", "locs_unsure"];
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

readContext(`prospectInfo = {
  brand: "UPS Store",
  industry: "Professional Services",
  lead_name: "Maria",
  num_locs: "3",
  prospect_role: "owner",
  current_solution: "",
  timeline: "",
  budget: "",
  known_pain: ""
}; sqlState = freshSql(); activeCompetitor = null;`);
const upsStackIds = new Set(readContext('getResponseOptions("interested")').map(option => option.id));
for (const required of ["competitor_adp", "competitor_paychex", "competitor_quickbooks", "competitor_quickbooks_time", "competitor_wheniwork_deputy_sling", "competitor_connecteam", "franchise_hq"]) {
  if (!upsStackIds.has(required)) {
    throw new Error(`UPS Store current-stack options are missing ${required}.`);
  }
}
if (upsStackIds.has("competitor_toast") || upsStackIds.has("competitor_7shifts") || upsStackIds.has("competitor_hotschedules")) {
  throw new Error("UPS Store current-stack options should not default to restaurant scheduling tools.");
}
const upsPrompt = sandbox.buildNextPrompt("interested", "Yeah, what does it do?");
if (!/QuickBooks Time\/TSheets/i.test(upsPrompt) || !/shipping, rates, print, POS, and accounting tools/i.test(upsPrompt)) {
  throw new Error("UPS Store prompt should include UPS-relevant competitors and existing-software positioning.");
}
const upsFallback = sandbox.buildFallbackTalkTrack("who_are_you", "What is Homebase?");
if (!/shipping, rates, print, POS, and accounting tools/i.test(upsFallback) || !/employee side/i.test(upsFallback)) {
  throw new Error("UPS Store fallback should position Homebase around existing shipping/print/accounting tools.");
}
const upsBridge = readContext('existingToolsBridge({brand:"UPS Store", industry:"Professional Services"})');
if (!/shipping, rates, printing, POS, or accounting/i.test(upsBridge) || !/scheduling, timecards, payroll/i.test(upsBridge)) {
  throw new Error("UPS Store opening bridge should proactively address existing tools.");
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
const schedulingImpactPrompt = sandbox.buildNextPrompt("schedule_impact_hours", "It eats hours every week");
const schedulingImpactFallback = sandbox.buildFallbackTalkTrack("schedule_impact_hours", "It eats hours every week");
if (!/50% less time scheduling/i.test(schedulingImpactPrompt) || !/50% less time scheduling/i.test(schedulingImpactFallback)) {
  throw new Error("Scheduling impact path should use the 50% less time scheduling proof point.");
}

for (const phase of ["size_small", "size_medium", "size_large", "sched_size_small", "sched_size_medium", "sched_size_large"]) {
  if (sqlSignalMap[phase]?.key !== "impact") {
    throw new Error(`${phase} should populate Estimated users, not Company size.`);
  }
}
for (const phase of ["size_small", "size_medium", "size_large"]) {
  const ids = new Set(resp[phase].map(option => option.id));
  for (const required of ["willing_to_meet", "book_meeting", "not_now"]) {
    if (!ids.has(required)) {
      throw new Error(`${phase} should move payroll time pain toward a calendar close.`);
    }
  }
  for (const mismatch of ["pain_scheduling", "pain_payroll", "multi_loc_pain"]) {
    if (ids.has(mismatch)) {
      throw new Error(`${phase} should not zoom out to more pain after payroll time is quantified.`);
    }
  }
  const prompt = sandbox.buildNextPrompt(phase, phase === "size_small" ? "Just under 10 employees" : "Around 15-30 employees");
  const fallback = sandbox.buildFallbackTalkTrack(phase, phase);
  if (!/83% saved payroll time/i.test(prompt) || !/83% of customers saved payroll time/i.test(fallback)) {
    throw new Error(`${phase} should use the payroll time-savings proof point.`);
  }
  if (!/tomorrow at 10am/i.test(fallback) || !/tomorrow at 3pm/i.test(fallback)) {
    throw new Error(`${phase} should offer tomorrow at 10am or 3pm.`);
  }
  if (/what part of that is most painful|scheduling is|bigger drag is scheduling/i.test(prompt + "\n" + fallback)) {
    throw new Error(`${phase} should stay in the payroll lane instead of reopening discovery.`);
  }
}
const softensFallback = sandbox.buildFallbackTalkTrack("softens", "Well, what's it about?");
const callbackNoFallback = sandbox.buildFallbackTalkTrack("callback_no", "Just email me something");
const manualFallback = sandbox.buildFallbackTalkTrack("curious_why", "Manual process works");
const notInterestedFallback = sandbox.buildFallbackTalkTrack("not_interested", "We're not interested");
const happyCurrentFallback = sandbox.buildFallbackTalkTrack("happy_with_current", "We already have a system");
const switchingFallback = sandbox.buildFallbackTalkTrack("competitor_switching", "Switching sounds painful");
const lockedContractFallback = sandbox.buildFallbackTalkTrack("locked_contract", "We're locked in right now");
const valueFirstFallback = sandbox.buildFallbackTalkTrack("value_first", "Just tell me the price");
if (!/82% of customers report less stress/i.test(softensFallback)) {
  throw new Error("Quick-explanation path should be able to use the less-stress proof point.");
}
if (!/four in five customers would recommend/i.test(callbackNoFallback)) {
  throw new Error("Info-follow-up path should be able to use the recommendation proof point.");
}
if (!/82% of customers report less stress/i.test(manualFallback) || !/82% of customers report less stress/i.test(notInterestedFallback)) {
  throw new Error("Manual/status-quo objections should use the less-stress customer sentiment.");
}
if (!/Four in five customers would recommend/i.test(happyCurrentFallback) || !/four in five customers would recommend/i.test(lockedContractFallback)) {
  throw new Error("Current-provider and contract objections should use the recommendation sentiment.");
}
if (!/82% report less stress/i.test(switchingFallback)) {
  throw new Error("Switching hesitation should use the less-stress ROI sentiment.");
}
if (!/83% saved payroll time/i.test(valueFirstFallback)) {
  throw new Error("Value-first objection should use a concrete payroll-time ROI proof point.");
}
sandbox.Math.random = () => 0.65;
const roiOpening = sandbox.buildOpeningInstant({
  brand: "Ace Hardware",
  industry: "Retail",
  lead_name: "Maria",
  num_locs: "1",
  prospect_role: "owner",
  known_pain: ""
});
if (!/82% report less stress/i.test(roiOpening)) {
  throw new Error("Opening rotation should include a less-stress ROI proof point.");
}
for (const phase of ["owner_one_location", "owner_multi_location", "locs_two_three", "locs_four_nine", "locs_ten_plus", "locs_unsure"]) {
  if (sqlSignalMap[phase]?.key !== "size") {
    throw new Error(`${phase} should populate Company size as location count.`);
  }
}
const ownerPrompt = sandbox.buildNextPrompt("owner_check", "Sure, go ahead");
const multiLocationPrompt = sandbox.buildNextPrompt("owner_multi_location", "Yes, multiple locations");
if (!/own or operate/i.test(ownerPrompt) || /payroll pain/i.test(ownerPrompt)) {
  throw new Error("Owner check should verify owner/operator status before pitching.");
}
if (!/2-3 locations/i.test(multiLocationPrompt) || !/company size is locations/i.test(multiLocationPrompt)) {
  throw new Error("Multi-location prompt should ask for location count, not employees.");
}
const handleResponseSource = sandbox.handleResponse.toString();
if (!/owner_one_location[\s\S]*owner_multi_location[\s\S]*markSql\("contact","Owner \/ operator confirmed", true\)/.test(handleResponseSource)) {
  throw new Error("Owner-confirmed answers should mark the contact signal as confirmed.");
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
