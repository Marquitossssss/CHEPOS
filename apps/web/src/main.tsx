import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { EventActivityPage } from "./pages/EventActivityPage";
import { EventDashboardPage } from "./pages/EventDashboardPage";
import { Layout } from "./components/Layout";
import { Card } from "./components/Card";
import { Button } from "./components/Button";
import { Badge } from "./components/Badge";
import "./index.css";

const qc = new QueryClient();

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
    <Card className="max-w-lg">
      <h2 className="text-xl font-semibold">Login</h2>
      <p className="mt-1 text-sm text-slate-600">Acceso rápido al entorno demo.</p>
      <Button className="mt-4" onClick={() => mutation.mutate({ email: "owner@articket.local", password: "Password123!" })}>
        Ingresar demo
      </Button>
    </Card>
  );
}

function Dashboard() {
  const { data: organizers } = useQuery({ queryKey: ["organizers"], queryFn: () => api<any[]>("/organizers") });
  const organizerId = organizers?.[0]?.id;
  const organizer = organizers?.[0];

  const { data: events } = useQuery({
    queryKey: ["events", organizerId],
    enabled: Boolean(organizerId),
    queryFn: () => api<any[]>(`/events?organizerId=${organizerId}`)
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-semibold">Dashboard</h2>
        <Link to="/events/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
          Crear evento
        </Link>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Organizador</h3>
          <Badge>{organizer ? "conectado" : "sin datos"}</Badge>
        </div>

        {organizer ? (
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <p><span className="font-medium">Nombre:</span> {organizer.name}</p>
            <p><span className="font-medium">Slug:</span> {organizer.slug}</p>
            <p><span className="font-medium">Fees:</span> {organizer.serviceFeeBps ?? 0} bps · Tax {organizer.taxBps ?? 0} bps</p>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No hay organizador disponible.</p>
        )}

        <details className="mt-3 text-xs text-slate-500">
          <summary className="cursor-pointer">Debug JSON</summary>
          <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(organizers, null, 2)}</pre>
        </details>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {(events ?? []).map((event) => (
          <Card key={event.id}>
            <h4 className="font-semibold text-slate-900">{event.name}</h4>
            <p className="mt-1 text-sm text-slate-600">/{event.slug}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              <Link to={`/dashboard/events/${event.id}/activity`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
                Actividad
              </Link>
              <Link to={`/organizers/${organizer?.slug}/events/${event.slug}/dashboard`} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-100">
                Control Panel
              </Link>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function CreateEvent() {
  const create = useMutation({ mutationFn: (payload: any) => api("/events", { method: "POST", body: JSON.stringify(payload) }) });
  return (
    <Card className="max-w-xl">
      <h2 className="text-xl font-semibold">Nuevo evento</h2>
      <Button
        className="mt-4"
        onClick={() =>
          create.mutate({
            organizerId: prompt("Organizer ID") ?? "",
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
        Crear rápido
      </Button>
    </Card>
  );
}

function PublicBuy() {
  const reserve = useMutation({ mutationFn: () => api<any>("/checkout/reserve", { method: "POST", body: JSON.stringify(JSON.parse(prompt("Payload reserve") || "{}")) }) });
  const confirm = useMutation({ mutationFn: (orderId: string) => api("/checkout/confirm", { method: "POST", body: JSON.stringify({ orderId, paymentReference: `PAY-${Date.now()}` }) }) });
  return (
    <Card className="max-w-xl">
      <h2 className="text-xl font-semibold">Compra</h2>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => reserve.mutate()}>Reservar</Button>
        <Button className="bg-emerald-700 hover:bg-emerald-600" onClick={() => confirm.mutate(prompt("OrderId") ?? "")}>Confirmar mock</Button>
      </div>
    </Card>
  );
}

function Checkin() {
  const scan = useMutation({ mutationFn: (code: string) => api("/checkin/scan", { method: "POST", body: JSON.stringify({ code }) }) });
  return (
    <Card className="max-w-xl">
      <h2 className="text-xl font-semibold">Check-in</h2>
      <Button className="mt-4" onClick={() => scan.mutate(prompt("Código") ?? "")}>Validar código</Button>
    </Card>
  );
}

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/events/:eventId/activity" element={<EventActivityPage />} />
        <Route path="/organizers/:organizerSlug/events/:eventSlug/dashboard" element={<EventDashboardPage />} />
        <Route path="/events/new" element={<CreateEvent />} />
        <Route path="/buy" element={<PublicBuy />} />
        <Route path="/checkin" element={<Checkin />} />
      </Routes>
    </Layout>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
