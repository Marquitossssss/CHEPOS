export type MinimalAdminAuthorizationContext = {
  organizerRole?: "owner" | "admin" | "staff" | "scanner";
} | null;

export function can(
  authorization: MinimalAdminAuthorizationContext,
  capability:
    | "createEvent"
    | "manageTicketTypes"
    | "viewEventDashboard"
    | "scanTickets"
    | "viewEventActivity"
    | "viewLatePaymentCases"
) {
  const role = authorization?.organizerRole ?? "admin";

  switch (capability) {
    case "createEvent":
    case "manageTicketTypes":
      return role === "owner" || role === "admin";
    case "viewEventDashboard":
      return role === "owner" || role === "admin" || role === "staff";
    case "scanTickets":
      return role === "owner" || role === "admin" || role === "staff" || role === "scanner";
    case "viewEventActivity":
      return role === "owner" || role === "admin" || role === "staff";
    case "viewLatePaymentCases":
      return role === "owner" || role === "admin" || role === "staff";
    default:
      return false;
  }
}
