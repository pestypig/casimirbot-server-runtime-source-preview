import { buildNhm2TheoryBadgeGraphV1 } from "@shared/theory/nhm2-theory-badges";
import { loadIdeologyGraphFromFile } from "@shared/moral-graph/load-ideology-graph";
import { MORAL_LIVING_SUBSTRATE_PRINCIPLES } from "@shared/moral-graph/living-substrate-principles";

export type PublicLens = "civilization" | "theory" | "moral";
// Public-only diagnostic locator; it does not alter the frozen scientific graph.
export const PUBLIC_ELASTIC_RECOIL_BADGE_ID = "physics.scattering.elastic_nuclear_recoil_bound";
export const publicContextEnabled = (): boolean => process.env.CASIMIR_PUBLIC_CONTEXT_ENABLED !== "0";
export type PublicBadge = {
  id: string;
  title: string;
  summary: string;
  status: string;
  uncertainty: string[];
  source_refs: string[];
  claim_boundaries: string[];
};

// These are the stable public concepts. Scenario-specific Civilization badges
// are observations, not a general-purpose catalog of observed societies.
const civilizationBadges: PublicBadge[] = [
  ["material_base", "Material base", "Identify resources, inventory, throughput, and missing measurements."],
  ["energy_capacity", "Energy capacity", "Identify energy supply, demand, losses, and unmeasured constraints."],
  ["transport_latency", "Transport and latency", "Examine routes, timing, access, and bottlenecks."],
  ["ecological_boundary", "Habitat and ecological boundary", "Identify affected species, habitat connectivity, migration, and reversible versus lasting effects before projecting a collective benefit."],
  ["governance", "Governance and consent", "Identify decision authority, affected people, and consent boundaries."],
  ["collaboration", "Collaboration bounds", "Examine coordination claims and the evidence needed to support them."],
  ["falsification", "Falsification hooks", "Name observations that could disconfirm a proposed benefit."],
].map(([id, title, summary]) => ({
  id, title, summary, status: "diagnostic concept",
  uncertainty: ["The question-specific capacity, tradeoffs, and affected parties remain unmeasured until evidence is supplied."],
  source_refs: id === "ecological_boundary" ? [
    "https://www.usgs.gov/publications/estimating-functional-connectivity-wildlife-habitat-and-its-relevance-ecological-risk",
  ] : ["docs/public/ai-reasoning-context-v1.md"],
  claim_boundaries: id === "ecological_boundary" ? [
    "General habitat-connectivity evidence identifies an assessment dimension; it does not determine the outcome for an unspecified site or project.",
    "Infrastructure-specific guidance applies only after the proposed project type and jurisdiction are established.",
  ] : ["A concept or scenario frame does not establish feasibility, consent, or a prediction."],
}));

let catalogPromise: Promise<Record<PublicLens, PublicBadge[]>> | undefined;
let searchText: Record<PublicLens, Map<string, string>> | undefined;
// Keep unsourced internal maturity language out of the public projection.
const publicTheorySummary = (badge: { id: string; plainMeaning: string }): string =>
  badge.id === "study.casimir_dp.identifiability_redesign_stage4_2c"
    ? "Diagnostic apparatus redesign study: it compares a prior no-go result with design-assumption response, block covariance for frozen controls, and a synthetic powered region. Physical pilot readiness remains open."
    : badge.id === "physics.atomic.pauli_shell_structure"
    ? "Pauli exclusion bars identical fermions from the same complete quantum state, not from every overlapping spatial region. Two electrons can share a spatial orbital when their spin states differ; a fermion and a boson are different particle types, so Pauli exclusion does not bar their spatial overlap. Mass alone does not decide these statistics."
    : badge.plainMeaning;
