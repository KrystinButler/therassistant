import assert from "node:assert/strict";
import test from "node:test";

import { decideEncounterAuthoringAccess } from "../src/domains/encounters/encounter-authoring-access";

const providerId = "provider-rendering";

test("admin-only account cannot author a clinician note", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: providerId,
    isClinician: false,
    isLinkedProvider: false,
    linkedProviderIds: [],
  });

  assert.equal(decision.kind, "clinician_role_required");
  assert.equal(decision.canAuthor, false);
  assert.equal(decision.canSign, false);
  assert.equal(decision.shouldAttemptAutoLink, false);
});

test("clinician-only account linked to the rendering provider can author and sign", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: providerId,
    isClinician: true,
    isLinkedProvider: true,
    linkedProviderIds: [providerId],
  });

  assert.equal(decision.kind, "ready");
  assert.equal(decision.canAuthor, true);
  assert.equal(decision.canSign, true);
});

test("admin plus clinician account is governed by clinician identity and can author when linked", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: providerId,
    isClinician: true,
    isLinkedProvider: true,
    linkedProviderIds: [providerId],
  });

  assert.equal(decision.kind, "ready");
  assert.equal(decision.canAuthor, true);
  assert.equal(decision.canSign, true);
});

test("clinician with no provider link is eligible for automatic linking before documentation", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: providerId,
    isClinician: true,
    isLinkedProvider: false,
    linkedProviderIds: [],
  });

  assert.equal(decision.kind, "auto_link_required");
  assert.equal(decision.canAuthor, false);
  assert.equal(decision.canSign, false);
  assert.equal(decision.shouldAttemptAutoLink, true);
});

test("clinician linked to a different rendering provider is blocked rather than auto-linked", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: providerId,
    isClinician: true,
    isLinkedProvider: false,
    linkedProviderIds: ["provider-someone-else"],
  });

  assert.equal(decision.kind, "provider_mismatch");
  assert.equal(decision.canAuthor, false);
  assert.equal(decision.canSign, false);
  assert.equal(decision.shouldAttemptAutoLink, false);
});

test("encounter without a rendering provider cannot open an editable clinical note", () => {
  const decision = decideEncounterAuthoringAccess({
    encounterProviderId: null,
    isClinician: true,
    isLinkedProvider: false,
    linkedProviderIds: [],
  });

  assert.equal(decision.kind, "rendering_provider_required");
  assert.equal(decision.canAuthor, false);
  assert.equal(decision.canSign, false);
  assert.equal(decision.shouldAttemptAutoLink, false);
});
