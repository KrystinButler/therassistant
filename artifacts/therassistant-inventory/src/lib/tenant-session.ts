let activeTenantId: string | null = null;

export function setActiveTenantId(tenantId: string | null) {
  activeTenantId = tenantId;
}

export function getActiveTenantId() {
  return activeTenantId;
}

export function requireActiveTenantId() {
  if (!activeTenantId) {
    throw new Error("No active Therassistant organization is selected.");
  }
  return activeTenantId;
}
