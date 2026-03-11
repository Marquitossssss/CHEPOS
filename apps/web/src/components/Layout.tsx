import { Link, useLocation, useNavigate } from "react-router-dom";
import type { PropsWithChildren, ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type Organizer = {
  id: string;
  name: string;
  slug: string;
  serviceFeeBps?: number;
  taxBps?: number;
};

type EventRow = {
  id: string;
  organizerId: string;
  name: string;
  slug: string;
  visibility?: string;
};

export type VisualRole = "admin" | "staff" | "scanner";

export const ACTIVE_ORGANIZER_STORAGE_KEY = "articket.admin.activeOrganizerId";

export function activeEventStorageKey(organizerId: string) {
  return `articket.admin.activeEventId:${organizerId}`;
}

type NavItem = {
  to: string;
  label: string;
  exact?: boolean;
  disabled?: boolean;
  roles?: VisualRole[];
  helper?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    label: "Operación",
    items: [
      { to: "/dashboard", label: "Inicio", exact: true },
      { to: "/checkin", label: "Check-in" }
    ]
  },
  {
    label: "Eventos",
    items: [
      { to: "/events", label: "Eventos", exact: true },
      { to: "/events/new", label: "Crear evento", roles: ["admin"] }
    ]
  },
  {
    label: "Ventas",
    items: [
      { to: "/sales", label: "Órdenes y ventas", disabled: true, helper: "Próxima fase" }
    ]
  },
  {
    label: "Pagos",
    items: [
      { to: "/payments", label: "Casos y excepciones", disabled: true, helper: "Próxima fase" }
    ]
  },
  {
    label: "Soporte",
    items: [
      { to: "/support", label: "Centro de soporte", disabled: true, helper: "Próxima fase" },
      { to: "/dashboard/events", label: "Actividad técnica", disabled: true, helper: "Secundaria, no primaria" }
    ]
  },
  {
    label: "Configuración",
    items: [
      { to: "/settings", label: "Organización y permisos", disabled: true, helper: "Próxima fase", roles: ["admin"] }
    ]
  }
];

function isActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.to;
  return pathname === item.to || pathname.startsWith(`${item.to}/`);
}

function extractEventContext(pathname: string) {
  const dashboardMatch = pathname.match(/^\/organizers\/([^/]+)\/events\/([^/]+)\/dashboard$/);
  if (dashboardMatch) {
    return { organizerSlug: decodeURIComponent(dashboardMatch[1]), eventSlug: decodeURIComponent(dashboardMatch[2]), eventId: null as string | null };
  }

  const activityMatch = pathname.match(/^\/dashboard\/events\/([^/]+)\/activity$/);
  if (activityMatch) {
    return { organizerSlug: null as string | null, eventSlug: null as string | null, eventId: decodeURIComponent(activityMatch[1]) };
  }

  const checkinMatch = pathname.match(/^\/events\/([^/]+)\/checkin$/);
  if (checkinMatch) {
    return { organizerSlug: null as string | null, eventSlug: null as string | null, eventId: decodeURIComponent(checkinMatch[1]) };
  }

  return { organizerSlug: null as string | null, eventSlug: null as string | null, eventId: null as string | null };
}

export function useAdminContext() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeContext = useMemo(() => extractEventContext(location.pathname), [location.pathname]);

  const organizersQuery = useQuery({
    queryKey: ["layout-organizers"],
    queryFn: () => api<Organizer[]>("/organizers")
  });

  const organizers = organizersQuery.data ?? [];
  const storedOrganizerId = typeof window !== "undefined" ? localStorage.getItem(ACTIVE_ORGANIZER_STORAGE_KEY) : null;

  const activeOrganizer = useMemo(() => {
    if (routeContext.organizerSlug) {
      return organizers.find((o) => o.slug === routeContext.organizerSlug) ?? null;
    }

    if (storedOrganizerId) {
      return organizers.find((o) => o.id === storedOrganizerId) ?? null;
    }

    if (organizers.length === 1) return organizers[0];
    return null;
  }, [organizers, routeContext.organizerSlug, storedOrganizerId]);

  useEffect(() => {
    if (!activeOrganizer || typeof window === "undefined") return;
    localStorage.setItem(ACTIVE_ORGANIZER_STORAGE_KEY, activeOrganizer.id);
  }, [activeOrganizer]);

  const eventsQuery = useQuery({
    queryKey: ["layout-events", activeOrganizer?.id],
    enabled: Boolean(activeOrganizer?.id),
    queryFn: () => api<EventRow[]>(`/events?organizerId=${activeOrganizer?.id}`)
  });

  const events = eventsQuery.data ?? [];
  const storedEventId = activeOrganizer && typeof window !== "undefined" ? localStorage.getItem(activeEventStorageKey(activeOrganizer.id)) : null;

  const activeEvent = useMemo(() => {
    if (routeContext.eventSlug) return events.find((event) => event.slug === routeContext.eventSlug) ?? null;
    if (routeContext.eventId) return events.find((event) => event.id === routeContext.eventId) ?? null;
    if (storedEventId) return events.find((event) => event.id === storedEventId) ?? null;
    return null;
  }, [events, routeContext.eventSlug, routeContext.eventId, storedEventId]);

  useEffect(() => {
    if (!activeOrganizer || !activeEvent || typeof window === "undefined") return;
    localStorage.setItem(activeEventStorageKey(activeOrganizer.id), activeEvent.id);
  }, [activeOrganizer, activeEvent]);

  const setActiveOrganizerId = (organizerId: string) => {
    if (typeof window !== "undefined") localStorage.setItem(ACTIVE_ORGANIZER_STORAGE_KEY, organizerId);
    navigate("/events");
  };

  const setActiveEventId = (eventId: string) => {
    if (!activeOrganizer || typeof window === "undefined") return;
    localStorage.setItem(activeEventStorageKey(activeOrganizer.id), eventId);
  };

  return {
    location,
    navigate,
    organizersQuery,
    eventsQuery,
    organizers,
    events,
    activeOrganizer,
    activeEvent,
    setActiveOrganizerId,
    setActiveEventId
  };
}

