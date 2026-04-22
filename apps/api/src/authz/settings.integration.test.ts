import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { hasIntegrationEnv } from "../modules/payments/integrationTestEnv.js";
import { allocateIntegrationPort, startIntegrationServer, stopIntegrationServer } from "../test/integrationServerHarness.js";

const suiteKey = "authz-settings";
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

describe.skipIf(!hasIntegrationEnv)("settings integration", () => {
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

  async function seedScenario() {
    const organizer = await prisma.organizer.create({
      data: {
        name: `Settings Org ${Date.now()}`,
        slug: `settings-org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        serviceFeeBps: 500,
        taxBps: 2100
      }
    });
    created.organizerIds.push(organizer.id);

    const owner = await createUser("settings-owner");
    const admin = await createUser("settings-admin");

    const ownerMembership = await prisma.membership.create({
      data: { userId: owner.user.id, organizerId: organizer.id, role: "owner" }
    });
    const adminMembership = await prisma.membership.create({
      data: { userId: admin.user.id, organizerId: organizer.id, role: "admin" }
    });
    created.membershipIds.push(ownerMembership.id, adminMembership.id);

    return { organizer, owner, admin, ownerMembership, adminMembership };
  }

  it("blocks explicit owner self-demotion", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.ownerMembership.id}/role`,
      ownerToken,
      {
        method: "POST",
        body: JSON.stringify({ role: "admin" })
      }
    );

    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.message ?? body.detail).toContain("owner");
  });

  it("rejects role outside admin/staff/scanner at runtime", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.adminMembership.id}/role`,
      ownerToken,
      {
        method: "POST",
        body: JSON.stringify({ role: "owner" })
      }
    );

    expect(response.status).toBe(400);
  });

  it("admin cannot mutate membership roles", async () => {
    const scenario = await seedScenario();
    const adminToken = await login(scenario.admin.email, scenario.admin.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.adminMembership.id}/role`,
      adminToken,
      {
        method: "POST",
        body: JSON.stringify({ role: "staff" })
      }
    );

    expect(response.status).toBe(403);
  });

  it("persists AuditLog row with contractual metadata on role change", async () => {
    const scenario = await seedScenario();
    const ownerToken = await login(scenario.owner.email, scenario.owner.password);

    const response = await authFetch(
      `/organizers/${scenario.organizer.id}/memberships/${scenario.adminMembership.id}/role`,
      ownerToken,
      {
        method: "POST",
        body: JSON.stringify({ role: "staff" })
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.auditLogId).toEqual(expect.any(String));
    created.auditLogIds.push(body.auditLogId);

    const audit = await prisma.auditLog.findUnique({ where: { id: body.auditLogId } });
    expect(audit).toBeTruthy();
    expect(audit?.action).toBe("membership.role_changed");
    expect(audit?.entityType).toBe("membership");
    expect(audit?.entityId).toBe(scenario.adminMembership.id);
    expect(audit?.organizerId).toBe(scenario.organizer.id);
    expect(audit?.actorUserId).toBe(scenario.owner.user.id);

    const metadata = audit?.metadata as any;
    expect(metadata.targetUserId).toBe(scenario.admin.user.id);
    expect(metadata.targetEmail).toBe(scenario.admin.email);
    expect(metadata.previousRole).toBe("admin");
    expect(metadata.role).toBe("staff");
  });
});
