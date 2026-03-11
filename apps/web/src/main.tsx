import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useMutation } from "@tanstack/react-query";
import { api } from "./api/client";
import { EventActivityPage } from "./pages/EventActivityPage";
import { EventDashboardPage } from "./pages/EventDashboardPage";
import {
  ACTIVE_ORGANIZER_STORAGE_KEY,
  AdminLayout,
  AppFrame,
  PageSection,
  PublicToolLayout,
  RoleBadge,
  activeEventStorageKey,
  type VisualRole,
  useAdminContext
} from "./components/Layout";
import { Card } from "./components/Card";
import { Button } from "./components/Button";
import { Badge } from "./components/Badge";
import "./index.css";

const qc = new QueryClient();
const ROLE_STORAGE_KEY = "articket.admin.visualRole";

type Organizer = { id: string; name: string; slug: string; serviceFeeBps?: number; taxBps?: number };

type EventRow = { id: string; organizerId: string; name: string; slug: string; visibility?: string };

function Login() {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) =>
      api<{ accessToken: string }>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      localStorage.setItem("token", data.accessToken);
      navigate("/dashboard");
    }
  });

  return (
    <AppFrame>
      <Card className="max-w-lg">
        <h2 className="text-xl font-semibold">Login</h2>
        <p className="mt-1 text-sm text-slate-600">Acceso rápido al entorno demo.</p>
        <Button className="mt-4" onClick={() => mutation.mutate({ email: "owner@articket.local", password: "Password123!" })}>
          Ingresar demo
        </Button>
      </Card>
    </AppFrame>
  );
}