export function AdminLayout({ children, role }: PropsWithChildren<{ role: VisualRole }>) {
  const {
    location,
    organizersQuery,
    organizers,
    events,
    activeOrganizer,
    activeEvent,
    setActiveOrganizerId,
    setActiveEventId
  } = useAdminContext();

  const visibleGroups = navGroups.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role))
  })).filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[280px_1fr]">
        <aside className="border-r border-slate-200 bg-white px-4 py-6">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Articket Admin</p>
            <h1 className="mt-1 text-lg font-semibold">Eventos y operación</h1>
            <p className="mt-2 text-sm text-slate-600">
              Primer dominio real del admin: contexto explícito, entrada seria a eventos y operación más cerca del evento activo.
            </p>
          </div>

          <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contexto activo</p>
            <div className="mt-3 space-y-3">
              <ContextRow label="Perfil visual" value={roleLabel(role)} />

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Organización</p>
                <select
                  value={activeOrganizer?.id ?? ""}
                  onChange={(e) => setActiveOrganizerId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="" disabled>{organizersQuery.isLoading ? "Cargando..." : "Seleccioná organización"}</option>
                  {organizers.map((organizer) => (
                    <option key={organizer.id} value={organizer.id}>{organizer.name} ({organizer.slug})</option>
                  ))}
                </select>
              </div>

              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Evento</p>
                <select
                  value={activeEvent?.id ?? ""}
                  disabled={!activeOrganizer || events.length === 0}
                  onChange={(e) => setActiveEventId(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <option value="">{!activeOrganizer ? "Primero elegí organización" : events.length === 0 ? "Sin eventos disponibles" : "Seleccioná evento activo"}</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>{event.name}</option>
                  ))}
                </select>
                {activeEvent ? <p className="mt-1 text-xs text-slate-500">/{activeEvent.slug}</p> : null}
              </div>
            </div>
          </div>

          <nav className="space-y-5">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
                <div className="space-y-1.5">
                  {group.items.map((item) => {
                    const active = isActive(location.pathname, item);
                    if (item.disabled) {
                      return (
                        <div key={`${group.label}-${item.label}`} className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
                          <div className="font-medium">{item.label}</div>
                          {item.helper ? <div className="mt-1 text-xs">{item.helper}</div> : null}
                        </div>
                      );
                    }

                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={`block rounded-lg px-3 py-2 text-sm transition ${
                          active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-w-0">
          <header className="border-b border-slate-200 bg-white px-6 py-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Admin multiusuario · Eventos / Operación</p>
                <h2 className="text-xl font-semibold">Contexto explícito y flujo operativo menos implícito</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Link to="/dashboard" className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Inicio</Link>
                <Link to="/events" className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">Eventos</Link>
                <Link to="/buy" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-900 hover:bg-amber-100">
                  Herramienta de compra demo
                </Link>
              </div>
            </div>
          </header>

          <main className="px-6 py-6">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function PublicToolLayout({ title, eyebrow, children }: PropsWithChildren<{ title: string; eyebrow: string }>) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">{eyebrow}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-amber-950">{title}</h1>
              <p className="mt-1 text-sm text-amber-900">
                Esta vista queda disponible, pero explícitamente fuera del shell administrativo principal.
              </p>
            </div>
            <Link to="/dashboard" className="rounded-md border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100">
              Volver al admin
            </Link>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AppFrame({ children }: PropsWithChildren) {
  return <div className="min-h-screen bg-slate-50"><main className="mx-auto max-w-6xl px-4 py-6">{children}</main></div>;
}

function ContextRow({ label, value, helper }: { label: string; value: string; helper?: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-900">{value}</p>
      {helper ? <p className="text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function roleLabel(role: VisualRole) {
  switch (role) {
    case "admin":
      return "Admin / Owner";
    case "staff":
      return "Staff / Operación";
    case "scanner":
      return "Scanner";
  }
}

export function RoleBadge({ role, onChange }: { role: VisualRole; onChange?: (role: VisualRole) => void }) {
  if (!onChange) {
    return <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{roleLabel(role)}</span>;
  }

  return (
    <label className="text-sm text-slate-700">
      Perfil visual
      <select
        value={role}
        onChange={(e) => onChange(e.target.value as VisualRole)}
        className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
      >
        <option value="admin">Admin / Owner</option>
        <option value="staff">Staff / Operación</option>
        <option value="scanner">Scanner</option>
      </select>
    </label>
  );
}

export function PageSection({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
