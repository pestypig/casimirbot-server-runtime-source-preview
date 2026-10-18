import { readUnga81CountryEvidence } from "./unga81-evidence";

// Editorial links checked against the hash-matched submitted statement pages.
// A named region or inferred route dependency is not an explicit country reference.
const explicitCounterpartAssertionIds: Record<string, Record<string, readonly string[]>> = {
  ARM: {
    AZE: ["arm-peace-connectivity", "arm-reported-rail-via-georgia", "arm-rail-sections", "arm-missing-persons-cooperation", "arm-demining-cooperation"],
    TUR: ["arm-neighbor-normalization"], GEO: ["arm-neighbor-normalization"], IRN: ["arm-neighbor-normalization"],
  },
  AZE: { ARM: ["aze-transit-and-trade", "aze-peace-agreement-status"] },
  TUR: { ARM: ["tur-arm-normalization", "tur-arm-aze-peace"], AZE: ["tur-arm-aze-peace"] },
  PAK: { IND: ["pak-india-security-claim", "pak-indus-treaty-position"] },
  BTN: { IND: ["btn-gmc-india-market-access", "btn-india-rail-development"] },
  IND: { NPL: ["ind-nepal-disaster-response"] },
  NPL: { IND: ["npl-india-china-flood-aid", "npl-himalayan-resilience-mechanism"],
    CHN: ["npl-india-china-flood-aid", "npl-himalayan-resilience-mechanism"] },
  DJI: { ETH: ["dji-ethiopia-pipeline-construction-report"],
    SOM: ["dji-somalia-stability-support", "dji-somalia-sovereignty-support"],
    ERI: ["dji-eritrea-border-dialogue"] },
  TZA: { BDI: ["tza-dar-electric-rail-neighbors"], COD: ["tza-dar-electric-rail-neighbors"] },
  COD: { AGO: ["cod-lobito-named-partners"], ZMB: ["cod-lobito-named-partners"],
    USA: ["cod-lobito-named-partners"], EUR: ["cod-lobito-named-partners"],
    RWA: ["cod-rwanda-afc-m23-aggression-allegation", "cod-resolution-2773-implementation-request",
      "cod-fdlr-disarmament-and-repatriation-account"] },
  RWA: { COD: ["rwa-burundi-drc-militia-allegation", "rwa-washington-doha-process-support"],
    BDI: ["rwa-burundi-drc-militia-allegation"] },
  SDN: { EGY: ["sdn-egypt-support-and-bilateral-cooperation-interest"] },
};

// A narrow, editorial bridge from an explicitly named counterpart assertion to an
// infrastructure question. Adding a row does not establish the partner's response.
const counterpartInfrastructureConcepts = [
  { fromIso3: "BTN", toIso3: "IND", assertionId: "btn-india-rail-development",
    optionId: "concept:btn_ind_rail_connection", family: "rail_connection" },
  { fromIso3: "DJI", toIso3: "ETH", assertionId: "dji-ethiopia-pipeline-construction-report",
    optionId: "concept:dji_eth_reported_pipeline_link", family: "pipeline_link" },
  { fromIso3: "TZA", toIso3: "BDI", assertionId: "tza-dar-electric-rail-neighbors",
    optionId: "concept:tza_bdi_electric_rail_question", family: "rail_connection" },
  { fromIso3: "TZA", toIso3: "COD", assertionId: "tza-dar-electric-rail-neighbors",
    optionId: "concept:tza_cod_electric_rail_question", family: "rail_connection" },
] as const;

export function readReviewedCounterpartReferences(fromIso3: string, toIso3: string) {
  const ids = explicitCounterpartAssertionIds[fromIso3]?.[toIso3] ?? [];
  if (!ids.length) return [];
  const country = readUnga81CountryEvidence({ countryIso3: fromIso3 });
  const brief = country.reviewedBrief;
  if (!brief) return [];
  return brief.assertions.filter((assertion) => ids.includes(assertion.id)).map((assertion) => ({
    id: assertion.id, fromIso3, toIso3,
    speaker: brief.speaker, speechDate: brief.speechDate,
    claimType: assertion.claimType, text: assertion.text,
    sourceUrl: assertion.sourceUrl, sourcePage: assertion.sourcePage,
    reviewRevision: brief.revision, uncertainty: assertion.uncertainty,
    sourceKind: "reviewed_submitted_statement_delivery_unverified" as const,
    currentRelationEffect: "unassessed" as const,
  }));
}

export function readReviewedCounterpartInfrastructureConcepts(firstIso3: string, secondIso3: string) {
  const selected = new Set([firstIso3, secondIso3]);
  if (selected.size !== 2) return [];
  return counterpartInfrastructureConcepts.flatMap((spec) => {
    if (!selected.has(spec.fromIso3) || !selected.has(spec.toIso3)) return [];
    const reference = readReviewedCounterpartReferences(spec.fromIso3, spec.toIso3)
      .find((item) => item.id === spec.assertionId);
    return reference ? [{ ...spec, reference }] : [];
  });
}
