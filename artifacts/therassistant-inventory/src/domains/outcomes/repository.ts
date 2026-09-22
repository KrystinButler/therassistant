import { tenantInsert, tenantSelect, type Row } from "../../lib/tenant-data-client";
import { buildOutcomeScoreValues, type OutcomeScoreDraft } from "./workflow";

type DataRow = Row & { id: string };

export function getOutcomeScores(clientId: string) {
  return tenantSelect<DataRow>("patient_outcome_scores", {
    client_id: "eq." + clientId,
    order: "administered_date.desc,created_at.desc",
  });
}

export function addOutcomeScore(clientId: string, input: OutcomeScoreDraft) {
  return tenantInsert<DataRow>("patient_outcome_scores", {
    client_id: clientId,
    ...buildOutcomeScoreValues(input),
  });
}
