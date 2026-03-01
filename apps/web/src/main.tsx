import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Link, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "./api/client";
import { EventActivityPage } from "./pages/EventActivityPage";
import { EventDashboardPage } from "./pages/EventDashboardPage";

const qc = new QueryClient();

function Login() {
  const navigate = useNavigate();
  const mutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) => api<{ accessToken: string }>("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (data) => { localStorage.setItem("token", data.accessToken); navigate("/dashboard"); }
  });
  return <div><h2>Login</h2><button onClick={() => mutation.mutate({ email: "owner@articket.local", password: "Password123!" })}>Ingresar demo</button></div>;
}

function Dashboard() {
  const { data: organizers } = useQuery({ queryKey: ["organizers"], queryFn: () => api<any[]>("/organizers") });
  const organizerId = organizers?.[0]?.id;
  const { data: events } = useQuery({
    queryKey: ["events", organizerId],
    enabled: Boolean(organizerId),
    queryFn: () => api<any[]>(`/events?organizerId=${organizerId}`)
  });

  return (
    <div>
      <h2>Dashboard</h2>
      <Link to="/events/new">Crear evento</Link>
      <h3>Eventos</h3>
      <ul>
        {(events ?? []).map((event) => (
          <li key={event.id}>
            {event.name} - <Link to={`/dashboard/events/${event.id}/activity`}>Actividad</Link> | <Link to={`/organizers/${organizers?.[0]?.slug}/events/${event.slug}/dashboard`}>Control Panel</Link>
          </li>
        ))}
      </ul>
      <pre>{JSON.stringify(organizers, null, 2)}</pre>
    </div>
  );
}

function CreateEvent() {
  const create = useMutation({ mutationFn: (payload: any) => api("/events", { method: "POST", body: JSON.stringify(payload) }) });
  return <div><h2>Nuevo evento</h2><button onClick={() => create.mutate({ organizerId: prompt("Organizer ID") ?? "", name: "Evento web", slug: `evento-web-${Date.now()}`, timezone: "America/Argentina/Buenos_Aires", startsAt: new Date(Date.now()+86400000).toISOString(), endsAt: new Date(Date.now()+90000000).toISOString(), capacity: 1000, visibility: "published" })}>Crear rápido</button></div>;
}

function PublicBuy() {
  const reserve = useMutation({ mutationFn: () => api<any>("/checkout/reserve", { method: "POST", body: JSON.stringify(JSON.parse(prompt("Payload reserve") || "{}")) }) });
  const confirm = useMutation({ mutationFn: (orderId: string) => api("/checkout/confirm", { method: "POST", body: JSON.stringify({ orderId, paymentReference: `PAY-${Date.now()}` }) }) });
  return <div><h2>Compra</h2><button onClick={() => reserve.mutate()}>Reservar</button><button onClick={() => confirm.mutate(prompt("OrderId") ?? "")}>Confirmar mock</button></div>;
}

function Checkin() {
  const scan = useMutation({ mutationFn: (code: string) => api("/checkin/scan", { method: "POST", body: JSON.stringify({ code }) }) });
  return <div><h2>Check-in</h2><button onClick={() => scan.mutate(prompt("Código") ?? "")}>Validar código</button></div>;
}

function App() {
  return (
    <div>
      <nav><Link to="/">Login</Link> | <Link to="/dashboard">Dashboard</Link> | <Link to="/buy">Compra</Link> | <Link to="/checkin">Check-in</Link></nav>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/dashboard/events/:eventId/activity" element={<EventActivityPage />} />
        <Route path="/organizers/:organizerSlug/events/:eventSlug/dashboard" element={<EventDashboardPage />} />
        <Route path="/events/new" element={<CreateEvent />} />
        <Route path="/buy" element={<PublicBuy />} />
        <Route path="/checkin" element={<Checkin />} />
      </Routes>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><App /></BrowserRouter></QueryClientProvider></React.StrictMode>);