function Dashboard({ role, onRoleChange }: { role: VisualRole; onRoleChange: (role: VisualRole) => void }) {
  const { activeOrganizer, activeEvent, events, organizers, setActiveEventId, setActiveOrganizerId } = useAdminContext();
  const publishedEvents = events.filter((event) => event.visibility === "published");
  const draftEvents = events.filter((event) => event.visibility === "draft");

  return (
    <div className="space-y-6">
      <PageSection
        title="Inicio operativo"
        description="El admin entra por contexto visible. Organización y evento activos ya no quedan escondidos detrás de supuestos silenciosos."
        actions={<RoleBadge role={role} onChange={onRoleChange} />}
      >
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card>
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Contexto actual</h3>
              <Badge>{activeOrganizer ? "explícito" : "incompleto"}</Badge>
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <p><span className="font-medium">Organización:</span> {activeOrganizer ? activeOrganizer.name : "Sin selección"}</p>
              <p><span className="font-medium">Slug:</span> {activeOrganizer?.slug ?? "-"}</p>
              <p><span className="font-medium">Evento activo:</span> {activeEvent ? activeEvent.name : "Sin selección"}</p>
              <p><span className="font-medium">Visibilidad:</span> {activeEvent?.visibility ?? "-"}</p>
            </div>

            {!activeOrganizer && organizers.length > 1 ? (
              <p className="mt-3 text-sm text-amber-700">Elegí una organización en el selector lateral. Ya no se asume silenciosamente la primera.</p>
            ) : null}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Atajos útiles</h3>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link to="/events" className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Ver eventos</Link>
              {role === "admin" ? <Link to="/events/new" className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Crear evento</Link> : null}
              <Link to={activeEvent ? `/events/${activeEvent.id}/checkin` : "/checkin"} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Ir a check-in</Link>
              <Link to="/buy" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 hover:bg-amber-100">Compra demo fuera del admin</Link>
            </div>
          </Card>
        </div>
      </PageSection>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Operación</h3>
          <p className="mt-2 text-sm text-slate-600">Check-in y panel operativo pasan a depender del evento activo o de una selección explícita desde Eventos.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Eventos</h3>
          <p className="mt-2 text-sm text-slate-600">El dominio Eventos ya funciona como puerta de entrada real al catálogo y a la operación del evento.</p>
        </Card>
        <Card>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Soporte técnico</h3>
          <p className="mt-2 text-sm text-slate-600">La actividad técnica sigue disponible, pero ya no compite como navegación primaria con operación diaria.</p>
        </Card>
      </div>

      <PageSection title="Evento activo" description="Si ya hay evento elegido, desde acá podés entrar directo al panel operativo o al check-in. Si no, elegilo desde el dominio Eventos.">
        {activeEvent ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">{activeEvent.name}</h3>
                <p className="mt-1 text-sm text-slate-600">Organización: {activeOrganizer?.name ?? "-"}</p>
                <p className="text-sm text-slate-600">Slug: /{activeEvent.slug}</p>
              </div>
              <Badge>{activeEvent.visibility ?? "sin estado"}</Badge>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <Link to={`/organizers/${activeOrganizer?.slug}/events/${activeEvent.slug}/dashboard`} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Abrir panel operativo</Link>
              <Link to={`/events/${activeEvent.id}/checkin`} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Abrir check-in</Link>
              <Link to={`/dashboard/events/${activeEvent.id}/activity`} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">Ver actividad técnica</Link>
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-slate-600">Todavía no hay evento activo. Entrá a <Link to="/events" className="font-medium underline">Eventos</Link> y elegí uno como contexto operativo.</p>
          </Card>
        )}
      </PageSection>

      <PageSection title="Resumen de la organización activa" description="El dominio sigue limitado al organizer seleccionado. Ya no depende de asumir silenciosamente el primero.">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Publicados</h3>
            <p className="mt-2 text-2xl font-semibold">{publishedEvents.length}</p>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Draft</h3>
            <p className="mt-2 text-2xl font-semibold">{draftEvents.length}</p>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Perfil visual</h3>
            <p className="mt-2 text-sm text-slate-600">Base temporal para distinguir admin, operación y scanner sin tocar permisos backend todavía.</p>
          </Card>
        </div>
      </PageSection>

      {organizers.length > 1 ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {organizers.map((organizer) => (
              <button
                key={organizer.id}
                onClick={() => setActiveOrganizerId(organizer.id)}
                className={`rounded-md border px-3 py-2 ${activeOrganizer?.id === organizer.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
              >
                {organizer.name}
              </button>
            ))}
          </div>
          {events.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              {events.map((event) => (
                <button
                  key={event.id}
                  onClick={() => setActiveEventId(event.id)}
                  className={`rounded-md border px-3 py-2 ${activeEvent?.id === event.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}
                >
                  {event.name}
                </button>
              ))}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}

function EventsIndex({ role }: { role: VisualRole }) {
  const { activeOrganizer, activeEvent, events, setActiveEventId } = useAdminContext();

  return (
    <PageSection
      title="Eventos"
      description="Entry point serio del dominio. Desde acá se elige evento activo y se separa catálogo del uso operativo diario."
      actions={role === "admin" ? <Link to="/events/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">Crear evento</Link> : undefined}
    >
      <Card>
        <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <p><span className="font-medium">Organización activa:</span> {activeOrganizer?.name ?? "Sin selección"}</p>
          <p><span className="font-medium">Slug:</span> {activeOrganizer?.slug ?? "-"}</p>
          <p><span className="font-medium">Evento activo:</span> {activeEvent?.name ?? "Sin selección"}</p>
          <p><span className="font-medium">Cantidad de eventos:</span> {events.length}</p>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {events.map((event) => {
          const isActive = activeEvent?.id === event.id;
          return (
            <Card key={event.id}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{event.name}</h3>
                <Badge>{isActive ? "activo" : event.visibility ?? "sin estado"}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600">Organización: {activeOrganizer?.name ?? "-"}</p>
              <p className="text-sm text-slate-600">Slug: {event.slug}</p>
              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                {!isActive ? (
                  <button onClick={() => setActiveEventId(event.id)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
                    Usar como evento activo
                  </button>
                ) : null}
                <Link to={`/organizers/${activeOrganizer?.slug}/events/${event.slug}/dashboard`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">Panel operativo</Link>
                <Link to={`/events/${event.id}/checkin`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">Check-in</Link>
                <Link to={`/dashboard/events/${event.id}/activity`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">Actividad técnica</Link>
              </div>
            </Card>
          );
        })}
        {events.length === 0 ? <Card><p className="text-sm text-slate-600">No hay eventos cargados para la organización activa.</p></Card> : null}
      </div>
    </PageSection>
  );
}

function CreateEvent() {
  const { activeOrganizer } = useAdminContext();
  const create = useMutation({ mutationFn: (payload: any) => api("/events", { method: "POST", body: JSON.stringify(payload) }) });

  return (
    <PageSection title="Nuevo evento" description="Sigue siendo un alta rápida, pero ahora depende del organizer seleccionado explícitamente en el shell.">
      <Card className="max-w-2xl">
        <div className="grid gap-3 text-sm">
          <p><span className="font-medium">Organización destino:</span> {activeOrganizer ? `${activeOrganizer.name} (${activeOrganizer.slug})` : "Elegí una organización primero"}</p>
          <p className="text-slate-600">Todavía no es el formulario final de catálogo. En esta fase solo eliminamos dependencias implícitas y abrimos el dominio Eventos correctamente.</p>
        </div>
        <Button
          className="mt-4"
          disabled={!activeOrganizer}
          onClick={() =>
            create.mutate({
              organizerId: activeOrganizer?.id ?? "",
              name: "Evento web",
              slug: `evento-web-${Date.now()}`,
              timezone: "America/Argentina/Buenos_Aires",
              startsAt: new Date(Date.now() + 86400000).toISOString(),
              endsAt: new Date(Date.now() + 90000000).toISOString(),
              capacity: 1000,
              visibility: "published"
            })
          }
        >
          Crear rápido en organización activa
        </Button>
      </Card>
    </PageSection>
  );
}

function PublicBuy() {
  const reserve = useMutation({ mutationFn: () => api<any>("/checkout/reserve", { method: "POST", body: JSON.stringify(JSON.parse(prompt("Payload reserve") || "{}")) }) });
  const confirm = useMutation({ mutationFn: (orderId: string) => api("/checkout/confirm", { method: "POST", body: JSON.stringify({ orderId, paymentReference: `PAY-${Date.now()}` }) }) });
  return (
    <PublicToolLayout title="Compra demo" eyebrow="Herramienta fuera del admin">
      <Card className="max-w-xl">
        <h2 className="text-xl font-semibold">Compra</h2>
        <p className="mt-2 text-sm text-slate-600">Sigue disponible para pruebas manuales, pero ya no cuelga del shell principal de Articket Admin.</p>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => reserve.mutate()}>Reservar</Button>
          <Button className="bg-emerald-700 hover:bg-emerald-600" onClick={() => confirm.mutate(prompt("OrderId") ?? "")}>Confirmar mock</Button>
        </div>
      </Card>
    </PublicToolLayout>
  );
}

function Checkin() {
  const { activeOrganizer, activeEvent, events, setActiveEventId } = useAdminContext();
  const scan = useMutation({ mutationFn: (code: string) => api("/checkin/scan", { method: "POST", body: JSON.stringify({ code }) }) });

  return (
    <PageSection title="Check-in" description="La operación de acceso ya no se presenta como utilidad global muda: depende del evento activo o de una selección explícita.">
      <Card className="max-w-2xl">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p><span className="font-medium">Organización activa:</span> {activeOrganizer?.name ?? "Sin selección"}</p>
          <p><span className="font-medium">Evento activo:</span> {activeEvent?.name ?? "Sin selección"}</p>
        </div>

        {!activeEvent ? (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-amber-700">Elegí un evento antes de operar check-in. Esta vista ya no debería sentirse global ni agnóstica al contexto.</p>
            {events.length > 0 ? (
              <div className="flex flex-wrap gap-2 text-sm">
                {events.map((event) => (
                  <button key={event.id} onClick={() => setActiveEventId(event.id)} className="rounded border border-slate-300 px-3 py-2 hover:bg-slate-100">
                    Usar {event.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No hay eventos disponibles para la organización activa.</p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-medium text-slate-900">Operando sobre: {activeEvent.name}</p>
              <p className="text-slate-600">Slug: /{activeEvent.slug}</p>
              <p className="mt-1 text-slate-600">Flujo corto operativo: panel operativo → check-in → actividad técnica solo si hace falta soporte.</p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => scan.mutate(prompt(`Código para ${activeEvent.name}`) ?? "")}>Validar código</Button>
              <Link to={`/organizers/${activeOrganizer?.slug}/events/${activeEvent.slug}/dashboard`} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">Volver al panel operativo</Link>
              <Link to={`/dashboard/events/${activeEvent.id}/activity`} className="rounded border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">Abrir soporte técnico</Link>
            </div>
          </>
        )}
      </Card>
    </PageSection>
  );
}

function EventScopedCheckin() {
  const { activeOrganizer, events, setActiveEventId } = useAdminContext();
  const [resolved, setResolved] = useState(false);
  const path = window.location.pathname;
  const eventId = useMemo(() => {
    const match = path.match(/^\/events\/([^/]+)\/checkin$/);
    return match?.[1] ?? "";
  }, [path]);

  useEffect(() => {
    if (!eventId) return;
    setActiveEventId(eventId);
    setResolved(true);
  }, [eventId, setActiveEventId]);

  const event = events.find((item) => item.id === eventId) ?? null;

  if (!resolved && eventId) {
    return <PageSection title="Check-in" description="Resolviendo contexto del evento seleccionado..."><Card><p className="text-sm text-slate-600">Preparando check-in del evento.</p></Card></PageSection>;
  }

  return <Checkin key={`${activeOrganizer?.id ?? "no-org"}:${event?.id ?? eventId}`} />;
}

function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <PageSection title={title} description={description}>
      <Card className="max-w-3xl">
        <p className="text-sm text-slate-600">Placeholder honesto de Fase 1. El objetivo acá es fijar la arquitectura funcional del admin, no inventar pantallas nuevas sin modelo de permisos y scopes.</p>
      </Card>
    </PageSection>
  );
}

function AdminApp() {
  const [role, setRole] = useState<VisualRole>(() => {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY);
    if (stored === "staff" || stored === "scanner") return stored;
    return "admin";
  });

  useEffect(() => {
    localStorage.setItem(ROLE_STORAGE_KEY, role);
  }, [role]);

  useEffect(() => {
    const existingOrganizer = localStorage.getItem(ACTIVE_ORGANIZER_STORAGE_KEY);
    if (!existingOrganizer) return;
    const existingEvent = localStorage.getItem(activeEventStorageKey(existingOrganizer));
    if (existingEvent) return;
  }, []);

  return (
    <Routes>
      <Route path="/" element={<Login />} />
      <Route path="/buy" element={<PublicBuy />} />
      <Route
        path="*"
        element={
          <AdminLayout role={role}>
            <Routes>
              <Route path="/dashboard" element={<Dashboard role={role} onRoleChange={setRole} />} />
              <Route path="/events" element={<EventsIndex role={role} />} />
              <Route path="/events/new" element={role === "admin" ? <CreateEvent /> : <Navigate to="/dashboard" replace />} />
              <Route path="/events/:eventId/checkin" element={<EventScopedCheckin />} />
              <Route path="/dashboard/events/:eventId/activity" element={<EventActivityPage />} />
              <Route path="/organizers/:organizerSlug/events/:eventSlug/dashboard" element={<EventDashboardPage />} />
              <Route path="/checkin" element={<Checkin />} />
              <Route path="/sales" element={<PlaceholderPage title="Órdenes y ventas" description="Dominio reservado para órdenes, reservas y ventas. Se habilita en una fase posterior con permisos y pantallas dedicadas." />} />
              <Route path="/payments" element={<PlaceholderPage title="Pagos y excepciones" description="Entrada futura para late payment review, conflictos y conciliación operativa." />} />
              <Route path="/support" element={<PlaceholderPage title="Centro de soporte" description="Actividad técnica y herramientas de soporte quedan encapsuladas fuera de la navegación primaria de operación." />} />
              <Route path="/settings" element={<PlaceholderPage title="Configuración y permisos" description="Reservado para membresías, roles y configuración organizacional. No expuesto todavía a perfiles no administrativos." />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </AdminLayout>
        }
      />
    </Routes>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AdminApp />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
