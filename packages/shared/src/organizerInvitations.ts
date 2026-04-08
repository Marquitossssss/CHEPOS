import { z } from "zod";

export const organizerInvitationRoleSchema = z.enum(["admin", "staff", "scanner"]);
export type OrganizerInvitationRole = z.infer<typeof organizerInvitationRoleSchema>;

export const organizerInvitationStatusSchema = z.enum(["pending", "accepted", "revoked"]);
export type OrganizerInvitationStatus = z.infer<typeof organizerInvitationStatusSchema>;

export const organizerInvitationListItemSchema = z.object({
  invitationId: z.string().uuid(),
  organizerId: z.string().uuid(),
  email: z.string().email(),
  role: organizerInvitationRoleSchema,
  status: organizerInvitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  createdByUserId: z.string().uuid(),
  acceptedAt: z.string().datetime().nullable(),
  acceptedByUserId: z.string().uuid().nullable(),
  revokedAt: z.string().datetime().nullable(),
  revokedByUserId: z.string().uuid().nullable(),
  membershipId: z.string().uuid().nullable()
});
export type OrganizerInvitationListItem = z.infer<typeof organizerInvitationListItemSchema>;

export const organizerInvitationsListSchema = z.array(organizerInvitationListItemSchema);

export const organizerInvitationCreateInputSchema = z.object({
  email: z.string().email(),
  role: organizerInvitationRoleSchema
});
export type OrganizerInvitationCreateInput = z.infer<typeof organizerInvitationCreateInputSchema>;

export const organizerInvitationCommandResultSchema = z.object({
  invitationId: z.string().uuid(),
  organizerId: z.string().uuid(),
  email: z.string().email(),
  role: organizerInvitationRoleSchema,
  status: organizerInvitationStatusSchema,
  expiresAt: z.string().datetime(),
  auditLogId: z.string().uuid()
});

export const organizerInvitationCreateResultSchema = organizerInvitationCommandResultSchema.extend({
  inviteToken: z.string().min(1)
});
export type OrganizerInvitationCreateResult = z.infer<typeof organizerInvitationCreateResultSchema>;

export const organizerInvitationResendResultSchema = organizerInvitationCreateResultSchema;
export type OrganizerInvitationResendResult = z.infer<typeof organizerInvitationResendResultSchema>;

export const organizerInvitationRevokeResultSchema = z.object({
  invitationId: z.string().uuid(),
  organizerId: z.string().uuid(),
  status: z.literal("revoked"),
  revokedAt: z.string().datetime(),
  auditLogId: z.string().uuid()
});
export type OrganizerInvitationRevokeResult = z.infer<typeof organizerInvitationRevokeResultSchema>;

export const organizerInvitationAcceptInputSchema = z.object({
  token: z.string().min(1)
});
export type OrganizerInvitationAcceptInput = z.infer<typeof organizerInvitationAcceptInputSchema>;

export const organizerInvitationAcceptResultSchema = z.object({
  invitationId: z.string().uuid(),
  membershipId: z.string().uuid(),
  organizerId: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  role: organizerInvitationRoleSchema,
  auditLogId: z.string().uuid()
});
export type OrganizerInvitationAcceptResult = z.infer<typeof organizerInvitationAcceptResultSchema>;
