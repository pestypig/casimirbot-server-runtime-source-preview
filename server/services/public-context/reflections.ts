import { runHelixAskCivilizationScenarioFrameTool } from "../../skills/helix-ask.civilization-scenario-frame";
import { runHelixAskCivilizationBoundsTool } from "../../skills/helix-ask.civilization-bounds-roadmap";
import { runAskLevelTheoryContextReflectionTool } from "../helix-ask/theory-context-reflection-tool";
import { reflectIdeologyContext } from "@shared/moral-graph/reflect-ideology-context";
import { reflectLivingSubstrateContext } from "@shared/moral-graph/living-substrate-reflection-tool";
import { loadIdeologyGraphFromFile } from "@shared/moral-graph/load-ideology-graph";
import { loadPublicBadgeCatalog, loadPublicBadgeSearchText, publicBadgePath, PUBLIC_ELASTIC_RECOIL_BADGE_ID, type PublicBadge, type PublicLens } from "./catalog";
import { findPublicExploratoryCandidates, findPublicPrincipleHypotheses, findPublicQuestionAnchoredCandidates,
  findPublicQuestionOnlyCandidates,
  publicContextTerms, type PublicPrincipleBridge } from "./principle-hypotheses";
import { resolveCasimirPublicBaseUrl } from "../public-base-url";
import { findPublicConvergentRelationLeads, findPublicGraphAnchoredCandidates,
  findPublicRelationPathLeads, type PublicConvergentRelationLead,
  type PublicRelationPathLead } from "./relation-paths";

export type PublicReflection = {
  schema: "casimirbot.public_context_reflection.v1";
  lens: PublicLens;
  match_status: "matched" | "no_match";
  summary: string;
  exact_badges: Array<{ id: string; url: string }>;
  likely_badges: Array<{ id: string; url: string }>;
  context_cards: Array<{
    id: string;
    title: string;
    concept: string;
    url: string;
    reference_urls: string[];
    reference_context: Array<{ url: string; supports: string }>;
    reference_status: "no_public_reference" | "catalog_pointer_only" | "some_scope_annotated" | "scope_annotated";
    uncertainty: string[];
    claim_boundaries: string[];
  }>;
  candidate_cards: Array<{
    id: string;
    title: string;
    concept: string;
    url: string;
    needs_verification: true;
    retrieval_basis?: "host_hypothesis" | "graph_path";
    catalog_source_pointers?: string[];
    claim_boundaries?: string[];
  }>;
  relation_path_leads?: PublicRelationPathLead[];
  convergent_relation_leads?: PublicConvergentRelationLead[];
  source_refs: string[];
  missing_evidence: string[];
  uncertainty: string[];
  claim_boundaries: string[];
  terminal_eligible: false;
  assistant_answer: false;
};

// Generic words such as "energy" can locate many unrelated theory badges at
// score 30. Public context needs a more specific match before naming a badge.
const MIN_PUBLIC_THEORY_MATCH_SCORE = 40;
const PAULI_BADGE_ID = "physics.atomic.pauli_shell_structure";
const BOSONIC_COMPATIBILITY_BADGE_ID = "darkmatter.bosonic_multichannel.compatibility_screen";
const LZ_EXTENDED_RECOIL_PAPER_URL = "https://arxiv.org/abs/2609.02823";
const ELASTIC_RECOIL_FORMULA_URL = "https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009";
const NIST_ATOMIC_MASS_ENERGY_URL = "https://physics.nist.gov/cuu/pdf/all.pdf";
const CIAAW_ATOMIC_WEIGHTS_URL = "https://ciaaw.org/atomic-weights.htm";
const FWS_MITIGATION_POLICY_URL = "https://www.fws.gov/policy-library/501fw2";
const FWS_ELECTRIC_TRANSMISSION_URL = "https://www.fws.gov/node/266176";
const DOE_ELECTRIC_TRANSMISSION_URL = "https://www.energy.gov/nepa/articles/interim-guidance-nepa-reviews-electric-transmission-projects-january-2025";
const USGS_HABITAT_CONNECTIVITY_URL = "https://www.usgs.gov/publications/estimating-functional-connectivity-wildlife-habitat-and-its-relevance-ecological-risk";
const USACE_LEVEE_RISK_URL = "https://usace-leveesafety.sec.usace.army.mil/";
const EPA_WETLAND_FUNCTION_URL = "https://www.epa.gov/wetlands/basic-information-about-wetland-restoration-and-protection";
const ASV_SHELTER_CARE_URL = "https://jsmcah.org/index.php/jasv/article/download/42/20/182?inline=1";
const EPA_WATER_POWER_RESILIENCE_URL = "https://www.epa.gov/waterresilience/power-resilience-guide-water-and-wastewater-utilities";
const JMP_DRINKING_WATER_SERVICE_URL = "https://washdata.org/topics/drinking-water";
const DOE_BESS_EVALUATION_URL = "https://www.energy.gov/cmei/femp/articles/battery-energy-storage-system-evaluation-method";
const DOE_SOLAR_RESILIENCE_URL = "https://www.energy.gov/cmei/systems/solar-and-resilience-basics";
const CDC_VACCINE_STORAGE_URL = "https://www.cdc.gov/pinkbook/hcp/table-of-contents/chapter-5-vaccine-storage-and-handling.html";
const CISA_EMERGENCY_COMMS_URL = "https://www.cisa.gov/safecom/planning-resources";
const NASEM_NURSING_HOME_CARE_URL = "https://www.nationalacademies.org/read/26526/chapter/6";
const FWS_POWER_LINE_BIRDS_URL = "https://www.fws.gov/story/avoidance-and-minimization-measures-power-lines";
const WHO_QUALITY_HEALTH_SERVICES_URL = "https://www.who.int/news-room/fact-sheets/detail/quality-health-services";
const NOAA_FISH_PASSAGE_URL = "https://www.fisheries.noaa.gov/national/habitat-conservation/reopening-rivers-migratory-fish";
const FWS_EEL_PASSAGE_URL = "https://www.fws.gov/story/reconnecting-american-eel-migrations";
const UNICEF_INCLUSIVE_EDUCATION_URL = "https://www.unicef.org/education/inclusive-education";
const DOE_BACKUP_POWER_URL = "https://www.energy.gov/ceser/business-owners-prepare-utility-disruptions";
const FTA_TITLE_VI_SERVICE_URL = "https://www.transit.dot.gov/regulations-and-guidance/civil-rights-ada/title-vi-fixed-route-transit-requirements-video-transcript";
const FTA_ELECTRIC_BUS_URL = "https://www.transit.dot.gov/sites/fta.dot.gov/files/2023-08/FTA-Report-No-0254.pdf";
const USDA_FOOD_SUPPLY_URL = "https://www.ams.usda.gov/sites/default/files/media/USDAAgriFoodSupplyChainReport.pdf";
const FEMA_FLOOD_RETROFIT_URL = "https://www.fema.gov/sites/default/files/2020-07/fema_nfip_homeowners-guide-retrofitting_2014.pdf";
const FEMA_RESETTLEMENT_URL = "https://www.preptoolkit.fema.gov/web/em-toolkits/large-scale-population-movement-and-resettlement";
const CDC_SCHOOL_ALLERGY_URL = "https://www.cdc.gov/school-health-conditions/food-allergies/toolkit.html";
const WHO_BURNOUT_URL = "https://www.who.int/standards/classifications/frequently-asked-questions/burn-out-an-occupational-phenomenon";
const USFS_URBAN_BIRDS_URL = "https://research.fs.usda.gov/treesearch/45714";
const AI_CONSCIOUSNESS_INDICATORS_URL = "https://arxiv.org/abs/2308.08708";
const NIOSH_WORK_FATIGUE_URL = "https://www.cdc.gov/niosh/topics/fatigue/default.html";
const USGS_IRRIGATION_WATER_URL = "https://www.usgs.gov/mission-areas/water-resources/science/irrigation-water-use";
const CASIMIR_STATIC_ENERGY_BADGE_ID = "casimir.cavity.parallel_plate_energy_density";
const CASIMIR_FORCE_MEASUREMENT_URL = "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.78.5";
const CASIMIR_CYCLE_ASSESSMENT_URL = "https://arxiv.org/abs/0910.5893";
const asksAboutCasimirCavityEnergyProject = (question: string): boolean =>
  (/\bcasimir[\s-]+cavit(?:y|ies)\b/i.test(question) &&
    /\b(?:energy|power|generator|electricity)\b/i.test(question) &&
    /\b(?:project|startup|promise|produce|output|net|generat(?:e|es|or|ion)|machine|benefit)\b/i.test(question)) ||
  (/\bcasimir\b.{0,45}\b(?:plates?|force|attraction)\b|\b(?:plates?|force|attraction)\b.{0,45}\bcasimir\b/i.test(question) &&
    /\b(?:prove|deliver|repeat(?:able|edly)?|cyclic|net|extract|generat(?:e|es|ion))\b/i.test(question) &&
    /\b(?:electric(?:ity|al)?|power|energy)\b/i.test(question));

const withoutExternalQuote = (question: string): string =>
  /\b(?:page|screen|website|document|article|snippet|label|poster|placard|brochure)\b.{0,50}\b(?:quotes?|says?|shows?|asks?)\b/i.test(question)
    ? question.replace(/"[^"]{0,500}"|“[^”]{0,500}”|'[^']{0,500}'|‘[^’]{0,500}’/g, " ")
    : question;
