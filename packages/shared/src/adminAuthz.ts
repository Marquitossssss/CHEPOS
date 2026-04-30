export type OrganizerRole = "owner" | "admin" | "staff" | "scanner";

export type AdminCapability =
  | "viewVenues"
  | "manageVenues"
  | "viewVenueLayouts"
  | "manageVenueLayouts"
  | "createEventLayoutSnapshot"
  | "viewEventLayoutSnapshot"
  | "viewOrganizerSettings"
  | "updateOrganizerSettings"
  | "viewOrganizerMembers"
  | "inviteOrganizerMembers"
  | "manageOrganizerMemberships"
  | "revokeOrganizerInvitations"
  | "createEvent"
  | "manageTicketTypes"
  | "viewEventDashboard"
  | "operateEvent"
  | "scanTickets"
  | "viewEventActivity"
  | "viewLatePaymentCases"
  | "resolveLatePayments"
  | "viewOrderCase"
  | "sensitiveOrderLookup"
  | "resendOrderConfirmation";

export type ScopeLevel = "organizer" | "event";

export type CapabilityMap = Record<AdminCapability, boolean>;

const CAPABILITY_ORDER: AdminCapability[] = [
  "viewVenues",
  "manageVenues",
  "viewVenueLayouts",
  "manageVenueLayouts",
  "createEventLayoutSnapshot",
  "viewEventLayoutSnapshot",
  "viewOrganizerSettings",
  "updateOrganizerSettings",
  "viewOrganizerMembers",
  "inviteOrganizerMembers",
  "manageOrganizerMemberships",
  "revokeOrganizerInvitations",
  "createEvent",
  "manageTicketTypes",
  "viewEventDashboard",
  "operateEvent",
  "scanTickets",
  "viewEventActivity",
  "viewLatePaymentCases",
  "resolveLatePayments",
  "viewOrderCase",
  "sensitiveOrderLookup",
  "resendOrderConfirmation"
];

const roleCapabilities: Record<OrganizerRole, AdminCapability[]> = {
  owner: CAPABILITY_ORDER,
  admin: [
    "viewVenues",
    "manageVenues",
    "viewVenueLayouts",
    "manageVenueLayouts",
    "createEventLayoutSnapshot",
    "viewEventLayoutSnapshot",
    "viewOrganizerSettings",
    "viewOrganizerMembers",
    "createEvent",
    "manageTicketTypes",
    "viewEventDashboard",
    "operateEvent",
    "scanTickets",
    "viewEventActivity",
    "viewLatePaymentCases",
    "resolveLatePayments",
    "viewOrderCase",
    "sensitiveOrderLookup",
    "resendOrderConfirmation"
  ],
  staff: [
    "viewVenues",
    "viewVenueLayouts",
    "viewEventLayoutSnapshot",
    "viewEventDashboard",
    "operateEvent",
    "scanTickets",
    "viewEventActivity",
    "viewLatePaymentCases",
    "viewOrderCase"
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
