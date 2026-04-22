import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { hasIntegrationEnv } from "../modules/payments/integrationTestEnv.js";
import { allocateIntegrationPort, startIntegrationServer, stopIntegrationServer } from "../test/integrationServerHarness.js";

const suiteKey = "authz-settings-lifecycle";
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

describe.skipIf(!hasIntegrationEnv)("settings membership lifecycle integration", () => {
  const created = {
    userIds: [] as string[],
    organizerIds: [] as string[],
    membershipIds: [] as string[],
    auditLogIds: [] as string[]
  };

  beforeAll(async () => {
    await startIntegrationServer(suiteKey);
    await waitForHealth();
  });

  afterAll(async () => {
    if (created.organizerIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { id: { in: created.auditLogIds } } });
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

  async function seedScenario(options?: { extraOwner?: boolean; extraAdmin?: boolean }) {
    const organizer = await prisma.organizer.create({
      data: {
        name: `Settings Lifecycle Org ${Date.now()}`,
        slug: `settings-lifecycle-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        serviceFeeBps: 500,
        taxBps: 2100
      }
    });
    created.organizerIds.push(organizer.id);

    const owner = await createUser("settings-lifecycle-owner");
    const admin = await createUser("settings-lifecycle-admin");

    const ownerMembership = await prisma.membership.create({
      data: { userId: owner.user.id, organizerId: organizer.id, role: "owner" }
    });
    const adminMembership = await prisma.membership.create({
      data: { userId: admin.user.id, organizerId: organizer.id, role: "admin" }
    });
    created.membershipIds.push(ownerMembership.id, adminMembership.id);

    let secondOwner:
      | { user: { id: string }; email: string; password: string; membershipId: string }
      | undefined;
    if (options?.extraOwner) {
      const owner2 = await createUser("settings-lifecycle-owner2");
      const membership = await prisma.membership.create({
        data: { userId: owner2.user.id, organizerId: organizer.id, role: "owner" }
      });
      created.membershipIds.push(membership.id);
      secondOwner = { user: owner2.user, email: owner2.email, password: owner2.password, membershipId: membership.id };
    }

    let secondAdmin:
      | { user: { id: string }; email: string; password: string; membershipId: string }
      | undefined;
    if (options?.extraAdmin) {
      const admin2 = await createUser("settings-lifecycle-admin2");
      const membership = await prisma.membership.create({
        data: { userId: admin2.user.id, organizerId: organizer.id, role: "admin" }
      });
      created.membershipIds.push(membership.id);
      secondAdmin = { user: admin2.user, email: admin2.email, password: admin2.password, membershipId: membership.id };
    }

    return { organizer, owner, admin, ownerMembership, adminMembership, secondOwner, secondAdmin };
  }

  it("owner create ok", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const invited = await createUser("settings-lifecycle-invite-ok");

    const response = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: invited.email, role: "staff" })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    created.auditLogIds.push(body.auditLogId);
    created.membershipIds.push(body.membershipId);
    expect(body.email).toBe(invited.email);
    expect(body.role).toBe("staff");
  });

  it("admin can list memberships but cannot manage lifecycle", async () => {
    const scenario = await seedScenario({ extraAdmin: true });
    const adminToken = await login(scenario.admin.email, scenario.admin.password);

    const listResponse = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, adminToken);
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json() as any[];
    const self = listBody.find((row) => row.membershipId === scenario.adminMembership.id);
    expect(self.capabilities.viewOrganizerMembers).toBe(true);
    expect(self.capabilities.manageOrganizerMemberships).toBe(false);

    const removeResponse = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.secondAdmin!.membershipId}`,
      adminToken,
      { method: "DELETE" }
    );
    expect(removeResponse.status).toBe(403);
  });

  it("non-owner create forbidden", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);
    const invited = await createUser("settings-lifecycle-invite-forbidden");

    const response = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, adminToken, {
      method: "POST",
      body: JSON.stringify({ email: invited.email, role: "staff" })
    });

    expect(response.status).toBe(403);
  });

  it("invalid role rejected", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const invited = await createUser("settings-lifecycle-invalid-role");

    const response = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: invited.email, role: "owner" })
    });

    expect(response.status).toBe(400);
  });

  it("duplicate rejected", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: scenario.admin.email, role: "staff" })
    });

    expect(response.status).toBe(409);
  });

  it("owner remove ok", async () => {
    const scenario = await seedScenario({ extraAdmin: true });
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.secondAdmin!.membershipId}`,
      ownerToken,
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    created.auditLogIds.push(body.auditLogId);

    const membership = await prisma.membership.findUnique({ where: { id: scenario.secondAdmin!.membershipId } });
    expect(membership).toBeNull();
  });

  it("non-owner remove forbidden", async () => {
    const scenario = await seedScenario({ extraAdmin: true });
    const adminToken = await login(scenario.admin.email, scenario.admin.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.secondAdmin!.membershipId}`,
      adminToken,
      { method: "DELETE" }
    );

    expect(response.status).toBe(403);
  });

  it("last owner blocked", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.ownerMembership.id}`,
      ownerToken,
      { method: "DELETE" }
    );

    expect(response.status).toBe(409);
  });

  it("self-remove governance blocked", async () => {
    const scenario = await seedScenario({ extraOwner: true });
    const owner2Token = await login(scenario.secondOwner!.email, scenario.secondOwner!.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.secondOwner!.membershipId}`,
      owner2Token,
      { method: "DELETE" }
    );

    expect(response.status).toBe(409);
  });

  it("audit log persisted for create", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);
    const invited = await createUser("settings-lifecycle-audit-create");

    const response = await authFetch(`/organizers/${scenario.organizer.id}/memberships`, ownerToken, {
      method: "POST",
      body: JSON.stringify({ email: invited.email, role: "scanner" })
    });

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    created.auditLogIds.push(body.auditLogId);
    created.membershipIds.push(body.membershipId);

    const audit = await prisma.auditLog.findUnique({ where: { id: body.auditLogId } });
    expect(audit?.action).toBe("membership.created");
    expect(audit?.entityType).toBe("membership");
    expect(audit?.organizerId).toBe(scenario.organizer.id);
    const metadata = audit?.metadata as any;
    expect(metadata.email).toBe(invited.email);
    expect(metadata.role).toBe("scanner");
  });

  it("audit log persisted for remove", async () => {
    const scenario = await seedScenario({ extraAdmin: true });
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.secondAdmin!.membershipId}`,
      ownerToken,
      { method: "DELETE" }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    created.auditLogIds.push(body.auditLogId);

    const audit = await prisma.auditLog.findUnique({ where: { id: body.auditLogId } });
    expect(audit?.action).toBe("membership.removed");
    expect(audit?.entityType).toBe("membership");
    expect(audit?.entityId).toBe(scenario.secondAdmin!.membershipId);
    const metadata = audit?.metadata as any;
    expect(metadata.role).toBe("admin");
    expect(metadata.email).toBe(scenario.secondAdmin!.email);
  });
});
