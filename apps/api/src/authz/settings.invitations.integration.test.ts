import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { hasIntegrationEnv } from "../modules/payments/integrationTestEnv.js";
import { allocateIntegrationPort, startIntegrationServer, stopIntegrationServer } from "../test/integrationServerHarness.js";

const suiteKey = "authz-settings-invitations";
process.env.API_PORT = process.env.API_PORT ?? String(allocateIntegrationPort(suiteKey));
process.env.JWT_ACCESS_SECRET ||= "test-access-secret-min-24-ch";
process.env.JWT_REFRESH_SECRET ||= "test-refresh-secret-24-ch";
process.env.QR_SECRET ||= "test-qr-secret-min-24-ch";
process.env.NODE_ENV ||= "test";

const baseUrl = `http://127.0.0.1:${process.env.API_PORT}`;

async function waitForHealth() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("server did not become healthy in time");
}

describe.skipIf(!hasIntegrationEnv)("settings invitations integration", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    membershipIds: [] as string[],
    invitationIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await startIntegrationServer(suiteKey);
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.organizerIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
      await prisma.organizerInvitation.deleteMany({ where: { id: { in: created.invitationIds } } });
      await prisma.membership.deleteMany({ where: { organizerId: { in: created.organizerIds } } });
      await prisma.organizer.deleteMany({ where: { id: { in: created.organizerIds } } });
      await prisma.user.deleteMany({ where: { id: { in: created.userIds } } });
    }
    await stopIntegrationServer(suiteKey);
  });

  async function createUser(emailPrefix: string) {
    const email = `${emailPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;
    const password = "Password123!";
    const passwordHash = await bcrypt.hash(password, 4);
    const user = await prisma.user.create({ data: { email, passwordHash } });
    created.userIds.push(user.id);
    return { user, email, password };
  }

  async function login(email: string, password: string) {
    const r = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    expect(r.status).toBe(200);
    const json = await r.json() as { accessToken: string };
    return json.accessToken;
  }

  async function authFetch(path: string, token: string, init?: RequestInit) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init?.headers ?? {})
      }
    });
  }

  async function seedScenario() {
    const organizer = await prisma.organizer.create({
      data: {
        name: `Settings Invitation Org ${Date.now()}`,
        slug: `settings-invite-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        serviceFeeBps: 500,
        taxBps: 2100
      }
    });
    created.organizerIds.push(organizer.id);

    const owner = await createUser("settings-invite-owner");
    const admin = await createUser("settings-invite-admin");
    const invitee = await createUser("settings-invite-user");
    const outsider = await createUser("settings-invite-outsider");

    const ownerMembership = await prisma.membership.create({
      data: { userId: owner.user.id, organizerId: organizer.id, role: "owner" }
    });
    const adminMembership = await prisma.membership.create({
      data: { userId: admin.user.id, organizerId: organizer.id, role: "admin" }
    });
    created.membershipIds.push(ownerMembership.id, adminMembership.id);

    return { organizer, owner, admin, invitee, outsider, ownerMembership, adminMembership };
  }

  it("owner can create invitation happy path", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    created.auditLogIds.push(body.auditLogId);
    created.invitationIds.push(body.invitationId);
    expect(body.email).toBe(scenario.invitee.email);
    expect(body.role).toBe("staff");
    expect(body.inviteToken).toEqual(expect.any(String));

    const audit = await prisma.auditLog.findUnique({ where: { id: body.auditLogId } });
    expect(audit?.action).toBe("membership.invitation_created");
  });

  it("non-owner cannot list invitation set", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);

    const listResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, adminToken);
    expect(listResponse.status).toBe(403);
  });

  it("non-owner cannot create invitation", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);

    const response = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, adminToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });

    expect(response.status).toBe(403);
  });

  it("rejects duplicate pending invitation", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const first = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as any;
    created.auditLogIds.push(firstBody.auditLogId);
    created.invitationIds.push(firstBody.invitationId);

    const second = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email.toUpperCase(), role: "staff" })
    });
    expect(second.status).toBe(409);
  });

  it("rejects existing membership", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.admin.email, role: "staff" })
    });

    expect(response.status).toBe(409);
  });

  it("resend rotates token and invalidates previous token", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "scanner" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const resendResponse = await authFetch(
      `/organizers/${scenario.organizer.id}/invitations/${createdBody.invitationId}/resend`,
      ownerToken,
      { method: "POST" }
    );
    expect(resendResponse.status).toBe(200);
    const resentBody = await resendResponse.json() as any;
    created.auditLogIds.push(resentBody.auditLogId);
    expect(resentBody.inviteToken).not.toBe(createdBody.inviteToken);

    const inviteeToken = await login(scenario.invitee.email, scenario.invitee.password);
    const oldAccept = await authFetch(`/organizers/invitations/accept`, inviteeToken, {
      method: "POST",
      body: JSON.stringify({ token: createdBody.inviteToken })
    });
    expect(oldAccept.status).toBe(404);
  });

  it("revoke pending happy path", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "scanner" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const revokeResponse = await authFetch(
      `/organizers/${scenario.organizer.id}/invitations/${createdBody.invitationId}/revoke`,
      ownerToken,
      { method: "POST" }
    );
    expect(revokeResponse.status).toBe(200);
    const revokeBody = await revokeResponse.json() as any;
    created.auditLogIds.push(revokeBody.auditLogId);

    const audit = await prisma.auditLog.findUnique({ where: { id: revokeBody.auditLogId } });
    expect(audit?.action).toBe("membership.invitation_revoked");
  });

  it("accept invitation happy path", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const inviteeToken = await login(scenario.invitee.email, scenario.invitee.password);
    const acceptResponse = await authFetch(`/organizers/invitations/accept`, inviteeToken, {
      method: "POST",
      body: JSON.stringify({ token: createdBody.inviteToken })
    });
    expect(acceptResponse.status).toBe(200);
    const acceptBody = await acceptResponse.json() as any;
    created.auditLogIds.push(acceptBody.auditLogId);
    created.membershipIds.push(acceptBody.membershipId);

    const membership = await prisma.membership.findUnique({ where: { id: acceptBody.membershipId } });
    expect(membership?.role).toBe("staff");

    const audit = await prisma.auditLog.findUnique({ where: { id: acceptBody.auditLogId } });
    expect(audit?.action).toBe("membership.invitation_accepted");
  });

  it("accept mismatch authenticated email", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const outsiderToken = await login(scenario.outsider.email, scenario.outsider.password);
    const acceptResponse = await authFetch(`/organizers/invitations/accept`, outsiderToken, {
      method: "POST",
      body: JSON.stringify({ token: createdBody.inviteToken })
    });
    expect(acceptResponse.status).toBe(409);
  });

  it("accept expired pending", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    await prisma.organizerInvitation.update({
      where: { id: createdBody.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const inviteeToken = await login(scenario.invitee.email, scenario.invitee.password);
    const acceptResponse = await authFetch(`/organizers/invitations/accept`, inviteeToken, {
      method: "POST",
      body: JSON.stringify({ token: createdBody.inviteToken })
    });
    expect(acceptResponse.status).toBe(409);
  });

  it("revoke expired pending", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    await prisma.organizerInvitation.update({
      where: { id: createdBody.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const revokeResponse = await authFetch(
      `/organizers/${scenario.organizer.id}/invitations/${createdBody.invitationId}/revoke`,
      ownerToken,
      { method: "POST" }
    );
    expect(revokeResponse.status).toBe(409);
  });

  it("resend expired pending renews token and expiresAt", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "scanner" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const before = await prisma.organizerInvitation.findUnique({ where: { id: createdBody.invitationId } });
    await prisma.organizerInvitation.update({
      where: { id: createdBody.invitationId },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const resendResponse = await authFetch(
      `/organizers/${scenario.organizer.id}/invitations/${createdBody.invitationId}/resend`,
      ownerToken,
      { method: "POST" }
    );
    expect(resendResponse.status).toBe(200);
    const resentBody = await resendResponse.json() as any;
    created.auditLogIds.push(resentBody.auditLogId);

    const after = await prisma.organizerInvitation.findUnique({ where: { id: createdBody.invitationId } });
    expect(after!.expiresAt.getTime()).toBeGreaterThan(before!.expiresAt.getTime());
    expect(resentBody.inviteToken).not.toBe(createdBody.inviteToken);
  });

  it("double_accept_same_token_creates_single_membership_and_single_success", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const inviteeToken = await login(scenario.invitee.email, scenario.invitee.password);
    const [first, second] = await Promise.all([
      authFetch(`/organizers/invitations/accept`, inviteeToken, { method: "POST", body: JSON.stringify({ token: createdBody.inviteToken }) }),
      authFetch(`/organizers/invitations/accept`, inviteeToken, { method: "POST", body: JSON.stringify({ token: createdBody.inviteToken }) })
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const membershipCount = await prisma.membership.count({
      where: { organizerId: scenario.organizer.id, userId: scenario.invitee.user.id }
    });
    expect(membershipCount).toBe(1);
  });

  it("revoke_vs_accept_allows_single_terminal_transition", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const inviteeToken = await login(scenario.invitee.email, scenario.invitee.password);
    const [revokeResponse, acceptResponse] = await Promise.all([
      authFetch(`/organizers/${scenario.organizer.id}/invitations/${createdBody.invitationId}/revoke`, ownerToken, { method: "POST" }),
      authFetch(`/organizers/invitations/accept`, inviteeToken, { method: "POST", body: JSON.stringify({ token: createdBody.inviteToken }) })
    ]);

    const statuses = [revokeResponse.status, acceptResponse.status].sort();
    expect(statuses).toEqual([200, 409]);

    const invitation = await prisma.organizerInvitation.findUnique({ where: { id: createdBody.invitationId } });
    expect(["accepted", "revoked"]).toContain(invitation!.status);
  });

  it("owner can list invitations and get no auditLogId in GET", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const createResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.invitee.email, role: "staff" })
    });
    const createdBody = await createResponse.json() as any;
    created.auditLogIds.push(createdBody.auditLogId);
    created.invitationIds.push(createdBody.invitationId);

    const listResponse = await authFetch(`/organizers/${scenario.organizer.id}/invitations`, ownerToken);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as any[];
    expect(listBody.length).toBeGreaterThan(0);
    expect(listBody[0].auditLogId).toBeUndefined();
  });
});