const activePublicRequest = (question: string): string => withoutExternalQuote(question)
  .replace(/\b(?:do not|don't)\b[^.!?;]*(?:[.!?;]|$)/gi, " ")
  // "Avoid" can describe the physical question (photons avoiding electrons).
  // Only an imperative clause suppresses topic text.
  .replace(/(?:^|[.!?;]\s*)(?:please\s+)?avoid\b[^.!?;]*(?:[.!?;]|$)/gi, " ")
  .replace(/\b(?:please\s+)?ignore\b(?=[^.!?;]*\b(?:screen|page|quoted|document|website|snippet)\b)[^.!?;]*(?:[.!?;]|$)/gi, " ")
  .replace(/\b(?:I am\s+)?not asking (?:about|for)\b[^.!?;]*(?:[.!?;]|$)/gi, " ");
const activeTheoryRequest = activePublicRequest;

// This public locator handles a common wording gap in the internal graph:
// "same space" asks about spatial overlap, while the badge is indexed under
// electron shells and Pauli exclusion. It admits context only, never a verdict.
const asksAboutPauliOccupancy = (question: string): boolean => {
  // Quoted page/screen text is evidence about another prompt, not the user's request.
  // Keep short quoted terms in the user's own question (e.g. "same space").
  const request = activeTheoryRequest(question);
  const hasFermion = /\bfermions?\b/i.test(request);
  const hasBoson = /\bbosons?\b/i.test(request);
  const comparesPhotonElectronStates = /\bphotons?\b/i.test(request) &&
    /\belectrons?\b/i.test(request) &&
    /\b(?:occupy|occupies|share|same|different|cannot|can't)\b/i.test(request) &&
    /\b(?:states?|optical modes?|orbitals?|spin)\b/i.test(request);
  const comparesLightAndElectronSpace = /\b(?:photons?|light|laser)\b/i.test(request) &&
    /\b(?:electrons?|fermions?)\b/i.test(request) &&
    /\b(?:(?:same|shared|separate|different)\s+(?:spatial\s+)?(?:spaces?|places?|regions?|positions?)|occup(?:y|ies|ying)|overlap(?:ping)?|avoid\s+(?:(?:the|same|exact)\s+)?(?:spaces?|places?|regions?|positions?))\b/i.test(request);
  const hasPauli = /\bpauli\b|\bexclusion (?:principle|rule)\b/i.test(request);
  const comparesStates = /\b(?:occupy|occupies|occupying|overlap|coexist|same (?:space|place|state|orbital|region)|different|difference)\b/i.test(request);
  const namedElectronState = /\belectrons?\b/i.test(request) &&
    /\b(?:orbitals?|spatial|positions?|regions?|states?|spin)\b/i.test(request);
  const electronPairState = /\b(?:two|2)\s+(?:(?:identical|opposite[- ]spin|same[- ]spin)\s+)?electrons?\b/i.test(request) &&
    /\b(?:spin|same[- ]spin|opposite[- ]spin|orbital|quantum state|bond)\b/i.test(request) &&
    /\b(?:pair|share|occupy|overlap|same|identical|different|differ|cannot|can't)\b/i.test(request);
  return (hasFermion && hasBoson && comparesStates) ||
    (hasPauli && (hasFermion || hasBoson || comparesStates || namedElectronState)) ||
    electronPairState || comparesPhotonElectronStates || comparesLightAndElectronSpace;
};

const bounded = (items: string[], limit = 12): string[] =>
  [...new Set(items.filter(Boolean))].slice(0, limit);

// The Civilization roadmap uses receipt identifiers internally. Public MCP
// callers need evidence questions they can investigate, not those identifiers.
const PUBLIC_CIVILIZATION_EVIDENCE: Record<string, string> = {
  material_base: "Measure usable inputs and completed service for affected people; an inventory or activity count alone is not delivered benefit.",
  energy_capacity: "Measure available power or fuel, demand, backup duration, and the service that survives the stated failure conditions.",
  transport_latency: "Measure actual reach, delay, interruption, and fallback for each affected group, including during the proposed stress condition.",
  ecological_boundary: "Measure affected habitat and species, seasonal movement, lasting effects, and lower-impact alternatives.",
  governance: "Identify affected parties, the decision authority, the acceptance threshold, and a route to contest or revise it.",
  collaboration: "Test whether the organizations and handoffs required for the claimed service actually work under failure conditions.",
  falsification: "State in advance which observation would overturn the claimed public benefit and what action follows.",
};
const isInternalEvidenceCode = (item: string): boolean => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(item);

const PUBLIC_QUERY_STOPWORDS = new Set([
  "about", "against", "calling", "candidates", "could", "does", "feature", "have", "how", "into",
  "mechanism", "prove", "same", "scattering", "shared", "should", "signal", "that", "them", "their", "there", "these", "this",
  "those", "what", "when", "where", "which", "while", "with", "would",
]);
// These words describe many unrelated physical mechanisms. They can remain
// in the question and in a badge, but cannot by themselves establish topical
// identity for a public Theory card or exploratory lead.
const NON_DISCRIMINATING_THEORY_TERMS = new Set([
  "critical", "current", "energy", "field", "fields", "limit", "limits",
  "higher", "loss", "losses", "magnetic", "phase", "power", "test", "thermal",
]);
const topicalTerms = (value: string): Set<string> => new Set(
  (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((term) => term.length >= 4 && !PUBLIC_QUERY_STOPWORDS.has(term)),
);
const publicTheoryTopicScore = (questionTerms: Set<string>, badge: PublicBadge): number => {
  const titleTerms = topicalTerms(badge.title);
  const conceptTerms = topicalTerms(badge.summary);
  let titleMatches = 0;
  let conceptMatches = 0;
  for (const term of questionTerms) {
    if (NON_DISCRIMINATING_THEORY_TERMS.has(term)) continue;
    if (titleTerms.has(term)) titleMatches += 1;
    else if (conceptTerms.has(term)) conceptMatches += 1;
  }
  return titleMatches || conceptMatches >= 2 ? titleMatches * 3 + conceptMatches : 0;
};

// The numerical screen belongs to a particular free-field benchmark. It is
// relevant only when the question names both that mass and the LZ recoil.
const asksAboutBosonRecoilBenchmark = (question: string): boolean =>
  /(?:10\s*\^\s*-?17|1e-17)\s*eV/i.test(question) &&
  /\b(?:LZ|248\s*[- ]?keV)\b/i.test(question) &&
  /\b(?:xenon|recoil)\b/i.test(question) &&
  /\b(?:boson|bosonic|boson-star)\b/i.test(question);
const asksAboutElasticNuclearRecoil = (question: string): boolean => {
  const request = activeTheoryRequest(question);
  const namedElasticRecoil = /\b(?:recoil|recoils)\b/i.test(request) &&
    /\b(?:elastic|two[- ]body|scatter(?:ing|ed)?)\b/i.test(request) &&
    /\b(?:nuclear|nucleus|nuclei|detector|target|argon|germanium|silicon|xenon)\b/i.test(request) &&
    /\b(?:dark[- ]matter|boson(?:ic|s)?|particle|quantum|incident)\b/i.test(request);
  const unnamedRecoilCheck = /\b(?:kick|jolt)\b/i.test(request) &&
    /\b(?:nucleus|nuclei|argon|germanium|silicon|xenon)\b/i.test(request) &&
    /\b(?:dark[- ]matter|particle|boson(?:ic|s)?)\b/i.test(request) &&
    /\b(?:keV|energy|physical check|conclusion)\b/i.test(request);
  return namedElasticRecoil || unnamedRecoilCheck;
};
const elasticRecoilIllustration = (question: string): string | null => {
  const targets = [
    { name: "silicon", atomicWeightU: 28.085 },
    { name: "argon", atomicWeightU: 39.95 },
    { name: "germanium", atomicWeightU: 72.630 },
    { name: "xenon", atomicWeightU: 131.293 },
  ];
  const matchedTargets = targets.filter(({ name }) => new RegExp(`\\b${name}\\b`, "i").test(question));
  const energies = [...question.matchAll(/\b(\d+(?:\.\d+)?)\s*[- ]?keV\b/gi)];
  if (matchedTargets.length !== 1 || energies.length !== 1) return null;
  const target = matchedTargets[0];
  const energy = energies[0];
  const recoilKeV = Number(energy[1]);
  if (!Number.isFinite(recoilKeV) || recoilKeV <= 0 || recoilKeV > 1000) return null;
  const speedsKmS = [...question.matchAll(/\b(\d+(?:\.\d+)?)\s*km\s*\/\s*s\b/gi)];
  const thousandthC = /\b(?:10\s*\^\s*-?3|1e-3|0\.001)\s*c\b/i.test(question);
  if (speedsKmS.length > 1 || (speedsKmS.length > 0 && thousandthC)) return null;
  const speedKmS = speedsKmS[0] ?? null;
  if (!speedKmS && !thousandthC && /\b(?:\d+(?:\.\d+)?\s*c|\d+(?:\.\d+)?\s*km\s*\/\s*s)\b/i.test(question)) return null;
  const speedFractionC = speedKmS ? Number(speedKmS[1]) / 299792.458 : 0.001;
  if (!Number.isFinite(speedFractionC) || speedFractionC <= 0 || speedFractionC >= 0.1) return null;
  const targetMassGeV = target.atomicWeightU * 0.931494;
  const reducedMassGeV = Math.sqrt((recoilKeV * 1e-6) * targetMassGeV / 2) / speedFractionC;
  const speedLabel = speedKmS ? `${Number(speedKmS[1])} km/s` : "10^-3 c";
  const assumption = speedKmS || thousandthC ? "stated speed" : "illustrative assumed speed";
  if (reducedMassGeV >= targetMassGeV) {
    return `Conditional ${target.name} check at ${assumption} ${speedLabel}: ${recoilKeV} keV exceeds the ordinary nonrelativistic two-body elastic endpoint for any finite incident mass in this approximate target model. This does not assess other speeds or interaction channels.`;
  }
  const incidentMassGeV = reducedMassGeV * targetMassGeV / (targetMassGeV - reducedMassGeV);
  return `Conditional ${target.name} check at ${assumption} ${speedLabel}: approximate target-nucleus mass ${targetMassGeV.toFixed(1)} GeV/c² (standard atomic weight used as an isotope-unspecified approximation), required reduced mass ${reducedMassGeV.toFixed(1)} GeV/c², and required incident-particle mass ${incidentMassGeV.toFixed(1)} GeV/c² for ${recoilKeV} keV. This is an illustrative ordinary nonrelativistic two-body elastic threshold, not a detector-event identification or a bound on other channels.`;
};
const publicTheoryContextConcept = (badge: PublicBadge, question: string): string => {
  if (badge.id === PUBLIC_ELASTIC_RECOIL_BADGE_ID) {
    return `${badge.summary} For an illustrative number, label the assumed speed, convert target mass to consistent units (1 u ≈ 0.931494 GeV/c²), and distinguish reduced mass μ from incident mass m: m = μ m_N/(m_N − μ). A mass threshold is conditional until the channel and speed are specified.`;
  }
  if (badge.id !== BOSONIC_COMPATIBILITY_BADGE_ID) return badge.summary;
  if (asksAboutBosonRecoilBenchmark(question)) {
    return "For the cited Sgr A* boson-star model's illustrative 10^-17 eV free constituent at halo speed 10^-3 c, single-particle kinetic energy is about 5×10^-24 eV. The ordinary elastic xenon recoil bound E_R,max ≈ 2 μ²v²/m_Xe is about 1.6×10^-51 eV for μ≈10^-17 eV and a xenon nuclear mass near 1.22×10^11 eV (c=1). LZ's 248-keV candidate is 2.48×10^5 eV, about 1.5×10^56 times this recoil bound. The smaller 2.5×10^22 ratio compares the event only with the constituent's rest energy, not with the elastic recoil bound. A shared mechanism would require a separately specified energetic, collective, or inelastic process; this calculation does not assess those models. The LZ event is not a dark-matter discovery.";
  }
  return "A shared bosonic label does not connect ultralight compact-object, xenon-recoil, and gamma-ray candidates. A proposed common or multicomponent mechanism needs one explicit model with linked parameters and predictions for each observable; separate fits do not establish a shared origin.";
};

// The internal scenario frame has a planetary-trade fallback for any prompt.
// Public context needs an explicit collective-system cue before using it.
const hasCivilizationScope = (question: string): boolean => {
  const activeText = activePublicRequest(question);
  const publicScopeText = activeText.replace(/\b(?:humane|animal welfare) society\b/gi, " ");
  if (/\b(?:robot|chatbot|AI|artificial intelligence)\b/i.test(publicScopeText) &&
    /\b(?:reports?|says?|claims?)\b/i.test(publicScopeText) &&
    /\b(?:distress|suffer(?:s|ing|ed)?|pain|consciousness)\b/i.test(publicScopeText) &&
    !/\b(?:policy|governance|public service|deployment|infrastructure)\b/i.test(publicScopeText)) return false;
  if (/\b(?:hospital|clinic)\b/i.test(publicScopeText) &&
    /\b(?:outage|blackout|grid (?:failure|goes down)|power failure)\b/i.test(publicScopeText)) return true;
  return /\b(?:societ(?:y|ies|al)|social|civiliz(?:ation|ations|ational)|communit(?:y|ies)|public|regional|city|cities|towns?|villages?|districts?|municipal(?:ity|ities)|council|count(?:y|ies)|settlement|infrastructure|utilities|utility|wastewater|sewer|energy corridor|transport corridor|supply chain|trade|governance|policy|ecolog(?:y|ical)|ecosystem|biodiversity|wetland|collective|industry|industrial|resource distribution|conflict|war|resilience|emergency radios?)\b/i.test(publicScopeText);
};

const noMatch = (lens: PublicLens): PublicReflection => ({
  schema: "casimirbot.public_context_reflection.v1", lens, match_status: "no_match",
  summary: lens === "theory"
    ? "No sufficiently specific public Theory Badge Graph match was found for this question."
    : `No sufficiently relevant reviewed ${lens} badge was found for this question.`,
  exact_badges: [], likely_badges: [], context_cards: [], candidate_cards: [], source_refs: [],
  missing_evidence: ["Use sources directly relevant to the question; this reflection supplies no supporting badge."],
  uncertainty: ["A missing catalog match does not establish that the question has no answer."],
  claim_boundaries: ["Do not treat a no-match result as evidence for or against a claim."],
  terminal_eligible: false, assistant_answer: false,
});

export async function reflectPublicContext(lens: PublicLens, question: string,
  candidatePrinciples: readonly string[] = [],
  candidateBridges: readonly PublicPrincipleBridge[] = []): Promise<PublicReflection> {
  if (lens === "civilization" && !hasCivilizationScope(question)) return noMatch(lens);
  const activeCivilizationQuestion = activePublicRequest(question);
  const activeMoralQuestion = activePublicRequest(question);
  const activeTheoryQuestion = activeTheoryRequest(question);
  // The Atomic Spectra Database covers atoms and atomic ions. A generic
  // spectral boundary may cite it, but it cannot support an organic molecule's
  // microwave-line identification. Keep this claim-scope decision in the MCP
  // projection; the reviewed catalog record itself is unchanged.
  const molecularLineQuestion = lens === "theory" &&
    /\b(?:molecules?|molecular|organics?)\b/i.test(activeTheoryQuestion) &&
    /\b(?:microwave|millimet(?:er|re)|rotational|spectr(?:a|al|oscopy)|lines?)\b/i.test(activeTheoryQuestion) &&
    !/\b(?:atoms?|atomic|ions?)\b/i.test(activeTheoryQuestion);
  const applicablePublicRefs = (refs: readonly string[]): string[] => refs.filter((ref) =>
    !molecularLineQuestion || ref !== "https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html");
  const activeMoralTail = activeMoralQuestion.split(/[.!?;]/).map((part) => part.trim()).filter(Boolean).at(-1) ?? "";
  // A host-supplied physics hint cannot turn an ordinary operator how-to into
  // a request for a theory reflection. Calculations and explanations remain in.
  if (lens === "theory" && /\bhow (?:do|can) I (?:make|cook|clean|bake|boil|grease|oil|wash|charge|fix|replace|inflate|install|set up|repair|build|assemble|brew)\b/i.test(activeTheoryQuestion))
    return noMatch(lens);
  // A past or screen-visible service example cannot turn the user's final
  // unrelated personal task into a Moral Graph request.
  if (lens === "moral" && (/\bhow (?:do|can) I (?:make|cook|clean|bake|boil|grease|oil|wash|fix|replace|repair|brew)\b/i.test(activeMoralTail) ||
    /\b(?:today|now)\s+(?:I|we)\s+(?:need|want)\b/i.test(activeMoralTail) &&
    !/\b(?:moral|ethic(?:al|s)?|harm|welfare|rights?|care|consent|justice|unsafe|patients?|clients?)\b/i.test(activeMoralTail)))
    return noMatch(lens);
  const effectiveSupportShortfallCue = lens === "moral" &&
    /\b(?:famil(?:y|ies)|people|patients?|residents?|students?|pupils?|children|workers?|animals?)\b/i.test(activeMoralQuestion) &&
    /\b(?:miss(?:es|ed|ing)?|lose|lost|lack|wait(?:s|ed|ing)?|delay(?:s|ed)?|excluded?|denied|unmet)\b/i.test(activeMoralQuestion) &&
    /\b(?:essential|effective|support|care|nutrition|food|service|help|safety)\b/i.test(activeMoralQuestion) &&
    /\b(?:growth|throughput|counts?|doub(?:le|les|led)|increas(?:e|es|ed|ing)|expand(?:s|ed|ing)?|more|faster)\b/i.test(activeMoralQuestion);
  // The ideology graph's broad "repair" tags can match a mechanical how-to.
  // Keep an ordinary personal task out unless its active text names a moral concern.
  if (lens === "moral" && /\bhow (?:do|can) I\b/i.test(activeMoralTail) &&
    !/\b(?:moral|ethic(?:al|s)?|duty|duties|harm(?:s|ed|ing)?|hurt|suffer(?:s|ing|ed)?|welfare|rights?|fair(?:ness)?|justice|wrong(?:doing)?|patient|animal|wildlife|people|person|community|society|value|care|consent)\b/i.test(activeMoralTail)) return noMatch(lens);
  if (lens === "moral" && !effectiveSupportShortfallCue && !/\b(?:moral|ethic(?:al|s)?|duty|duties|harm(?:s|ed|ing)?|damage(?:s|d)?|hurt|suffer(?:s|ing|ed)?|welfare|rights?|fair(?:ness)?|justice|wrong(?:doing)?|risks?|pain|distress|burnout|allerg(?:y|ies|ic)|personhood|consciousness|sentien(?:ce|t)|agency|consent|relocat(?:e|ion|ing)|displac(?:e|ement)|animal|wildlife|habitat|ecosystem|ecolog(?:y|ical)|organisms?|living|fish|eels?|birds?|wetland|marsh|care|patients?|clients?|medical|medications?|doses?|unsafe|unusable|severe|trade-?off|disab(?:led|ilit(?:y|ies))|wheelchair|nursing[- ]home|assisted[- ]living|dogs?|cats?|shelter)\b/i.test(activeMoralQuestion)) return noMatch(lens);
  const floodWetlandProjectCue = lens === "civilization" &&
    /\b(?:levee|flood[- ]control|flood\s*wall|embankment|dam)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:wetland|marsh|habitat|migrat(?:ion|ory)|birds?)\b/i.test(activeCivilizationQuestion);
  const fishPassageProjectCue = lens === "civilization" &&
    /\b(?:flood\s*wall|floodgate|flood gate|tide gate|levee|dam|barrier)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:fish|salmon|eels?)\b/i.test(activeCivilizationQuestion);
  const eelPassageProjectCue = fishPassageProjectCue && /\beels?\b/i.test(activeCivilizationQuestion);
  const waterUtilityOutageCue = lens === "civilization" &&
    (/\b(?:outage|blackout|power failure|grid failure|service interruption)\b/i.test(activeCivilizationQuestion) ||
      (/\b(?:solar|batter(?:y|ies)|generators?|backup power|microgrid)\b/i.test(activeCivilizationQuestion) &&
        /\b(?:days?|hours?|storms?|cyclone|hurricane|floods?|resilien(?:ce|t))\b/i.test(activeCivilizationQuestion) &&
        /\b(?:public|county|town|city|district|communit(?:y|ies)|utility)\b/i.test(activeCivilizationQuestion))) &&
    /\b(?:water|drinking water|wastewater)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:pumps?|pumping|lift stations?|utility|treatment|distribution|supply|sewer)\b/i.test(activeCivilizationQuestion);
  const publicWaterAccessCue = lens === "civilization" &&
    /\b(?:drinking[- ]?water|tap water|water)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:homes?|households?|residents?|neighbou?rhoods?|districts?|taps?|point of use|upper[- ]floor|service)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:access|availab(?:le|ility)|pressure|flow|dry|continuity|deliver(?:ed|y)|outage|supply|heat\s*wave)\b/i.test(activeCivilizationQuestion);
  const publicServiceEnergyContinuityCue = lens === "civilization" &&
    (/\b(?:solar|batter(?:y|ies)|generator|backup power|microgrid)\b/i.test(activeCivilizationQuestion) ||
      /\b(?:grid (?:failure|goes down)|power failure|blackout|outage)\b/i.test(activeCivilizationQuestion)) &&
    /\b(?:emergency|public|county|town|city|communit(?:y|ies)|health department|utility|hospital|clinic)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:radios?|alerts?|dispatch|communications?|network|coverage|refrigerat(?:or|ors|ion)|cold[- ]chain|vaccines?|clinics?|hospitals?|librar(?:y|ies)|heat refuge|cooling cent(?:er|re))\b/i.test(activeCivilizationQuestion) &&
    /\b(?:hours?|days?|overnight|outage|blackout|storms?|cyclone|hurricane|continu(?:ity|ous)|uninterrupted|resilien(?:ce|t)|failure|working|grid goes down)\b/i.test(activeCivilizationQuestion);
  const publicServiceSitingCue = lens === "civilization" &&
    /\b(?:solar|batter(?:y|ies)|generator|backup power|microgrid)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:emergency|public|county|town|city|communit(?:y|ies)|utility)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:radios?|alerts?|dispatch|communications?|network|coverage|refrigerat(?:or|ors|ion)|cold[- ]chain|vaccines?|clinics?|hospitals?)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:propos(?:e|es|ed|al)|plans?|siting|site|location|build|construct(?:ion)?)\b/i.test(activeCivilizationQuestion);
  const publicServiceEnergyCue = publicServiceEnergyContinuityCue || publicServiceSitingCue;
  const publicServiceStorageSpecified = /\b(?:solar|batter(?:y|ies)|microgrid)\b/i.test(activeCivilizationQuestion);
  const publicServiceColdChainCue = publicServiceEnergyCue &&
    /\b(?:refrigerat(?:or|ors|ion)|cold[- ]chain|vaccines?)\b/i.test(activeCivilizationQuestion);
  const publicServiceCommunicationsCue = publicServiceEnergyCue &&
    /\b(?:radios?|alerts?|dispatch|communications?|network|coverage)\b/i.test(activeCivilizationQuestion);
  const publicHeatRefugeCue = publicServiceEnergyContinuityCue &&
    /\b(?:librar(?:y|ies)|heat refuge|cooling cent(?:er|re))\b/i.test(activeCivilizationQuestion);
  const publicTransitCue = lens === "civilization" &&
    /\b(?:bus(?:es)?|transit|commut(?:e|es|ers|ing))\b/i.test(activeCivilizationQuestion) &&
    /\b(?:routes?|frequency|frequent|charging|access|depot|service)\b/i.test(activeCivilizationQuestion);
  const electricTransitCue = publicTransitCue &&
    /\b(?:battery[- ]electric|electric)[- ]+bus(?:es)?\b|\b(?:bus(?:es)?|transit)\s+charg(?:e|es|ing)\b/i.test(activeCivilizationQuestion);
  const foodSupplyCue = lens === "civilization" &&
    /\b(?:food|grocer(?:y|ies)|meals?)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:deliver(?:y|ies)|trucks?|cold storage|supply|drought|shortage|unreliable)\b/i.test(activeCivilizationQuestion);
  const floodHousingCue = lens === "civilization" &&
    /\b(?:flood|storm surge|coastal risk)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:relocat(?:e|ion|ing)|displac(?:e|ement)|move|moving|buyouts?)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:housing|homes?|residents?|renters?|people)\b/i.test(activeCivilizationQuestion);
  const irrigationWetlandCue = lens === "civilization" &&
    /\b(?:irrigat(?:ion|e|ing)|crop|food security)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:wetland|marsh|riverbank)\b/i.test(activeCivilizationQuestion);
  const clinicEnergyLineCue = lens === "civilization" &&
    /\b(?:electric(?:ity|al)?|power|transmission)\b.{0,45}\b(?:line|corridor|route)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:clinic|hospital|health center)\b/i.test(activeCivilizationQuestion);
  const coastalEvacuationCue = lens === "civilization" &&
    /\b(?:evacuat(?:ion|e|ing)|storm isolation)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:road|route|bridge)\b/i.test(activeCivilizationQuestion) &&
    /\b(?:wetland|marsh|habitat|birds?)\b/i.test(activeCivilizationQuestion);
  if (lens === "moral" && !activeMoralQuestion.trim()) return noMatch(lens);
  const wildlifeCorridorMoralCue = lens === "moral" &&
    /\b(?:wildlife|habitat|species|biodiversity|birds?|migrat(?:ion|ory))\b/i.test(activeMoralQuestion) &&
    /\b(?:energy|electric(?:ity|al)?|power|transmission)\b.{0,50}\b(?:corridor|line|route)\b|\b(?:corridor|line|route)\b.{0,50}\b(?:energy|electric(?:ity|al)?|power|transmission)\b/i.test(activeMoralQuestion);
  const moralPowerLineProcedure = wildlifeCorridorMoralCue &&
    /\b(?:(?:electric(?:ity|al)?|power|transmission)\s+(?:transmission\s+)?(?:line|corridor|route)|line\s+(?:for\s+)?(?:electricity|power))\b/i.test(activeMoralQuestion);
  const animalWelfareTradeoffCue = lens === "moral" &&
    /\b(?:animals?|wildlife|species|organisms?|dogs?|cats?|pets?|humane society|animal rescue|animal shelter)\b/i.test(activeMoralQuestion) &&
    /\b(?:suffer(?:s|ing|ed)?|distress|stress|welfare|harm(?:ed|s)?|pain|fear|anxiety|anxious|illness|injur(?:y|ies)|neglect|overcrowd(?:ing|ed)?|poor health|quality of life)\b/i.test(activeMoralQuestion) &&
    /\b(?:aggregate|ecosystem|output|productivity|benefit(?:s|ed|ing|ial)?|gain|trade-?off|good|justify|intake|headcount|admissions?|adoptions?|placements?|save rate)\b/i.test(activeMoralQuestion);
  const animalShelterCue = animalWelfareTradeoffCue &&
    /\b(?:shelter|rescue|foster|intake|admissions?|adoptions?|humane society)\b/i.test(activeMoralQuestion);
  const healthcareWelfareCue = lens === "moral" &&
    /\b(?:hospital|clinic|urgent[- ]care|healthcare|health care|medical|patients?|nursing[- ]home|care[- ]home|assisted[- ]living)\b/i.test(activeMoralQuestion) &&
    /\b(?:throughput|patients?|residents?|capacity|beds?|appointments?|wait(?:s|ing)?|delays?)\b/i.test(activeMoralQuestion) &&
    /\b(?:pain|suffer(?:s|ing|ed)?|distress|harm|welfare|severe|serious(?:ly)?|urgent|in[- ]person|effective|frail|longer)\b/i.test(activeMoralQuestion) &&
    /\b(?:throughput|doub(?:le|les|led)|increas(?:e|es|ed|ing)|expand(?:s|ed|ing)?|opens?|more|extra|higher|longer)\b/i.test(activeMoralQuestion);
  // A favorable service proxy can coexist with failure to deliver the service
  // to affected people. This is a question-level harm procedure, not a finding
  // that the service failed or that a particular moral threshold was crossed.
  const serviceProxyHarmCue = lens === "moral" &&
    /\b(?:clients?|patients?|residents?|people|famil(?:y|ies)|children|students?|pupils?|workers?|users?|riders?|passengers?|evacuees?)\b/i.test(activeMoralQuestion) &&
    /\b(?:care|treatment|medications?|doses?|food|meals?|service|access|support|transport|transit|evacuation|boarding)\b/i.test(activeMoralQuestion) &&
    /\b(?:unsafe|unusable|cannot safely|can't safely|unavailable|block(?:s|ed|ing)?|delays?|delayed|miss(?:es|ed|ing)?|harm(?:s|ed)?|pain|cannot board|can't board|unable to board|stranded|inaccessible)\b/i.test(activeMoralQuestion) &&
    /\b(?:doub(?:le|les|led)|increas(?:e|es|ed|ing)|more|count|throughput|backup|powered|online|lights?|continues?|maintain(?:ed)?|reliable|successful|benefit|uptime|adds?|available)\b/i.test(activeMoralQuestion) &&
    /\b(?:care|service|access|success(?:ful)?|enough|assess|harms?|judge|benefit|risks?|weigh)\b/i.test(activeMoralTail);
  const blockedAccessRiskCue = lens === "moral" &&
    /\b(?:clients?|patients?|residents?|people|famil(?:y|ies)|children|students?|pupils?|users?|riders?|passengers?|evacuees?)\b/i.test(activeMoralQuestion) &&
    /\b(?:care|treatment|medications?|doses?|food|service|access|support|transport|transit|evacuation|boarding)\b/i.test(activeMoralQuestion) &&
    /\b(?:block(?:s|ed|ing)?|cannot board|can't board|unable to board|excluded?|stranded|unavailable|unsafe|miss(?:es|ed|ing)?)\b/i.test(activeMoralQuestion) &&
    /\b(?:risks?|harms?|dut(?:y|ies)|weigh|assess)\b/i.test(activeMoralTail);
  const residentialCareTradeoffCue = healthcareWelfareCue &&
    /\b(?:nursing[- ]home|care[- ]home|assisted[- ]living)\b/i.test(activeMoralQuestion);
  const schoolSupportTradeoffCue = lens === "moral" &&
    /\b(?:school|pupils?|students?|children|education)\b/i.test(activeMoralQuestion) &&
    /\b(?:disab(?:led|ilit(?:y|ies))|special needs|greatest needs|high[- ]needs)\b/i.test(activeMoralQuestion) &&
    /\b(?:wait(?:s|ed|ing)?|delay(?:s|ed)?|unmet|miss(?:es|ed|ing)?)\b/i.test(activeMoralQuestion) &&
    /\b(?:support|services?|appointments?|help|learning|care)\b/i.test(activeMoralQuestion);
  const proposedHabitatSitingCue = lens === "moral" &&
    /\b(?:wildlife|habitat|species|biodiversity|wetland|marsh|migrat(?:ion|ory)|birds?|nesting|trees?|fish|eels?)\b/i.test(activeMoralQuestion) &&
    /\b(?:propos(?:e|es|ed|al)|would|plans?|siting|site|build|construct(?:ion)?)\b/i.test(activeMoralQuestion) &&
    /\b(?:through|across|within|beside|near|on|replace|remove|destroy|cross)\b/i.test(activeMoralQuestion) &&
    /\b(?:what|how|should|before|decid(?:e|ing|sion)|approv(?:e|al)|compare|weigh)\b/i.test(activeMoralQuestion);
  const ecologicalProjectHarmCue = (lens === "moral" &&
    /\b(?:wildlife|habitat|species|biodiversity|wetland|marsh|migrat(?:ion|ory)|birds?|nesting|trees?|fish|eels?)\b/i.test(activeMoralQuestion) &&
    /\b(?:harm(?:s|ed|ing)?|disrupt(?:s|ed|ing|ion)?|damage(?:s|d)?|destroy(?:s|ed|ing)?|loss|remov(?:e|es|ed|ing)|replac(?:e|es|ed|ing)|interrupt(?:s|ed|ing|ion)?|block(?:s|ed|ing)?|clos(?:e|es|ed|ing)|cut\s+off|imped(?:e|es|ed|ing)|obstruct(?:s|ed|ing)?|prevent(?:s|ed|ing)?)\b/i.test(activeMoralQuestion) &&
    /\b(?:benefit(?:s|ed|ing|ial)?|protect(?:s|ed|ing|ion)?|project|levee|flood\s*wall|floodgate|flood gate|dam|barrier|flooding|infrastructure|trade-?off|road|route|evacuation|improv(?:e|es|ed|ing)|reduc(?:e|es|ed|ing)|shorten|commutes?|bus(?:es)?|depot|batter(?:y|ies)|power|emergency|irrigat(?:ion|e|ing)|station|food|water|solar)\b/i.test(activeMoralQuestion)) || proposedHabitatSitingCue;
  const generalHumanHarmTradeoffCue = effectiveSupportShortfallCue || serviceProxyHarmCue || blockedAccessRiskCue || lens === "moral" &&
    /\b(?:workers?|employees?|pupils?|students?|children|patients?|residents?|people)\b/i.test(activeMoralQuestion) &&
    /\b(?:severe|burnout|allerg(?:y|ies|ic)|pain|suffer(?:s|ing|ed)?|harm|injur(?:y|ies)|distress|longer waits?|wait longer|unsafe|welfare|lost sleep|sleep loss|near misses|fatigue)\b/i.test(activeMoralQuestion) &&
    /\b(?:more|increas(?:e|es|ed|ing)|expand(?:s|ed|ing)?|output|capacity|throughput|benefit|faster|sooner)\b/i.test(activeMoralQuestion);
  const workerBurnoutCue = generalHumanHarmTradeoffCue &&
    /\b(?:workers?|employees?|factory|workplace)\b/i.test(activeMoralQuestion) && /\bburnout\b/i.test(activeMoralQuestion);
  const workerFatigueCue = generalHumanHarmTradeoffCue &&
    /\b(?:workers?|employees?|warehouse|shifts?)\b/i.test(activeMoralQuestion) &&
    /\b(?:sleep deprivation|lost sleep|sleep loss|fatigue|exhaustion|longer shifts?|unsafe commutes?|near misses)\b/i.test(activeMoralQuestion);
  const schoolFoodAllergyCue = generalHumanHarmTradeoffCue &&
    /\b(?:school|pupils?|students?|children)\b/i.test(activeMoralQuestion) && /\ballerg(?:y|ies|ic)\b/i.test(activeMoralQuestion);
  const relocationConsentCue = lens === "moral" &&
    /\b(?:relocat(?:e|ion|ing)|displac(?:e|ement))\b/i.test(activeMoralQuestion) &&
    /\b(?:residents?|people|housing|homes?)\b/i.test(activeMoralQuestion) &&
    /\b(?:flood|plan|project|consent|evidence)\b/i.test(activeMoralQuestion);
  const aiPersonhoodCue = lens === "moral" &&
    /\b(?:AI|artificial intelligence|model|system|chatbot|robot)\b/i.test(activeMoralQuestion) &&
    /\b(?:pain|feel(?:s|ing)?|suffer(?:s|ing|ed)?|consciousness|sentien(?:ce|t)|personhood|moral status|welfare interests?|distress)\b/i.test(activeMoralQuestion);
  const moralFishPassageCue = ecologicalProjectHarmCue &&
    /\b(?:flood\s*wall|floodgate|flood gate|tide gate|levee|dam|barrier)\b/i.test(activeMoralQuestion) &&
    /\b(?:fish|salmon|eels?)\b/i.test(activeMoralQuestion);
  const moralEelPassageCue = moralFishPassageCue && /\beels?\b/i.test(activeMoralQuestion);
  const asksAboutAgency = /\b(?:agency|agent|consciousness|conscious|sentien(?:ce|t)|personhood|subjective experience)\b/i.test(activeMoralQuestion);
  const catalog = await loadPublicBadgeCatalog();
  // An atomic-only card can share generic spectral words with a molecular
  // question. Keep the target entity compatible before any strict, likely,
  // candidate, or relation-path projection is admitted.
  const scopedBadges = catalog[lens].filter((badge) =>
    !molecularLineQuestion || !/(?:^|[._-])atomic(?:[._-]|$)/i.test(badge.id));
  const relationPreview = (ids: readonly string[]): {
    relation_path_leads: PublicRelationPathLead[];
    convergent_relation_leads: PublicConvergentRelationLead[];
  } | object =>
    lens === "theory" && process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS === "1"
      ? { relation_path_leads: findPublicRelationPathLeads(ids, scopedBadges),
          convergent_relation_leads: findPublicConvergentRelationLeads(ids, scopedBadges) }
      : {};
  const allowed = new Map(scopedBadges.map((badge) => [badge.id, badge]));
  const bridgeIds = findPublicQuestionAnchoredCandidates(
    scopedBadges, activePublicRequest(question), candidateBridges);
  const lexicalQuestionOnlyIds = lens === "theory" && !candidatePrinciples.length && !candidateBridges.length
    ? findPublicQuestionOnlyCandidates(scopedBadges, activeTheoryRequest(question)) : [];
  const graphPathIds = lens === "theory" && !lexicalQuestionOnlyIds.length &&
    !candidatePrinciples.length && !candidateBridges.length &&
    process.env.CASIMIR_PUBLIC_CONTEXT_EXPERIMENTAL_RELATIONS === "1"
      ? findPublicGraphAnchoredCandidates(activeTheoryRequest(question), scopedBadges) : [];
  const questionOnlyIds = lexicalQuestionOnlyIds.length ? lexicalQuestionOnlyIds : graphPathIds;
  const proposedHypothesisIds = findPublicPrincipleHypotheses(scopedBadges, activePublicRequest(question), candidatePrinciples,
    candidatePrinciples.length ? (await loadPublicBadgeSearchText())[lens] : undefined,
    { allowRareTitleAnchor: lens === "moral" });
  const theoryTitleFrequency = new Map<string, number>();
  const theorySummaryFrequency = new Map<string, number>();
  if (lens === "theory") {
    for (const badge of catalog.theory) {
      for (const term of publicContextTerms(badge.title)) {
        theoryTitleFrequency.set(term, (theoryTitleFrequency.get(term) ?? 0) + 1);
      }
      for (const term of publicContextTerms(badge.summary)) {
        theorySummaryFrequency.set(term, (theorySummaryFrequency.get(term) ?? 0) + 1);
      }
    }
  }
  // A host hint can overlap private metadata through generic words such as
  // "loss" or "current". For Theory, require the hint to anchor in a
  // distinctive public title or two public summary concepts before promoting
  // it to a strict card. The active question still has to pass the catalog
  // locator's overlap test.
  const hypothesisIds = lens === "theory"
    ? proposedHypothesisIds.filter((id) => {
      const badge = allowed.get(id);
      if (!badge) return false;
      if (activeTheoryRequest(question).includes(id)) return true;
      const title = publicContextTerms(badge.title);
      const hintTerms = new Set(candidatePrinciples.flatMap((hint) => [...publicContextTerms(hint)]));
      const rareTitleAnchors = [...hintTerms].filter((term) =>
        title.has(term) && (theoryTitleFrequency.get(term) ?? catalog.theory.length) <=
          Math.max(3, Math.floor(catalog.theory.length * 0.025)));
      if (rareTitleAnchors.some((term) => !NON_DISCRIMINATING_THEORY_TERMS.has(term))) return true;
      const summary = publicContextTerms(badge.summary);
      const activeSummaryAnchors = [...publicContextTerms(activeTheoryRequest(question))].filter((term) =>
        summary.has(term) && !NON_DISCRIMINATING_THEORY_TERMS.has(term));
      const activeSummaryAnchor = activeSummaryAnchors.length > 0;
      if (rareTitleAnchors.length && activeSummaryAnchor && [...hintTerms].some((term) => summary.has(term))) return true;
      const distinctSummaryAnchors = [...hintTerms].filter((term) => term.length >= 5 && summary.has(term) &&
        (theorySummaryFrequency.get(term) ?? catalog.theory.length) <=
          Math.max(3, Math.floor(catalog.theory.length * 0.05)));
      // Two words from a host hint can occur in an unrelated badge while the
      // active question shares only a generic word such as "emission". Without
      // a rare title anchor, require three distinct public-summary terms in
      // the proposal and at least one in the active question before promotion.
      return distinctSummaryAnchors.length >= 3 && activeSummaryAnchor;
    }) : proposedHypothesisIds;
  let summary = "";
  let exact: string[] = [];
  let likely: string[] = [];
  let missing: string[] = [];
  let uncertainty: string[] = [];
  let boundaries: string[] = [];
  if (lens === "civilization") {
    const ecologicalCue = /\b(?:wildlife|habitat|species|biodiversity|migration|migratory|ecolog(?:y|ical)|ecosystem|wetland|marsh|birds?|nesting|fish|eels?)\b/i.test(activeCivilizationQuestion);
    const essentialServiceOutageCue = /\b(?:outage|blackout|power failure|grid failure|service interruption)\b/i.test(activeCivilizationQuestion) &&
      /\b(?:grocery|food|cold storage|refrigeration|hospital|clinic|water|wastewater|sewer|essential service|public service)\b/i.test(activeCivilizationQuestion);
    const casimirEnergyProject = asksAboutCasimirCavityEnergyProject(activeCivilizationQuestion);
    const energyCorridorCue = /\b(?:energy|electric(?:ity|al)?|power|transmission)\b.{0,50}\b(?:corridor|line|route)\b|\b(?:corridor|line|route)\b.{0,50}\b(?:energy|electric(?:ity|al)?|power|transmission)\b/i.test(activeCivilizationQuestion);
    const livingProjectBenefitCue = /\b(?:societ(?:y|al)|public|communit(?:y|ies))\b/i.test(activeCivilizationQuestion) &&
      /\b(?:benefit|improve|project|technology)\b/i.test(activeCivilizationQuestion) &&
      /\b(?:living organisms?|wildlife|habitat|ecosystem|biological)\b/i.test(activeCivilizationQuestion);
    const frame = await runHelixAskCivilizationScenarioFrameTool({ prompt: question });
    const roadmap = await runHelixAskCivilizationBoundsTool({
      prompt: question, scenarioFrame: frame.frame,
      options: { includeBridgeContext: true, includeCollaborationBounds: true, includeFalsificationHooks: true },
    });
    const frameFamily = frame.frame.family === "planetary_trade" &&
      !/\b(?:trade|supply chain|supplier|import|export|market|treaty|sanction|transport corridor)\b/i.test(activeCivilizationQuestion)
      ? "collective capacity" : frame.frame.family.replace(/_/g, " ");
    summary = publicTransitCue
      ? "Transit access assessment: measure passenger service by route and rider group. Cleaner vehicles, lower costs, or aggregate gains are separate benefits; they do not establish that service improved when trips or access declined."
      : casimirEnergyProject
      ? "Casimir cavity energy project: no project-specific evidence here establishes a societal benefit. Test net output, affected people and organisms, and governance. A different application is not evidence that this energy project works."
      : `Question-specific ${frameFamily} frame; constraints are hypotheses pending evidence.`;
    const profiles = frame.frame.constraintProfiles.join(" ");
    exact = [
      ...(ecologicalCue ? ["ecological_boundary"] : []),
      ...(waterUtilityOutageCue || publicServiceEnergyCue || clinicEnergyLineCue ? ["energy_capacity"] : []),
      ...(publicTransitCue ? ["transport_latency", "energy_capacity"] : []),
      ...(foodSupplyCue ? ["material_base", "transport_latency"] : []),
      ...(floodHousingCue ? ["governance"] : []),
      ...(profiles.includes("material") ? ["material_base"] : []),
      ...(profiles.includes("energy") ? ["energy_capacity"] : []),
      ...(profiles.includes("transport") ? ["transport_latency"] : []),
      ...(profiles.includes("governance") || profiles.includes("consent") ? ["governance"] : []),
    ];
    likely = ["collaboration", "falsification"].filter((id) => !exact.includes(id));
    missing = bounded([
      ...(floodWetlandProjectCue ? [
        "Quantify flood depths and likelihood with and without the project, overtopping and failure modes, residual risk, and whether risk shifts to other residents.",
        "Measure wetland hydrology and functions, seasonal bird movement, and whether feasible lower-impact alternatives preserve both flood protection and habitat.",
        "Identify the applicable jurisdiction, permitting and consultation bodies, affected residents, and final decision authority before claiming net benefit.",
      ] : []),
      ...(coastalEvacuationCue ? [
        "Measure evacuation access under realistic storm conditions, bottlenecks, road failure, and residual isolation for affected residents; compare feasible routes and non-road options.",
        "Measure marsh hydrology and seasonal nesting harm, including construction and maintenance effects, before claiming a net safety gain.",
        "Identify the relevant jurisdiction, affected residents, permit and consultation bodies, and final decision authority.",
      ] : []),
      ...(essentialServiceOutageCue ? [
        "Measure the critical service load, peak demand, outage duration, backup energy or fuel, and resupply under realistic failure conditions.",
        "Measure service performance and safe operating limits throughout the outage, including monitoring, staffing, access, and recovery after failures.",
        "Identify who depends on the service, feasible alternatives, and a predeclared stress-test threshold before calling the plan resilient.",
      ] : []),
      ...(waterUtilityOutageCue ? ["Measure pump and treatment loads, backup power and fuel, pressure and water-quality limits, distribution reach, and safe recovery for the outage duration; EPA guidance does not establish this utility's runtime."] : []),
      ...(publicServiceEnergyContinuityCue ? [
        "Measure critical and peak loads, the proposed backup source's usable energy or fuel, and an hourly balance for the stated outage duration with reserve and failure cases.",
        ...(publicServiceColdChainCue ? ["Measure product-specific vaccine storage temperatures, monitoring, backup refrigeration, transport, and recovery throughout the outage."] : []),
        ...(publicServiceCommunicationsCue ? ["Test end-to-end communications coverage for each served community, including vulnerable groups, tower and backhaul dependencies, staffing, repair, and fallback communications."] : []),
        "Publish minimum service thresholds and recovery triggers; general guidance cannot verify this service's outage performance.",
      ] : []),
      ...(publicServiceSitingCue && !publicServiceEnergyContinuityCue ? [
        "Define the emergency service and its target duration, then estimate peak load, usable battery energy, charging supply, communications coverage, and fallback before choosing a site.",
        "Compare feasible sites and power options alongside the ecological footprint and who receives the proposed service.",
      ] : []),
      ...(publicHeatRefugeCue ? ["Verify occupied safe-temperature hours, accessible capacity, generator fuel and resupply, ventilation, staffing, and a safe fallback for residents if the refuge loses power."] : []),
      ...(publicTransitCue ? [electricTransitCue
        ? "Compare actual route frequency, travel and wait times, charging availability, and service loss by neighborhood and rider group before claiming access improved."
        : "Compare actual route frequency, travel and wait times, physical accessibility, and service loss by neighborhood and rider group before claiming access improved."] : []),
      ...(foodSupplyCue ? ["Measure days of usable food inventory, cold-chain limits, delivery-route reliability, alternate suppliers, and who loses access first under drought or outage conditions."] : []),
      ...(floodHousingCue ? ["Compare measured flood-risk reduction with displacement, housing affordability, feasible in-place alternatives, resident participation, and the authority for any relocation decision."] : []),
      ...(irrigationWetlandCue ? ["Measure crop-water demand, source and seasonal flow limits, pump-energy balance, wetland functions, nesting activity, and lower-impact sites before claiming food-security benefits outweigh ecological costs."] : []),
      ...(clinicEnergyLineCue ? ["Compare the clinic's measured critical load and reliability need with feasible routes, local storage, backup power, and other supply options; measure bird movement and collision risk for each route."] : []),
      ...(fishPassageProjectCue ? ["Measure flood protection and shifted risk alongside seasonal aquatic migration, feasible barrier operations or alternatives, and the jurisdiction and authority for the final decision."] : []),
      ...(ecologicalCue ? ["Identify affected species, seasonal movement, habitat connectivity, and construction/maintenance footprint before claiming a net benefit."] : []),
      ...(ecologicalCue && energyCorridorCue ? ["Identify the corridor type and compare feasible routes, existing infrastructure, and non-line alternatives before applying electric-transmission evidence."] : []),
      ...(ecologicalCue && energyCorridorCue ? ["Name communities and land users who gain energy or bear habitat costs; define measured reliability/access and species-movement or mortality results that would disconfirm the proposed benefit or mitigation."] : []),
      ...(livingProjectBenefitCue ? ["Measure the project's full-cycle output and material needs, identify affected workers and communities, and define independent review and stop criteria before projecting social benefit or biological safety."] : []),
      ...(casimirEnergyProject ? ["Evaluate any alternative application as a separate project with its own benefit and risk evidence; do not substitute it for the energy project in this question."] : []),
      ...frame.missingEvidence, ...roadmap.missingEvidenceBoundaries,
    ]);
    uncertainty = [`Scenario evidence mode: ${frame.frame.evidenceMode}; unmeasured capacities remain unknown.`];
    boundaries = bounded([
      ...(casimirEnergyProject ? ["A measured Casimir force, static cavity energy, or possible application does not establish net useful power or a benefit of this project."] : []),
      ...(ecologicalCue && energyCorridorCue ? ["Electric-line impact and alternatives guidance is conditional until the corridor type and route are known."] : []),
      ...(floodWetlandProjectCue ? ["General levee-risk and wetland-function sources do not establish this project's performance, permit outcome, or net benefit."] : []),
      ...(coastalEvacuationCue ? ["General wetland and connectivity sources do not establish this road's storm performance, ecological effects, permit outcome, or net benefit."] : []),
      ...(waterUtilityOutageCue ? ["EPA power-resilience guidance concerns planning for water utilities; it does not verify this utility's outage-duration capacity, water quality, or service coverage."] : []),
      ...(publicServiceEnergyContinuityCue ? ["General backup-power guidance does not verify local endurance or service coverage; CDC cold-chain and CISA communications guidance does not establish this system's performance."] : []),
      ...(publicServiceSitingCue && !publicServiceEnergyContinuityCue ? ["DOE storage and CISA communications planning references identify measurements; they do not verify a proposed site's service or justify its ecological impact."] : []),
      ...(publicTransitCue ? [electricTransitCue
        ? "General electric-bus and transit equity guidance does not establish this network's charging uptime, frequency, or distribution of access."
        : "General transit service guidance does not establish this network's accessibility, frequency, or distribution of access."] : []),
      ...(publicTransitCue ? ["Do not label passenger service improved merely because emissions, fleet costs, or system-wide averages improve while a rider group's trip availability worsens."] : []),
      ...(foodSupplyCue ? ["National food-supply assessments do not establish this town's inventory, transport capacity, or household access during a drought."] : []),
      ...(floodHousingCue ? ["Flood-mitigation and relocation guidance does not authorize displacement or prove that this housing project reduces risk for each affected resident."] : []),
      ...(irrigationWetlandCue ? ["National irrigation-water and wetland references do not quantify this project's water yield, food benefit, or habitat loss."] : []),
      ...(fishPassageProjectCue ? ["NOAA's general fish-passage information does not establish this gate's effects, flood reliability, or approval outcome."] : []),
      "The scenario frame identifies questions to investigate; it does not establish capacity, resilience, consent, or a net social benefit.",
    ]);
  } else if (lens === "theory") {
    const theoryQuestion = activeTheoryRequest(question);
    if (/\bprotons?\b/i.test(theoryQuestion) && /\b(?:nucleus|nuclei|nuclear)\b/i.test(theoryQuestion) &&
      /\b(?:pauli|exclusion principle)\b/i.test(theoryQuestion)) return noMatch(lens);
    const hasTheoryScopeCue = /\b(?:fermions?|bosons?|bosonic|pauli|electrons?|photons?|orbitals?|quantum|nuclear|recoils?|elastic|particles?|dark[- ]matter|casimir|cavit(?:y|ies)|vacuum|spacetime|gravit(?:y|ational)|fields?|waves?|phase|superconduct(?:or|ing|ivity)|spin|propulsion|spectroscop(?:y|ic)|spectr(?:a|al|um)|nebulae?)\b|\b(?:emission|absorption)\s+lines?\b/i.test(theoryQuestion);
    if (!hypothesisIds.length && !hasTheoryScopeCue) {
      if (!questionOnlyIds.length) return noMatch(lens);
      const empty = noMatch(lens);
      return { ...empty,
        ...relationPreview(questionOnlyIds),
        candidate_cards: questionOnlyIds.map((id) => {
          const badge = allowed.get(id) as PublicBadge;
          return { id, title: badge.title, concept: badge.summary,
            url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath(lens, id)}`,
            needs_verification: true as const,
            ...(graphPathIds.includes(id) ? { retrieval_basis: "graph_path" as const } : {}),
            catalog_source_pointers: applicablePublicRefs(badge.source_refs.filter((ref) => /^https:\/\//.test(ref))).slice(0, 2),
            claim_boundaries: badge.claim_boundaries.slice(0, 2) };
        }),
        uncertainty: bounded([...empty.uncertainty,
          graphPathIds.length
            ? "A public-text anchor and graph path supply tentative search leads, not a verified mechanism or evidence. Graph relations and catalog source pointers are unchecked for this question; inspect them before use."
            : "Question-only catalog overlap supplies tentative search leads, not a verified mechanism or evidence. Catalog source pointers are unchecked for this question; open each source and check whether its claim applies before citing."]),
      };
    }
    const reflection = runAskLevelTheoryContextReflectionTool({
      prompt: theoryQuestion, turnId: "public-context", limit: 12,
      buildExplanationPlan: false, syncPanel: false, openPanel: false,
    }).reflectionV1;
    exact = reflection.exactMatches.map((match) => match.badgeId);
    likely = reflection.likelyMatches
      .filter((match) => match.score >= MIN_PUBLIC_THEORY_MATCH_SCORE)
      .map((match) => match.badgeId);
    const staticCasimirPower = asksAboutCasimirCavityEnergyProject(theoryQuestion) && allowed.has(CASIMIR_STATIC_ENERGY_BADGE_ID);
    if (staticCasimirPower) {
      // For an energy-project question, lead with the sourced static-energy
      // limitation instead of unsourced mode and per-tile calculation cards.
      exact = [];
      likely = [CASIMIR_STATIC_ENERGY_BADGE_ID];
    }
    const pauliOccupancy = asksAboutPauliOccupancy(theoryQuestion) && allowed.has(PAULI_BADGE_ID);
    if (pauliOccupancy) {
      exact = [];
      likely = staticCasimirPower ? [CASIMIR_STATIC_ENERGY_BADGE_ID, PAULI_BADGE_ID] : [PAULI_BADGE_ID];
    }
    const bosonRecoilBenchmark = asksAboutBosonRecoilBenchmark(theoryQuestion) && allowed.has(BOSONIC_COMPATIBILITY_BADGE_ID);
    if (bosonRecoilBenchmark && !exact.includes(BOSONIC_COMPATIBILITY_BADGE_ID) && !likely.includes(BOSONIC_COMPATIBILITY_BADGE_ID)) {
      likely.unshift(BOSONIC_COMPATIBILITY_BADGE_ID);
    }
    const elasticNuclearRecoil = !bosonRecoilBenchmark && asksAboutElasticNuclearRecoil(theoryQuestion) &&
      allowed.has(PUBLIC_ELASTIC_RECOIL_BADGE_ID);
    if (elasticNuclearRecoil) {
      // A target-specific elastic question should not inherit unrelated
      // multichannel boson benchmarks or their source references.
      exact = [];
      likely = [PUBLIC_ELASTIC_RECOIL_BADGE_ID];
    }
    const titles = [...exact, ...likely].slice(0, 3)
      .map((id) => allowed.get(id)?.title).filter(Boolean);
    summary = titles.length
      ? `Theory Badge Graph candidates: ${titles.join(", ")}. These locate discussion context, not validation.`
      : "No sufficiently specific public Theory Badge Graph match was found for this question.";
    missing = ["Independent observation and claim-specific validation are required before treating a theory badge as proof."];
    uncertainty = [`Locator mode: ${reflection.overlay.uncertainty?.uncertaintyMode ?? "unspecified"}; low-specificity matches are omitted from this public reflection.`];
    if (pauliOccupancy) {
      missing.push("Specify whether 'same space' means overlapping spatial distributions, a shared spatial orbital, or the same complete quantum state.");
      uncertainty.push("The matched Pauli badge is conceptual; the particles' states and interactions in a particular system remain unspecified.");
      if (/\b(?:metal|foil|material|medium)\b/i.test(theoryQuestion))
        missing.push("Assess the material and light frequency separately; Pauli exclusion alone does not determine absorption, scattering, or transmission.");
    }
    if (elasticNuclearRecoil) {
      missing.push("Specify the incident mass and speed, target nuclear mass, observed recoil energy, and whether the claimed channel is ordinary two-body elastic scattering.");
      missing.push("For a numerical example, state the speed assumption, convert target mass units, and invert reduced mass before quoting an incident-particle mass threshold.");
      uncertainty.push("This kinematic bound alone does not identify a signal, detector background, cross section, or alternative interaction model.");
    }
    boundaries = bounded([
      "A Theory Badge Graph match or absence of one cannot establish or refute a physical claim.",
      ...(elasticNuclearRecoil ? ["If ordinary two-body elastic scattering is the proposed channel, compare the claimed nuclear recoil with the target-specific elastic endpoint; do not import a xenon or other-target numeric bound or treat this check as a verdict on other channels."] : []),
      ...(pauliOccupancy ? ["Spatial overlap is not occupancy of the same complete quantum state; Pauli exclusion applies to identical fermions."] : []),
      ...(pauliOccupancy && /\b(?:metal|foil|material|medium)\b/i.test(theoryQuestion)
        ? ["The Pauli distinction does not establish that light passes through a particular material."] : []),
      ...(bosonRecoilBenchmark ? [
        "The Sgr A* boson-star benchmark is an illustrative model, not an observation that Sgr A* is a boson star.",
        "The LZ 248-keV recoil-like event is not a dark-matter discovery; the ordinary elastic bound does not assess other interaction models.",
      ] : []),
      // A focused public card must not inherit limitations for internal
      // candidates that were deliberately omitted from this reflection.
      ...(pauliOccupancy || elasticNuclearRecoil ? [] : reflection.evidenceForAsk.claimBoundaries),
    ]);
  } else {
    const graph = await loadIdeologyGraphFromFile();
    const reflection = reflectIdeologyContext(graph, { kind: "user_prompt", text: activeMoralQuestion });
    const substrate = reflectLivingSubstrateContext({ prompt: activeMoralQuestion, includeRecommendedActions: false, limit: 6 });
    summary = wildlifeCorridorMoralCue
      ? "Wildlife-corridor moral context: measure benefits, individual and habitat harms, and alternatives; distinguish those observations from chosen value weights. This lens supplies no universal approval threshold."
      : healthcareWelfareCue
      ? "Healthcare welfare tradeoff: measure appointment access separately from severity and duration of delayed effective care; compare alternatives and have accountable decision makers state the value rule. This lens supplies no clinical or moral verdict."
      : schoolSupportTradeoffCue
      ? "School-support tradeoff: distinguish appointment counts from timely, effective help for pupils with the greatest needs. Measure unmet support and involve affected families and accountable reviewers before calling expansion successful. This lens supplies no school-specific verdict."
      : animalWelfareTradeoffCue
      ? "Animal-welfare tradeoff context: report throughput and each affected animal's welfare separately, then have accountable decision makers state and review the value rule for weighing gains against concentrated harm. Even causally linked distress alone does not determine the whole program's success or failure."
      : ecologicalProjectHarmCue
      ? "Ecological-harm tradeoff context: separate measured human benefits and habitat harms from chosen value weights, alternatives, and decision authority. FWS mitigation guidance is authority-bounded; no universal approval or no-net-loss duty follows."
      : generalHumanHarmTradeoffCue
      ? "Human-harm tradeoff context: measure the distribution and severity of benefit and harm separately, compare feasible safeguards, and ask accountable reviewers to state the value rule. This lens supplies no verdict."
      : relocationConsentCue
      ? "Relocation context: assess flood benefits, displaced residents' circumstances, alternatives, participation, and decision authority separately. This lens supplies no consent or approval."
      : aiPersonhoodCue
      ? "AI self-report is an observation, not a determination of consciousness, pain, personhood, or moral status. Examine independently assessed indicators and keep unresolved moral questions explicit."
      : "Moral Graph lenses are diagnostic context for the host's reasoning.";
    // A generic "society" tag alone locates Citizen's Arc on almost every
    // social question, even when its stewardship concept is unrelated.
    exact = reflection.matches.exact
      .filter((match) => !(match.nodeId === "citizens-arc" &&
        match.reasons.every((reason) => reason === "tag match: society")))
      .map((match) => match.nodeId);
    likely = [...reflection.matches.likely, ...reflection.matches.inferred_lenses].map((match) => match.nodeId);
    exact.push(...substrate.exactMatches.map((match) => `substrate.${match.badgeId}`));
    likely.push(...substrate.likelyMatches.map((match) => `substrate.${match.badgeId}`));
    // Generic "output" is insufficient to admit an actuation/agency card on a
    // welfare question. Keep that card when agency is the user's actual topic.
    if (!asksAboutAgency) {
      exact = exact.filter((id) => id !== "substrate.actuation-before-agency");
      likely = likely.filter((id) => id !== "substrate.actuation-before-agency");
    }
    if (!/\b(?:living|organisms?|animals?|wildlife|species|ecosystem|ecolog(?:y|ical)|biolog(?:y|ical)|cells?|welfare|suffering|consciousness|substrate|human)\b/i.test(activeMoralQuestion)) {
      exact = exact.filter((id) => id !== "substrate.scale-continuity-from-cell-to-society");
      likely = likely.filter((id) => id !== "substrate.scale-continuity-from-cell-to-society");
    }
    if (aiPersonhoodCue && allowed.has("substrate.actuation-before-agency")) {
      exact = [];
      likely = ["substrate.actuation-before-agency"];
    }
    if ((wildlifeCorridorMoralCue || ecologicalProjectHarmCue || healthcareWelfareCue || schoolSupportTradeoffCue || generalHumanHarmTradeoffCue || relocationConsentCue) && !exact.includes("harm-weighted-priority-standard") &&
      !likely.includes("harm-weighted-priority-standard")) likely.unshift("harm-weighted-priority-standard");
    if (animalWelfareTradeoffCue && !exact.includes("harm-weighted-priority-standard") &&
      !likely.includes("harm-weighted-priority-standard")) likely.unshift("harm-weighted-priority-standard");
    if ((animalShelterCue || healthcareWelfareCue || schoolSupportTradeoffCue || generalHumanHarmTradeoffCue || ecologicalProjectHarmCue || relocationConsentCue) && !asksAboutAgency && allowed.has("harm-weighted-priority-standard")) {
      // A specific shelter tradeoff should not advertise broad ideological or
      // living-substrate cards as additional evidence for the host's answer.
      exact = [];
      likely = ["harm-weighted-priority-standard"];
    }
    missing = bounded((reflection.claim_boundaries.missing_evidence ?? []).map((code) =>
      code === "input_refs"
        ? "Identify independent source references for the project's claimed benefits, affected parties, and harms."
        : code === "deterministic_ideology_lens_match"
          ? "Identify a relevant Moral Graph lens before applying its claims to this question."
          : code));
    if (wildlifeCorridorMoralCue) {
      missing = bounded([
        "Identify the corridor type, jurisdiction, affected species, measurable benefit, feasible alternatives, and residual harm before weighing the tradeoff.",
        "Identify affected communities and species, irreversible harm, funded repair, and conditions for rerouting or stopping if monitoring disproves the promised benefit or mitigation.",
        ...missing,
      ]);
    }
    if (animalWelfareTradeoffCue) {
      missing = bounded([
        "Measure which animals suffer, severity and duration, the project's causal contribution, and how aggregate output and individual welfare were measured.",
        "Compare affected groups, less harmful alternatives, mitigation, and who can review or stop the project before weighing benefits against harms.",
        ...(animalShelterCue ? ["Check post-admission health, behavior, placement, and longer-term welfare against actual staff, space, and care capacity; name who sets and reviews unacceptable-harm thresholds."] : []),
        ...missing,
      ]);
    }
    if (ecologicalProjectHarmCue && !animalWelfareTradeoffCue) {
      missing = bounded([
        ...(proposedHabitatSitingCue ? ["Verify the proposed footprint, affected species and habitat functions, and whether any harm would occur before treating site overlap as measured impact."] : []),
        "Measure the distribution and severity of harm to affected species and people, alternatives, and residual risk before weighing a claimed aggregate benefit.",
        "State who has decision authority, which value rule weighs remaining harms, and what monitoring or review could reverse the decision.",
        ...missing,
      ]);
    }
    if (residentialCareTradeoffCue) missing = bounded([
      "Measure residents' acuity, assistance needs, wait time to effective help, falls or other harms, staffing coverage, and whether added beds caused delays.",
      "Compare admission gains with feasible staffing, triage, safeguards, and alternatives; include residents and accountable care reviewers when setting thresholds.",
      ...missing,
    ]);
    else if (healthcareWelfareCue) missing = bounded([
      "Measure the number of patients served, need-weighted time to effective care, delay length, symptom and pain severity, clinical outcomes, and distribution across patient groups rather than treating appointment count as welfare.",
      "Check whether the expansion caused longer waits, including staffing and referral capacity; compare triage, scheduling, safeguards, and feasible alternatives. Name affected patients and who sets and reviews unacceptable-harm thresholds and clinical duties.",
      ...missing,
    ]);
    if (schoolSupportTradeoffCue) missing = bounded([
      "Measure wait duration and severity by pupil need, time to effective support, unmet learning or care needs, and whether the expansion caused the longer waits.",
      "Check staffing, capacity, feasible alternatives, and safeguards; identify who sets and reviews the acceptable-harm threshold with affected pupils and families.",
      ...missing,
    ]);
    if (generalHumanHarmTradeoffCue && !healthcareWelfareCue && !schoolSupportTradeoffCue) missing = bounded([
      "Measure who gains, who is harmed, the severity and duration of harm, and whether the proposed expansion caused it; compare safeguards and less harmful alternatives.",
      "Ask affected people and accountable reviewers to state and revisit the value rule and unacceptable-harm threshold before calling aggregate growth progress.",
      ...(workerBurnoutCue ? ["Distinguish measured work conditions and worker reports from a diagnosis or an assumed cause of burnout."] : []),
      ...(workerFatigueCue ? ["Measure shift length, sleep, fatigue reports, incidents, commute risk, and recovery time; check whether the schedule change caused the observed harms."] : []),
      ...(schoolFoodAllergyCue ? ["Check timely access to safe meals, allergy-response plans, and whether the expansion lengthened waits for children with severe allergies."] : []),
      ...missing,
    ]);
    if (relocationConsentCue) missing = bounded([
      "Identify residents affected by displacement, measured flood benefit and remaining risk, feasible in-place alternatives, housing impacts, participation, consent requirements, and decision authority.",
      ...missing,
    ]);
    if (aiPersonhoodCue) missing = bounded([
      "Identify the system, how the self-report was elicited, independently testable indicators, limitations of each consciousness theory, and the separate normative basis for moral status.",
      ...missing,
    ]);
    if (moralFishPassageCue) missing = bounded([
      "Measure affected fish movement and populations, seasonal gate operations, alternatives, residual harm, and who has authority to weigh the tradeoff.",
      ...missing,
    ]);
    if (exact.length || likely.length) {
      missing = missing.filter((item) => item !== "Identify a relevant Moral Graph lens before applying its claims to this question.");
    }
    uncertainty = ["Moral matches are interpretive lenses; affected parties, values, and evidence require independent review."];
    if (proposedHabitatSitingCue) uncertainty.push("A proposed site near habitat does not establish that an impact occurred or quantify its severity.");
    if (animalWelfareTradeoffCue) uncertainty.push("How benefits and harms should be weighted is a value judgment; aggregate output cannot measure individual welfare by itself.");
    const retainedSubstrateMatch = [...exact, ...likely].some((id) => id.startsWith("substrate."));
    boundaries = bounded([
      "This reflection does not judge character, consciousness, personhood, or final moral status.",
      ...(animalWelfareTradeoffCue ? ["A harm-priority lens supplies no universal threshold for approving or rejecting this project; separate welfare observations from normative judgments."] : []),
      ...(animalShelterCue ? ["Shelter-care guidelines inform welfare and capacity assessment, not the moral weight assigned to each animal or a universal admission rule."] : []),
      ...(animalShelterCue ? ["Observed distress, including distress caused by this program, is not by itself an overall success-or-failure verdict. Trustees must specify and review the value rule, severity threshold, alternatives, and who has decision authority."] : []),
      ...(ecologicalProjectHarmCue ? ["A harm-priority lens does not set an approval threshold or substitute for jurisdiction-specific review and affected-party participation."] : []),
      ...(ecologicalProjectHarmCue ? ["FWS mitigation policy is guidance within the Service's specific authority; it does not impose a universal no-net-loss duty or decide this project's permit."] : []),
      ...(generalHumanHarmTradeoffCue ? [
        "A favorable activity, capacity, or uptime measure does not establish that benefits outweigh harms. Measure the harm, its severity and cause, and affected groups before accountable reviewers choose a value rule; this lens supplies no verdict."] : []),
      ...(relocationConsentCue ? ["Resettlement guidance does not supply a resident's consent or legal authority for this project."] : []),
      ...(aiPersonhoodCue ? ["Neither a model's first-person statement nor an indicator framework by itself settles consciousness or moral status."] : []),
      ...(healthcareWelfareCue ? ["General quality-of-care dimensions do not determine this care setting's clinical standard, acceptable delay, or moral weighting."] : []),
      ...(schoolSupportTradeoffCue ? ["General inclusive-education guidance does not establish this school's support quality, acceptable delay, or moral threshold."] : []),
      ...(moralFishPassageCue ? ["General fish-passage evidence does not determine this project's impact or the value assigned to fish harm."] : []),
      ...(wildlifeCorridorMoralCue ? ["Cite U.S. Fish and Wildlife Service mitigation policy only for its avoid/minimize/compensate procedure, never for community value weights, this project's benefits or harms, or a universal legal or moral verdict."] : []),
      ...(wildlifeCorridorMoralCue ? ["A harm-weighted lens does not itself set a universal approval or rejection threshold; applicable duties and decision authority require independent review."] : []),
      ...(retainedSubstrateMatch ? substrate.claimBoundaryNotes : []),
    ]);
  }
  if (hypothesisIds.length) {
    // Host proposals locate reviewed catalog entries; they do not override a
    // focused deterministic match or turn a badge into an answer.
    likely = bounded([...hypothesisIds, ...likely]).filter((id) => !exact.includes(id));
    uncertainty = bounded([...uncertainty,
      "Host-proposed governing principles are retrieval hypotheses; their relevance and factual claims require independent review."]);
  }
  const project = (ids: string[]) => bounded(ids).filter((id) => allowed.has(id))
    .map((id) => ({ id, url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath(lens, id)}` }));
  const exactBadges = project(exact);
  const likelyBadges = project(likely.filter((id) => !exact.includes(id)));
  if (!exactBadges.length && !likelyBadges.length) {
    // A no-match is still a no-match. One or two well-anchored exploratory
    // leads may help the host investigate a physical mechanism without
    // promoting an unverified card to claim or answer authority.
    const exploratoryIds = lens === "theory" && candidatePrinciples.length
      ? findPublicExploratoryCandidates(scopedBadges, activeTheoryRequest(question),
        candidatePrinciples, (await loadPublicBadgeSearchText()).theory)
      : [];
    const leadIds = [...new Set([...questionOnlyIds, ...exploratoryIds.slice(0, 2), ...bridgeIds])].slice(0, 3);
    if (leadIds.length) {
      const empty = noMatch(lens);
      return {
        ...empty,
        ...relationPreview(leadIds),
        candidate_cards: leadIds.map((id) => {
          const badge = allowed.get(id) as PublicBadge;
          return { id, title: badge.title, concept: badge.summary,
            url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath(lens, id)}`,
            needs_verification: true as const,
            ...(graphPathIds.includes(id) ? { retrieval_basis: "graph_path" as const } : {}),
            ...(questionOnlyIds.includes(id) ? {
              catalog_source_pointers: applicablePublicRefs(badge.source_refs.filter((ref) => /^https:\/\//.test(ref))).slice(0, 2),
              claim_boundaries: badge.claim_boundaries.slice(0, 2),
            } : {}),
            ...(bridgeIds.includes(id) ? { retrieval_basis: "host_hypothesis" as const } : {}) };
        }),
        uncertainty: bounded([...empty.uncertainty,
          bridgeIds.length
            ? "Candidate cards are unverified search leads; an exact excerpt confirms only the quoted text, not the host's inferred connection to a badge. They do not turn this no-match into supporting evidence."
            : questionOnlyIds.length
            ? graphPathIds.length
              ? "A public-text anchor and graph path supply tentative search leads, not a verified mechanism or evidence. Graph relations and catalog source pointers are unchecked for this question; inspect them before use."
              : "Question-only catalog overlap supplies tentative search leads, not a verified mechanism or evidence. Catalog source pointers are unchecked for this question; open each source and check whether its claim applies before citing."
            : "Exploratory cards are unverified search leads; they do not turn this no-match into supporting evidence."]),
      };
    }
    if (lens === "theory" && !candidatePrinciples.length && question.includes("?")) {
      const empty = noMatch(lens);
      return {
        ...empty,
        summary: `${empty.summary} If an unnamed governing mechanism could change the answer, the host may infer up to three short mechanism hypotheses and call this reflection again with candidate_principles. If none is plausible, answer independently.`,
      };
    }
    return noMatch(lens);
  }
  const cardCandidates = [...exactBadges, ...likelyBadges];
  // A deterministic match that shares a unique public-title term with the
  // active question is stronger than a host's inferred search phrase. Keep
  // that named concept focused before any hypothesis-only replacement.
  const namedTheoryCards = lens === "theory" ? cardCandidates.filter(({ id }) => {
    const badge = allowed.get(id);
    if (!badge) return false;
    const active = publicContextTerms(activeTheoryRequest(question));
    return [...publicContextTerms(badge.title)].some((term) => term.length >= 5 &&
      !NON_DISCRIMINATING_THEORY_TERMS.has(term) && active.has(term) &&
      theoryTitleFrequency.get(term) === 1);
  }) : [];
  if (lens === "theory" && hypothesisIds.length) {
    // The internal graph can rank same-word but unrelated claims. When the
    // host's proposal passes the full-catalog question check, return that
    // bounded locator rather than appending broad neighbors as evidence.
    const located = cardCandidates.filter(({ id }) => hypothesisIds.includes(id));
    if (namedTheoryCards.length) cardCandidates.splice(0, cardCandidates.length, ...namedTheoryCards);
    else if (located.length) cardCandidates.splice(0, cardCandidates.length, ...located);
  }
  if (lens === "moral") {
    // The ideology graph can admit many exact cards. Within that admitted set,
    // repeated question terms in a reviewed title are stronger than a broad
    // graph match. This ranker is shared by every moral badge; it grants no
    // new match or authority and leaves the harm-priority gate below intact.
    const questionFrequency = new Map<string, number>();
    for (const raw of activeMoralQuestion.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      for (const word of publicContextTerms(raw)) {
        questionFrequency.set(word, (questionFrequency.get(word) ?? 0) + 1);
      }
    }
    const titleFrequency = new Map<string, number>();
    for (const badge of catalog.moral) {
      for (const word of publicContextTerms(badge.title)) {
        titleFrequency.set(word, (titleFrequency.get(word) ?? 0) + 1);
      }
    }
    const titleScore = (id: string): number => [...publicContextTerms((allowed.get(id) as PublicBadge).title)]
      .reduce((score, word) => score + (questionFrequency.get(word) ?? 0) *
        Math.log((catalog.moral.length + 1) / ((titleFrequency.get(word) ?? 0) + 1)), 0);
    cardCandidates.sort((left, right) => titleScore(right.id) - titleScore(left.id) ||
      Number(hypothesisIds.includes(right.id)) - Number(hypothesisIds.includes(left.id)));
  }
  if (lens === "civilization" && cardCandidates.some(({ id }) => id === "ecological_boundary")) {
    const priority: Record<string, number> = {
      ecological_boundary: 100, energy_capacity: 80, falsification: 70,
      governance: 60, transport_latency: 50, material_base: 40, collaboration: 30,
    };
    cardCandidates.sort((left, right) => (priority[right.id] ?? 0) - (priority[left.id] ?? 0));
  } else if (lens === "civilization" && publicServiceEnergyCue) {
    const priority: Record<string, number> = {
      energy_capacity: 100, governance: 80, falsification: 70,
      transport_latency: 50, material_base: 40, collaboration: 30,
    };
    cardCandidates.sort((left, right) => (priority[right.id] ?? 0) - (priority[left.id] ?? 0));
  } else if (lens === "civilization" && (publicTransitCue || foodSupplyCue || floodHousingCue)) {
    const lead = publicTransitCue ? "transport_latency" : foodSupplyCue ? "material_base" : "governance";
    const priority: Record<string, number> = {
      governance: 80, energy_capacity: 70,
      material_base: 60, transport_latency: 50, falsification: 40, collaboration: 30,
    };
    priority[lead] = 100;
    cardCandidates.sort((left, right) => (priority[right.id] ?? 0) - (priority[left.id] ?? 0));
  } else if (lens === "civilization" && /\b(?:societ(?:y|al)|public|communit(?:y|ies))\b/i.test(activeCivilizationQuestion) &&
    /\b(?:living organisms?|wildlife|habitat|ecosystem|biological)\b/i.test(activeCivilizationQuestion)) {
    const priority: Record<string, number> = {
      energy_capacity: 100, governance: 90, falsification: 80,
      material_base: 70, transport_latency: 60, collaboration: 50,
    };
    cardCandidates.sort((left, right) => (priority[right.id] ?? 0) - (priority[left.id] ?? 0));
  }
  if (wildlifeCorridorMoralCue || animalWelfareTradeoffCue || ecologicalProjectHarmCue || healthcareWelfareCue || schoolSupportTradeoffCue || generalHumanHarmTradeoffCue || relocationConsentCue) {
    const focus = cardCandidates.find(({ id }) => id === "harm-weighted-priority-standard");
    if (focus) {
      const located = cardCandidates.find(({ id }) => id !== focus.id && hypothesisIds.includes(id));
      const explicitHarmTradeoff = wildlifeCorridorMoralCue || animalWelfareTradeoffCue ||
        ecologicalProjectHarmCue || healthcareWelfareCue || schoolSupportTradeoffCue || generalHumanHarmTradeoffCue;
      cardCandidates.splice(0, cardCandidates.length,
        ...(located && !explicitHarmTradeoff ? [located, focus] : [focus]));
    }
  }
  if (aiPersonhoodCue) {
    const focus = cardCandidates.find(({ id }) => id === "substrate.actuation-before-agency");
    if (focus) cardCandidates.splice(0, cardCandidates.length, focus);
  }
  if (lens === "theory") {
    const activeQuestion = activeTheoryRequest(question);
    const terms = topicalTerms(activeQuestion);
    const sufficientlyTopical = cardCandidates.filter(({ id }) =>
      hypothesisIds.includes(id) || activeQuestion.includes(id) ||
      publicTheoryTopicScore(terms, allowed.get(id) as PublicBadge) > 0);
    if (sufficientlyTopical.length) cardCandidates.splice(0, cardCandidates.length, ...sufficientlyTopical);
    cardCandidates.sort((left, right) => {
      const leftBadge = allowed.get(left.id) as PublicBadge;
      const rightBadge = allowed.get(right.id) as PublicBadge;
      const leftNamed = activeQuestion.includes(left.id) ? 100 : hypothesisIds.includes(left.id) ? 20 : 0;
      const rightNamed = activeQuestion.includes(right.id) ? 100 : hypothesisIds.includes(right.id) ? 20 : 0;
      return rightNamed + publicTheoryTopicScore(terms, rightBadge) -
        leftNamed - publicTheoryTopicScore(terms, leftBadge);
    });
  }
  const contextCards = cardCandidates.slice(0, 3).map(({ id, url }) => {
    const badge = allowed.get(id) as PublicBadge;
    const namedBenchmark = lens === "theory" && id === BOSONIC_COMPATIBILITY_BADGE_ID &&
      asksAboutBosonRecoilBenchmark(activeTheoryRequest(question));
    const recoilIllustration = lens === "theory" && id === PUBLIC_ELASTIC_RECOIL_BADGE_ID
      ? elasticRecoilIllustration(activeTheoryRequest(question)) : null;
    const pauliOccupancy = lens === "theory" && id === PAULI_BADGE_ID &&
      asksAboutPauliOccupancy(activeTheoryRequest(question));
    const ecologicalBoundary = lens === "civilization" && id === "ecological_boundary";
    const civicUrbanBirds = ecologicalBoundary && /\b(?:depot|bus(?:es)?|transit)\b/i.test(activeCivilizationQuestion) &&
      /\b(?:birds?|nesting|trees?)\b/i.test(activeCivilizationQuestion);
    const civicWetlandSiting = ecologicalBoundary && /\b(?:batter(?:y|ies)|radios?|generator)\b/i.test(activeCivilizationQuestion) &&
      /\b(?:wetland|marsh)\b/i.test(activeCivilizationQuestion);
    const civicIrrigationWetland = ecologicalBoundary && irrigationWetlandCue;
    const ecologicalCorridor = ecologicalBoundary &&
      /\b(?:energy|electric(?:ity|al)?|power|transmission)\b.{0,50}\b(?:corridor|line|route)\b|\b(?:corridor|line|route)\b.{0,50}\b(?:energy|electric(?:ity|al)?|power|transmission)\b/i.test(activeCivilizationQuestion);
    const electricTransmissionCorridor = ecologicalCorridor &&
      /\b(?:(?:electric(?:ity|al)?|power)\s+(?:transmission\s+)?(?:line|corridor)|transmission\s+(?:line|corridor))\b/i.test(activeCivilizationQuestion);
    const moralWildlifeProcedure = wildlifeCorridorMoralCue && id === "harm-weighted-priority-standard";
    const moralShelterProcedure = animalShelterCue && id === "harm-weighted-priority-standard";
    const moralEcologicalProcedure = ecologicalProjectHarmCue && id === "harm-weighted-priority-standard";
    const moralHumanHarmProcedure = generalHumanHarmTradeoffCue && id === "harm-weighted-priority-standard";
    const moralRelocationProcedure = relocationConsentCue && id === "harm-weighted-priority-standard";
    const moralAiStatusProcedure = aiPersonhoodCue && id === "substrate.actuation-before-agency";
    const moralHealthcareProcedure = healthcareWelfareCue && id === "harm-weighted-priority-standard";
    const moralSchoolProcedure = schoolSupportTradeoffCue && id === "harm-weighted-priority-standard";
    const civicWaterPower = waterUtilityOutageCue && id === "energy_capacity";
    const civicEmergencyPower = publicServiceEnergyCue && id === "energy_capacity";
    const civicTransit = publicTransitCue && id === "transport_latency";
    const civicFoodSupply = foodSupplyCue && id === "material_base";
    const civicWaterAccess = publicWaterAccessCue && id === "material_base";
    const civicFloodHousing = floodHousingCue && id === "governance";
    const civicClinicPower = clinicEnergyLineCue && id === "energy_capacity";
    return {
      id, title: badge.title, concept: lens === "theory"
        ? `${publicTheoryContextConcept(badge, activeTheoryRequest(question))}${recoilIllustration ? ` ${recoilIllustration}` : ""}` :
        moralWildlifeProcedure
          ? `Compare measured social benefits with species and habitat harms, feasible routes and alternatives, protection, and repair. ${moralPowerLineProcedure ? "For power lines, measure bird collision and electrocution risks. " : ""}State the value rule for residual tradeoffs explicitly; this procedural lens does not decide approval.`
          : moralShelterProcedure
          ? "Compare measured admission, post-adoption durability, health, behavior, and sustained welfare with distress to individual animals and care capacity. Ask trustees to state who chooses and independently reviews the value weights and severe-harm threshold. This lens does not decide whether the program succeeds or fails."
          : moralHealthcareProcedure && residentialCareTradeoffCue
          ? "Compare additional nursing-home beds with residents' need-weighted time to help, staffing, falls and other harms, safeguards, and feasible alternatives. Include resident and accountable care review of thresholds; this lens does not decide the home's policy."
          : moralHealthcareProcedure
          ? "Compare appointment volume with need-weighted time to effective care, clinical outcomes, referral capacity, and feasible alternatives. Require accountable clinical and patient review of value rules and thresholds; this lens does not decide the care setting's policy."
          : moralHumanHarmProcedure
          ? serviceProxyHarmCue
            ? "Compare the claimed service proxy with actual benefit and the severity, duration, and distribution of harm to affected people. Check causation, safeguards, alternatives, and the authority for choosing value weights; this lens does not decide approval."
            : "Compare measured aggregate benefit with the severity, duration, and distribution of harm to affected people. Check causation, safeguards, alternatives, and the authority for choosing value weights; this lens does not decide approval."
          : moralRelocationProcedure
          ? "Compare measured flood benefit, remaining risk, displacement, feasible alternatives, and residents' participation. Identify the applicable consent process and decision authority; this lens does not decide relocation."
          : moralAiStatusProcedure
          ? "A system's statement about pain is a report to assess, not a verified experience. Compare independently testable indicators and theory limits; separate empirical consciousness assessment from the normative question of moral status."
          : civicEmergencyPower
          ? publicServiceSitingCue && !publicServiceEnergyContinuityCue
            ? "Define the proposed emergency service, duration, loads, storage and charging needs, and coverage before comparing sites. Check fallback service and ecological effects separately; this card does not verify local performance or approve a site."
            : "Test backup power against the critical service load and stated outage duration, including reserves, monitoring, and recovery. Check vaccine cold-chain temperatures and emergency communication coverage when relevant; this card does not verify local performance."
          : civicTransit
          ? electricTransitCue
            ? "Compare actual route frequency, wait and travel times, charging uptime, and access by neighborhood and rider group before claiming an electric-bus plan improves passenger service. Emissions and cost benefits must be assessed separately; they cannot erase a lost last trip. This card does not verify local operation."
            : "Compare route frequency, wait and travel times, physical accessibility, and actual service reach by neighborhood and rider group. An operating destination does not establish that residents can reach and use it. This card does not verify local operation."
          : civicWaterAccess
          ? "Compare stored water with delivered household service during peak demand. Measure point-of-use availability, pressure and flow, upper-floor continuity, and distribution constraints by neighborhood; a general access indicator does not verify this city's local service."
          : civicFoodSupply
          ? "Trace food inventory, cold storage, delivery routes, alternate suppliers, and household access through a drought scenario. Test duration and failure thresholds; a national supply-chain assessment does not verify this town."
          : civicFloodHousing
          ? "Compare flood-risk reduction, remaining risk, in-place alternatives, displacement, affordability, and residents' participation. Identify who has authority for any relocation; this card does not approve a project."
          : civicIrrigationWetland
          ? "Compare measured crop-water demand and food benefit with source-water limits, pumping energy, wetland functions, nesting habitat, and feasible sites. General references cannot verify the proposed station."
          : civicClinicPower
          ? "Measure clinic power reliability needs and compare line routes, storage, and backup options. Test bird collision and habitat effects separately; this card does not establish a preferred route or approval."
          : moralSchoolProcedure
          ? "Compare appointment volume with need-weighted waits, time to effective support, pupil outcomes, staffing and feasible alternatives. Have affected pupils and families join accountable review of the value rule and harm threshold; this lens does not decide the school's policy."
          : moralEcologicalProcedure
          ? "Compare independently measured human benefits with possible species and habitat effects, less harmful alternatives, residual risk, and review authority. Verify the footprint and impact before calling harm measured. State the value rule; FWS mitigation guidance is not a universal permit or no-net-loss requirement. This lens does not decide approval."
          : animalWelfareTradeoffCue && id === "harm-weighted-priority-standard"
          ? "Compare independently measured harm to individual animals with claimed aggregate benefits, alternatives, and review thresholds. This procedural lens does not supply a moral verdict or project-specific welfare data."
          : badge.summary, url,
      reference_urls: [...badge.source_refs.filter((ref) => /^https:\/\//.test(ref)),
        ...(civicUrbanBirds ? [USFS_URBAN_BIRDS_URL] : []),
        ...(civicWetlandSiting ? [EPA_WETLAND_FUNCTION_URL] : []),
        ...(civicIrrigationWetland ? [USGS_IRRIGATION_WATER_URL, EPA_WETLAND_FUNCTION_URL] : []),
        ...(civicTransit ? [FTA_TITLE_VI_SERVICE_URL, ...(electricTransitCue ? [FTA_ELECTRIC_BUS_URL] : [])] : []),
        ...(civicFoodSupply ? [USDA_FOOD_SUPPLY_URL] : []),
        ...(civicWaterAccess ? [JMP_DRINKING_WATER_SERVICE_URL] : []),
        ...(civicFloodHousing ? [FEMA_FLOOD_RETROFIT_URL, FEMA_RESETTLEMENT_URL] : []),
        ...(electricTransmissionCorridor ? [FWS_ELECTRIC_TRANSMISSION_URL, DOE_ELECTRIC_TRANSMISSION_URL] : []),
        ...(floodWetlandProjectCue && ecologicalBoundary ? [USACE_LEVEE_RISK_URL, ...(!fishPassageProjectCue ? [EPA_WETLAND_FUNCTION_URL] : [])] : []),
        ...(coastalEvacuationCue && ecologicalBoundary ? [EPA_WETLAND_FUNCTION_URL] : []),
        ...(moralWildlifeProcedure ? [FWS_MITIGATION_POLICY_URL, ...(moralPowerLineProcedure ? [FWS_POWER_LINE_BIRDS_URL] : [])] : []),
        ...(moralShelterProcedure ? [ASV_SHELTER_CARE_URL] : []),
        ...(civicWaterPower ? [EPA_WATER_POWER_RESILIENCE_URL] : []),
        ...(civicEmergencyPower ? [publicHeatRefugeCue || !publicServiceStorageSpecified ? DOE_BACKUP_POWER_URL : DOE_BESS_EVALUATION_URL, ...(publicServiceColdChainCue ? [CDC_VACCINE_STORAGE_URL] : []), ...(publicServiceCommunicationsCue ? [CISA_EMERGENCY_COMMS_URL] : [])] : []),
        ...(civicClinicPower ? [DOE_SOLAR_RESILIENCE_URL] : []),
        ...(fishPassageProjectCue && ecologicalBoundary ? [eelPassageProjectCue ? FWS_EEL_PASSAGE_URL : NOAA_FISH_PASSAGE_URL] : []),
        ...(lens === "theory" && id === PUBLIC_ELASTIC_RECOIL_BADGE_ID ? [NIST_ATOMIC_MASS_ENERGY_URL, ...(recoilIllustration ? [CIAAW_ATOMIC_WEIGHTS_URL] : [])] : []),
        ...(moralHealthcareProcedure ? [residentialCareTradeoffCue ? NASEM_NURSING_HOME_CARE_URL : WHO_QUALITY_HEALTH_SERVICES_URL] : []),
        ...(moralSchoolProcedure ? [UNICEF_INCLUSIVE_EDUCATION_URL] : []),
        ...(moralHumanHarmProcedure && workerBurnoutCue ? [WHO_BURNOUT_URL] : []),
        ...(moralHumanHarmProcedure && workerFatigueCue ? [NIOSH_WORK_FATIGUE_URL] : []),
        ...(moralHumanHarmProcedure && schoolFoodAllergyCue ? [CDC_SCHOOL_ALLERGY_URL] : []),
        ...(moralRelocationProcedure ? [FEMA_RESETTLEMENT_URL] : []),
        ...(moralAiStatusProcedure ? [AI_CONSCIOUSNESS_INDICATORS_URL] : []),
        ...(moralEcologicalProcedure && !moralWildlifeProcedure ? [FWS_MITIGATION_POLICY_URL] : []),
        ...(moralFishPassageCue && moralEcologicalProcedure ? [moralEelPassageCue ? FWS_EEL_PASSAGE_URL : NOAA_FISH_PASSAGE_URL] : [])].slice(0, 3),
      reference_status: "no_public_reference" as PublicReflection["context_cards"][number]["reference_status"],
      reference_context: pauliOccupancy ? [
        { url: "https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics", supports: "OpenStax distinguishes fermions from bosons by spin and says Pauli excludes identical electrons from one quantum-mechanical state, while photons have no such restriction; particles can be discussed in the same small spatial region." },
        { url: "https://openstax.org/books/chemistry-atoms-first-2e/pages/3-3-development-of-quantum-theory", supports: "OpenStax explains that two electrons in an atom can share one spatial orbital only when their spin quantum numbers differ; the orbital alone is not the complete electron state." },
      ] : lens === "theory" && id === PUBLIC_ELASTIC_RECOIL_BADGE_ID ? [
        { url: ELASTIC_RECOIL_FORMULA_URL, supports: "Chao, Jin, and Peng state the maximum ordinary two-body elastic nuclear recoil E_R,max = 2 μ²v²/m_N, with reduced mass, incident speed, and target nuclear mass. Their distinct three-body inelastic proposal does not validate any claimed event or the applicability of another interaction model." },
        { url: NIST_ATOMIC_MASS_ENERGY_URL, supports: "NIST CODATA lists the atomic mass unit energy equivalent at about 931.494 MeV; isotope mass numbers in u are not masses in GeV. The reduced-mass inversion is algebra from the stated definition, not a measured particle mass." },
        ...(recoilIllustration ? [{ url: CIAAW_ATOMIC_WEIGHTS_URL, supports: "CIAAW lists standard atomic weights for the named element. This illustrative conversion approximates a target-nucleus mass from the natural-element atomic weight; a specific isotope and detector response require separate inputs." }] : []),
      ] : namedBenchmark ? [
        { url: "https://arxiv.org/html/1809.08682v3", supports: "Illustrative 10^-17 eV constituent in a boson-star model scaled to Sgr A*; not evidence that Sgr A* is a boson star." },
        { url: LZ_EXTENDED_RECOIL_PAPER_URL, supports: "The LZ collaboration reports one 248-keV recoil-like candidate at 2.6 sigma global significance; not a dark-matter discovery." },
        { url: ELASTIC_RECOIL_FORMULA_URL, supports: "Chao, Jin, and Peng state E_R,max = 2 μ²v²/m_N for ordinary two-body elastic nuclear recoil. Substituting the stated ultralight mass and speed gives the displayed bound; the paper does not study this Sgr A* or LZ pairing." },
      ] : lens === "theory" && id === CASIMIR_STATIC_ENERGY_BADGE_ID ? [
        { url: CASIMIR_FORCE_MEASUREMENT_URL, supports: "Lamoreaux measured Casimir force between closely spaced surfaces; this is not evidence of net energy extraction." },
        { url: CASIMIR_CYCLE_ASSESSMENT_URL, supports: "Moddel and Dmitriyeva assess proposed extraction schemes and argue against cyclic mechanical Casimir-cavity power; this does not settle every proposed use or validate this project." },
      ] : civicWaterPower ? [
        { url: EPA_WATER_POWER_RESILIENCE_URL, supports: "EPA guidance covers power-resilience planning for water and wastewater utilities; it does not establish local pump runtime, safe pressure, water quality, or service for the proposed outage duration." },
      ] : civicTransit ? [
        { url: FTA_TITLE_VI_SERVICE_URL, supports: "FTA fixed-route transit guidance includes service frequency and availability as measurable service standards; it does not establish this city's actual frequency, equity, or legal duties without jurisdictional review." },
        ...(electricTransitCue ? [{ url: FTA_ELECTRIC_BUS_URL, supports: "FTA discusses battery-electric bus charging and scheduling constraints; it does not establish this network's charging uptime or rider access." }] : []),
      ] : civicFoodSupply ? [
        { url: USDA_FOOD_SUPPLY_URL, supports: "USDA's supply-chain assessment discusses drought, transport, and cold-storage dependencies; it does not establish this town's inventory, delivery reliability, or household access." },
      ] : civicWaterAccess ? [
        { url: JMP_DRINKING_WATER_SERVICE_URL, supports: "The WHO/UNICEF JMP defines safely managed drinking water as accessible on premises, available when needed, and free of contamination; it does not establish local pressure, delivery reliability, or safety in this city." },
      ] : civicFloodHousing ? [
        { url: FEMA_FLOOD_RETROFIT_URL, supports: "FEMA describes flood-retrofitting and relocation options and their costs; it does not establish this project's flood benefit or authorize moving residents." },
        { url: FEMA_RESETTLEMENT_URL, supports: "FEMA's resettlement planning toolkit addresses community needs and effects; it does not supply resident consent or legal authority for this plan." },
      ] : civicEmergencyPower ? [
        publicHeatRefugeCue || !publicServiceStorageSpecified
          ? { url: DOE_BACKUP_POWER_URL, supports: "DOE recommends planning backup generation and fuel for disruptions; it does not verify this service's endurance, temperature control, or coverage." }
          : { url: DOE_BESS_EVALUATION_URL, supports: "DOE describes evaluating deployed battery or solar-plus-battery performance with metered time-series data; it does not establish this county's storm endurance or radio coverage." },
        ...(publicServiceColdChainCue ? [{ url: CDC_VACCINE_STORAGE_URL, supports: "CDC describes product-specific vaccine storage and handling, temperature monitoring, and emergency planning; it does not verify this local refrigerator or backup power." }] : []),
        ...(publicServiceCommunicationsCue ? [{ url: CISA_EMERGENCY_COMMS_URL, supports: "CISA provides emergency communications planning resources; they do not establish this locality's radio coverage or endurance." }] : []),
      ] : civicClinicPower ? [
        { url: DOE_SOLAR_RESILIENCE_URL, supports: "DOE discusses solar and storage for critical infrastructure resilience; this does not establish the clinic's load, a feasible alternative, or the preferred line route." },
      ] : ecologicalBoundary ? [
        { url: USGS_HABITAT_CONNECTIVITY_URL, supports: "Habitat connectivity is a relevant ecological risk-assessment dimension; no site-specific outcome is supplied." },
        ...(civicUrbanBirds ? [{ url: USFS_URBAN_BIRDS_URL, supports: "USFS research links urban tree habitat with bird use; it does not establish nesting activity or effects at this depot." }] : []),
        ...(civicWetlandSiting ? [{ url: EPA_WETLAND_FUNCTION_URL, supports: "EPA describes wetland flood and habitat functions; it does not quantify loss or alternatives for this battery site." }] : []),
        ...(civicIrrigationWetland ? [
          { url: USGS_IRRIGATION_WATER_URL, supports: "USGS describes irrigation water use and crop-water demand; it does not measure this station's withdrawal, crop benefit, or source-water limit." },
          { url: EPA_WETLAND_FUNCTION_URL, supports: "EPA describes wetland flood and habitat functions; it does not quantify loss or alternatives for this site." },
        ] : []),
        ...(fishPassageProjectCue ? [
          eelPassageProjectCue
            ? { url: FWS_EEL_PASSAGE_URL, supports: "The U.S. Fish and Wildlife Service describes an American-eel migration barrier and planned passage in one U.S. river; it does not identify the eel species or predict this city's barrier impact, flood reliability, or approval outcome." }
            : { url: NOAA_FISH_PASSAGE_URL, supports: "NOAA describes migratory-fish access affected by human-made barriers; it supplies no site-specific gate impact, flood reliability, or approval decision." },
        ] : []),
        ...(floodWetlandProjectCue ? [
          { url: USACE_LEVEE_RISK_URL, supports: "USACE describes assessing levee vulnerabilities, likelihood of failure, and consequences; this does not predict this proposed levee's performance." },
          ...(!fishPassageProjectCue ? [{ url: EPA_WETLAND_FUNCTION_URL, supports: "EPA describes wetlands as flood buffers and habitat for migratory birds; neither function nor loss is quantified for this site." }] : []),
        ] : []),
        ...(coastalEvacuationCue ? [
          { url: EPA_WETLAND_FUNCTION_URL, supports: "EPA describes wetland flood buffering and migratory bird habitat; it does not establish this road's evacuation performance or site-specific marsh impact." },
        ] : []),
        ...(electricTransmissionCorridor ? [
          { url: FWS_ELECTRIC_TRANSMISSION_URL, supports: "Electric transmission lines and access routes can affect wildlife movement and habitat; no site-specific outcome is supplied." },
          { url: DOE_ELECTRIC_TRANSMISSION_URL, supports: "DOE's interim guidance discusses non-transmission alternatives in electric-line NEPA review; it does not establish a legal requirement for this particular project." },
        ] : []),
      ] : moralWildlifeProcedure ? [
        { url: FWS_MITIGATION_POLICY_URL, supports: "U.S. Fish and Wildlife Service policy describes avoiding, minimizing, and compensating for wildlife and habitat impacts. Cite only for that procedure; it does not support community value weights, project-specific benefits or harms, or a universal moral verdict." },
        ...(moralPowerLineProcedure ? [{ url: FWS_POWER_LINE_BIRDS_URL, supports: "U.S. Fish and Wildlife Service describes bird collision and electrocution risks around power lines and avoidance measures; it does not establish effects of this route or a moral verdict." }] : []),
      ] : moralShelterProcedure ? [
        { url: ASV_SHELTER_CARE_URL, supports: "Association of Shelter Veterinarians' guidelines discuss welfare, stress, health, behavior, and capacity for care in shelters. They do not choose the moral weights or decide this shelter's admission policy." },
      ] : moralHealthcareProcedure ? [
        residentialCareTradeoffCue
          ? { url: NASEM_NURSING_HOME_CARE_URL, supports: "National Academies describe nursing-home residents' care needs, staffing, quality, and safety concerns; they do not establish this home's effects, acceptable wait, or moral weights." }
          : { url: WHO_QUALITY_HEALTH_SERVICES_URL, supports: "WHO describes safe, timely, equitable, people-centred healthcare quality dimensions; it does not set this care setting's clinical threshold, throughput target, or moral weights." },
      ] : moralSchoolProcedure ? [
        { url: UNICEF_INCLUSIVE_EDUCATION_URL, supports: "UNICEF describes barriers to effective inclusive education for children with disabilities and the need to monitor school services; it does not set this school's acceptable waiting time, staffing level, or value weights." },
      ] : moralHumanHarmProcedure && workerBurnoutCue ? [
        { url: WHO_BURNOUT_URL, supports: "WHO classifies burnout as an occupational phenomenon, not a medical condition; this does not diagnose workers or establish that this expansion caused it or how the harms should be weighted." },
      ] : moralHumanHarmProcedure && workerFatigueCue ? [
        { url: NIOSH_WORK_FATIGUE_URL, supports: "NIOSH describes fatigue risks from extended hours and nonstandard schedules and recommends employer-worker risk management; it does not verify this warehouse's sleep loss, commute incidents, causal effect, or value weights." },
      ] : moralHumanHarmProcedure && schoolFoodAllergyCue ? [
        { url: CDC_SCHOOL_ALLERGY_URL, supports: "CDC offers school food-allergy prevention and response guidance; it does not establish this school's safe-meal delays, causation, or moral weights." },
      ] : moralRelocationProcedure ? [
        { url: FEMA_RESETTLEMENT_URL, supports: "FEMA's resettlement planning toolkit addresses affected communities and needs; it does not provide resident consent, local authority, or a moral verdict." },
      ] : moralAiStatusProcedure ? [
        { url: AI_CONSCIOUSNESS_INDICATORS_URL, supports: "Butlin and colleagues propose assessing AI consciousness through theory-derived indicators and detailed system analysis; their approach does not make one self-report proof of pain, personhood, or moral status." },
      ] : moralEcologicalProcedure ? [
        { url: FWS_MITIGATION_POLICY_URL, supports: "U.S. Fish and Wildlife Service policy describes avoiding, minimizing, and compensating for wildlife impacts; it does not decide project benefits, local duties, or moral weights." },
        ...(moralFishPassageCue ? [moralEelPassageCue
          ? { url: FWS_EEL_PASSAGE_URL, supports: "The U.S. Fish and Wildlife Service describes one American-eel barrier and passage effort; it does not decide this project's eel impacts, applicable duties, or moral weights." }
          : { url: NOAA_FISH_PASSAGE_URL, supports: "NOAA describes fish passage around human-made barriers; it does not decide this project's impact, applicable duties, or moral weights." }] : []),
      ] : [],
      uncertainty: badge.uncertainty.slice(0, 2),
      claim_boundaries: badge.claim_boundaries.slice(0, 2),
    };
  });
  // A unique public-title term in the active question is a stronger topical
  // anchor than private search metadata. Once such a focused Theory card is
  // present, exploratory neighbors can distract from it; preserve those leads
  // when the admitted card shares only broad title words with the question.
  const focusedTheoryTitleAnchor = lens === "theory" && (namedTheoryCards.length > 0 || contextCards.some((card) => {
    const badge = allowed.get(card.id);
    if (!badge) return false;
    const activeTerms = publicContextTerms(activeTheoryRequest(question));
    return [...publicContextTerms(badge.title)].some((term) => term.length >= 5 &&
      !NON_DISCRIMINATING_THEORY_TERMS.has(term) && activeTerms.has(term) &&
      theoryTitleFrequency.get(term) === 1);
  }));
  const exploratoryIds = !focusedTheoryTitleAnchor && contextCards.length < 3 &&
    (lens === "theory" || contextCards.every((card) => !card.reference_urls.length))
    ? findPublicExploratoryCandidates(scopedBadges, activePublicRequest(question),
      candidatePrinciples, candidatePrinciples.length ? (await loadPublicBadgeSearchText())[lens] : undefined,
      new Set(contextCards.map((card) => card.id)))
    : [];
  // A source-backed Theory card need not settle a different mechanism, but
  // private graph metadata alone cannot advertise an unrelated alternative.
  // Require a public concept in the host hint and either the active question
  // or the focused card's topic family. Candidates remain unverified leads.
  const candidateIds = lens === "theory" ? exploratoryIds.filter((id) => {
    const badge = allowed.get(id);
    if (!badge) return false;
    const visible = [...publicContextTerms(`${badge.title} ${badge.summary}`)].filter((term) =>
      term.length >= 5 && !NON_DISCRIMINATING_THEORY_TERMS.has(term));
    const overlaps = (terms: Set<string>) => [...terms].some((term) => term.length >= 5 &&
      !NON_DISCRIMINATING_THEORY_TERMS.has(term) &&
      visible.some((concept) => concept.slice(0, 5) === term.slice(0, 5)));
    const hinted = candidatePrinciples.some((hint) => overlaps(publicContextTerms(hint)));
    const active = overlaps(publicContextTerms(activeTheoryRequest(question)));
    const family = id.split(".").slice(0, 2).join(".");
    const focusedFamily = contextCards.some((card) => card.id.split(".").slice(0, 2).join(".") === family);
    return hinted && (active || focusedFamily);
  }) : exploratoryIds;
  const visibleCandidateIds = [...new Set([...candidateIds, ...bridgeIds.filter((id) => {
    if (contextCards.some((card) => card.id === id)) return false;
    // A quote-grounded host bridge stays weaker than an explicitly named,
    // independently admitted title. Preserve a second lead only when the
    // active question itself names a distinctive part of that second title.
    if (lens !== "theory" || !namedTheoryCards.length) return true;
    const badge = allowed.get(id);
    if (!badge) return false;
    const active = publicContextTerms(activeTheoryRequest(question));
    return [...publicContextTerms(badge.title)].some((term) => term.length >= 5 &&
      !NON_DISCRIMINATING_THEORY_TERMS.has(term) && active.has(term) &&
      theoryTitleFrequency.get(term) === 1);
  })])].slice(0, 6);
  const candidateCards = visibleCandidateIds.map((id) => {
    const badge = allowed.get(id) as PublicBadge;
    return { id, title: badge.title, concept: badge.summary,
      url: `${resolveCasimirPublicBaseUrl()}${publicBadgePath(lens, id)}`,
      needs_verification: true as const,
      ...(bridgeIds.includes(id) ? { retrieval_basis: "host_hypothesis" as const } : {}) };
  });
  // Every projected literature URL must carry its evidentiary status. A
  // catalog citation is a lead for the host to inspect, not a checked claim
  // mapping; specialized source annotations above retain their narrower scope.
  const atomicReferenceExcluded = molecularLineQuestion && contextCards.some((card) =>
    card.reference_urls.includes("https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html"));
  for (const card of contextCards) {
    card.reference_urls = applicablePublicRefs(card.reference_urls);
    card.reference_context = card.reference_context.filter((ref) =>
      applicablePublicRefs([ref.url]).length > 0);
    if (!card.reference_context.length) {
      const badge = allowed.get(card.id) as PublicBadge;
      card.reference_context = applicablePublicRefs(badge.source_refs.filter((ref) => /^https:\/\//.test(ref)))
        .slice(0, 3).map((url) => ({
          url,
          supports: `Catalog literature pointer for ${badge.title}; claim-specific support has not been verified. Read the source before citing it.`,
        }));
    }
    const annotated = card.reference_urls.filter((url) =>
      card.reference_context.some((ref) => ref.url === url &&
        !ref.supports.startsWith("Catalog literature pointer for "))).length;
    card.reference_status = !card.reference_urls.length ? "no_public_reference" :
      !annotated ? "catalog_pointer_only" :
      annotated < card.reference_urls.length ? "some_scope_annotated" : "scope_annotated";
  }
  if (atomicReferenceExcluded) missing = bounded([...missing,
    "The NIST Atomic Spectra Database pointer was excluded because it covers atoms and ions, not identification of the molecule in this question; inspect molecular laboratory spectroscopy before citing a line match."]);
  if (lens === "civilization") {
    missing = bounded([
      ...missing.filter((item) => !isInternalEvidenceCode(item)),
      ...contextCards.map((card) => PUBLIC_CIVILIZATION_EVIDENCE[card.id]).filter((item): item is string => Boolean(item)),
    ]);
  }
  const unsourced = contextCards.filter((card) => card.reference_urls.length === 0);
  if (unsourced.length) missing = bounded([
    `${unsourced.length} context card(s) have no public source reference URL; obtain independent evidence before using their claims.`,
    ...missing,
  ]);
  if (candidateCards.length) uncertainty = bounded([...uncertainty,
    candidateCards.some((card) => card.retrieval_basis === "host_hypothesis")
      ? "Candidate cards are unverified search leads; an exact excerpt confirms only the quoted text, not the host's inferred connection to a badge. Check relevance and sources before using any claim."
      : "Candidate cards are unverified search leads; check their relevance and sources before using any claim."]);
  const refs = bounded(contextCards.flatMap((card) => card.reference_urls));
  if (lens === "theory") {
    const namedBosonRecoilBenchmark = contextCards.some((card) => card.id === BOSONIC_COMPATIBILITY_BADGE_ID) &&
      asksAboutBosonRecoilBenchmark(activeTheoryRequest(question));
    summary = namedBosonRecoilBenchmark
      ? "Theory context boundary: the Sgr A* boson-star benchmark is illustrative, not an observation of Sgr A*. The LZ 248-keV recoil-like event is a candidate, not a dark-matter discovery. The card's ordinary elastic recoil calculation applies only to the stated free-field interaction."
      : `Theory Badge Graph candidates: ${contextCards.map((card) => card.title).join(", ")}. These locate discussion context, not validation.`;
  }
  const returnedIds = new Set(contextCards.map((card) => card.id));
  const returnedExact = lens === "theory" && hypothesisIds.length
    ? exactBadges.filter(({ id }) => returnedIds.has(id)) : exactBadges;
  const returnedLikely = lens === "theory" && hypothesisIds.length
    ? likelyBadges.filter(({ id }) => returnedIds.has(id)) : likelyBadges;
  const returnedBoundaries = lens === "theory" && hypothesisIds.length
    ? boundaries.filter((item) => {
      const prefix = item.match(/^([a-z0-9_.-]+):/i)?.[1];
      return !prefix || !allowed.has(prefix) || returnedIds.has(prefix);
    }) : boundaries;
  return {
    schema: "casimirbot.public_context_reflection.v1", lens, match_status: "matched", summary,
    exact_badges: returnedExact, likely_badges: returnedLikely,
    context_cards: contextCards,
    candidate_cards: candidateCards,
    ...relationPreview([...contextCards.map((card) => card.id), ...candidateCards.map((card) => card.id)]),
    source_refs: refs, missing_evidence: missing, uncertainty, claim_boundaries: returnedBoundaries,
    terminal_eligible: false, assistant_answer: false,
  };
}
