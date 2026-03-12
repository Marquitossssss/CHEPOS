export type OrganizerRole = "owner" | "admin" | "staff" | "scanner";

export type AdminCapability =
  | "viewOrganizerSettings"
  | "createEvent"
  | "manageTicketTypes"
  | "viewEventDashboard"
  | "operateEvent"
  | "scanTickets"
  | "viewEventActivity"
  | "viewLatePaymentCases"
  | "resolveLatePayments"
  | "resendOrderConfirmation";

export type ScopeLevel = "organizer" | "event";

export type CapabilityMap = Record<AdminCapability, boolean>;

const CAPABILITY_ORDER: AdminCapability[] = [
  "viewOrganizerSettings",
  "createEvent",
  "manageTicketTypes",
  "viewEventDashboard",
  "operateEvent",
  "scanTickets",
  "viewEventActivity",
  "viewLatePaymentCases",
  "resolveLatePayments",
  "resendOrderConfirmation"
];

const roleCapabilities: Record<OrganizerRole, AdminCapability[]> = {
  owner: CAPABILITY_ORDER,
  admin: CAPABILITY_ORDER,
  staff: [
    "viewEventDashboard",
    "operateEvent",
    "scanTickets",
    "viewEventActivity",
    "viewLatePaymentCases",
    "resendOrderConfirmation"
  ],
  scanner: ["viewEventDashboard", "operateEvent", "scanTickets"]
};

export function getOrganizerRoleCapabilities(role: OrganizerRole): CapabilityMap {
  const enabled = new Set(roleCapabilities[role]);
  return Object.fromEntries(CAPABILITY_ORDER.map((capability) => [capability, enabled.has(capability)])) as CapabilityMap;
}

export function hasAdminCapability(role: OrganizerRole, capability: AdminCapability) {
  return getOrganizerRoleCapabilities(role)[capability];
}

export function listAdminCapabilities(role: OrganizerRole): AdminCapability[] {
  return CAPABILITY_ORDER.filter((capability) => hasAdminCapability(role, capability));
}

export type AdminAuthorizationContext = {
  scope: ScopeLevel;
  organizerRole: OrganizerRole;
  organizerId: string;
  eventId?: string;
  capabilities: CapabilityMap;
};
