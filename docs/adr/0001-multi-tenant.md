# ADR 0001 - Multi-tenant por organizador

Se adopta aislamiento lógico por `organizerId` en todas las entidades de negocio críticas.
RBAC se implementa con `memberships` y roles owner/admin/staff/scanner.
Esto simplifica MVP y permite migrar a estrategias más avanzadas (RLS por schema/policy) en futuras fases.