// Curated bibliography IDs are not usable public references until they map
// to a stable page whose actual scope has been checked. Keep the remaining
// opaque IDs visible as labels, not as invented links.
const REVIEWED_PUBLIC_LITERATURE_LINKS: Readonly<Record<string, string>> = {
  "NIST-Atomic-Spectra-Database": "https://physics.nist.gov/PhysRefData/ASD/Html/lineshelp.html",
  "OpenStax-Astronomy-Stellar-Spectra": "https://openstax.org/books/astronomy-2e/pages/17-3-the-spectra-of-stars-and-brown-dwarfs",
  "Spectroscopic redshift": "https://openstax.org/books/astronomy/pages/26-5-the-expanding-universe",
};
const publicLiteratureReference = (value: string): string => {
  if (REVIEWED_PUBLIC_LITERATURE_LINKS[value]) return REVIEWED_PUBLIC_LITERATURE_LINKS[value];
  const doi = /^doi:(10\.\d{4,9}\/\S+)$/i.exec(value.trim());
  return doi ? `https://doi.org/${doi[1]}` : value;
};
export function loadPublicBadgeCatalog(): Promise<Record<PublicLens, PublicBadge[]>> {
  catalogPromise ??= (async () => {
    const theoryGraph = buildNhm2TheoryBadgeGraphV1();
    const theory = theoryGraph.badges.map((badge): PublicBadge => ({
      id: badge.id,
      title: badge.title,
      summary: publicTheorySummary(badge),
      status: badge.status,
      uncertainty: badge.id === "physics.atomic.pauli_shell_structure"
        ? ["Whether particles overlap in a particular system depends on their states and interactions; this concept alone does not determine a measured position or material behavior."]
        : [badge.status === "certified"
          ? "This catalog entry alone does not authenticate a certificate or validate an application."
          : `This ${badge.status} badge is a theory locator; its claim still needs independent, claim-specific validation.`],
      // Do not publish local paths, runtime artifacts, equations, or payloads.
      source_refs: badge.sourceRefs.filter((ref) => ref.kind === "literature_ref")
        .map((ref) => publicLiteratureReference(ref.id ||
          (ref.path && /^https:\/\//.test(ref.path) ? ref.path : null) || "literature reference"))
        .concat(badge.id === "physics.atomic.pauli_shell_structure" ? [
          "https://openstax.org/books/university-physics-volume-3/pages/11-1-introduction-to-particle-physics",
          "https://openstax.org/books/chemistry-atoms-first-2e/pages/3-3-development-of-quantum-theory",
        ] : badge.id === "darkmatter.bosonic_multichannel.compatibility_screen" ? [
          "https://arxiv.org/html/1809.08682v3",
          "https://arxiv.org/abs/2609.02823",
          "https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009",
        ] : badge.id === "casimir.cavity.parallel_plate_energy_density" ? [
          "https://journals.aps.org/prl/abstract/10.1103/PhysRevLett.78.5",
          "https://arxiv.org/abs/0910.5893",
        ] : []).slice(0, 8),
      claim_boundaries: badge.id === "physics.atomic.pauli_shell_structure" ? [
        "A shared spatial region is not the same as a shared complete quantum state.",
        "Do not infer that all matter is fermionic, all bosons are massless, or particles behave as rigid classical volumes.",
        "This badge does not establish the position or interaction of particles in a particular system.",
      ] : badge.id === "casimir.cavity.parallel_plate_energy_density" ? [
        "A static Casimir energy-per-area calculation does not establish repeatable net useful power or a viable energy project.",
        "The cited force measurement and cyclic-extraction assessment address different claims; neither validates this project's full energy balance.",
      ] : ["This badge locates a theory claim; it does not validate a physical effect or engineering application."],
    }));
    theory.unshift({
      id: PUBLIC_ELASTIC_RECOIL_BADGE_ID,
      title: "Ordinary elastic nuclear-recoil bound",
      summary: "For a free incident particle and a target nucleus initially at rest, ordinary two-body elastic scattering has a maximum recoil energy E_R,max = 2 μ²v²/m_N, where μ is the reduced mass, v the incident speed, and m_N the target nuclear mass. Calculate with the stated particle, target, and speed before comparing with a claimed recoil.",
      status: "public diagnostic concept",
      uncertainty: ["The incident mass and speed, target nuclear mass, detector response, and interaction channel must be specified and checked for the particular claim."],
      source_refs: ["https://journals.aps.org/prd/abstract/10.1103/PhysRevD.107.093009"],
      claim_boundaries: [
        "This ordinary two-body elastic endpoint does not assess separately specified inelastic, collective, absorption, or externally energized processes.",
        "A higher event rate or field occupation does not raise the maximum recoil energy of one assumed free-particle elastic collision; this badge does not verify any reported detector event.",
      ],
    });
    const graph = await loadIdeologyGraphFromFile();
    const moral = graph.nodes.map((node): PublicBadge => ({
      id: node.id,
      title: node.title,
      summary: node.excerpt || node.summary || "Moral Graph concept; inspect the cited source before applying it.",
      status: "diagnostic lens",
      uncertainty: ["Applicability depends on the affected parties, circumstances, and independently checked evidence."],
      source_refs: ["docs/ethos/ideology.json", ...(node.references ?? []).filter((ref) => typeof ref.url === "string" && /^https:\/\//.test(ref.url))
        .map((ref) => ref.url!)].slice(0, 8),
      claim_boundaries: ["This lens does not decide a person's character, moral status, or the correct action."],
    }));
    moral.push(...MORAL_LIVING_SUBSTRATE_PRINCIPLES.map((badge): PublicBadge => ({
      id: `substrate.${badge.id}`,
      title: badge.title,
      summary: badge.plainMeaning,
      status: badge.maturity,
      uncertainty: [`This ${badge.maturity} principle is an interpretive lens; the relevant substrate and welfare evidence remain case-specific.`],
      source_refs: badge.sourceRefs.map((ref) => ref.url).filter((url): url is string => Boolean(url)).slice(0, 8),
      claim_boundaries: badge.claimBoundaryNotes.slice(0, 8),
    })));
    // Search metadata stays private to the locator. Public pages and MCP cards
    // continue to expose only the reviewed projection above.
    searchText = {
      civilization: new Map(),
      theory: new Map(theoryGraph.badges.map((badge) => [badge.id,
        [badge.whyItMatters, ...badge.subjects, ...badge.tags, ...badge.equationFamilies].join(" ")])),
      moral: new Map(graph.nodes.map((node) => [node.id,
        [...(node.aliases ?? []), ...(node.tags ?? [])].join(" ")])),
    };
    return { civilization: civilizationBadges, theory, moral };
  })();
  return catalogPromise;
}

export async function loadPublicBadgeSearchText(): Promise<Record<PublicLens, Map<string, string>>> {
  await loadPublicBadgeCatalog();
  return searchText as Record<PublicLens, Map<string, string>>;
}

export const publicBadgePath = (lens: PublicLens, id: string): string =>
  `/context/badges/${lens}/${encodeURIComponent(id)}`;
