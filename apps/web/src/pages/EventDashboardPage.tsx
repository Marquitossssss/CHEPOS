import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer, Legend } from "recharts";
import { api } from "../api/client";

type Organizer = { id: string; name: string; slug: string };
type EventRow = { id: string; organizerId: string; name: string; slug: string };
type VisualRole = "admin" | "staff" | "scanner";

type DashboardDTO = {
  event: { id: string; name: string; slug: string; timezone: string; startsAt: string; endsAt: string };
  kpis: {
    ordersPaid: number;
    revenuePaidCents: number;
    ticketsSold: number;
    checkins: number;
    reservationsActive: number;
    latePaymentReviewRequired: number;
  };
  salesSeries: Array<{ bucketStart: string; ordersPaid: number; revenuePaidCents: number }>;
  byTicketType: Array<{
    ticketTypeId: string;
    name: string;
    priceCents: number;
    currency: string;
    quota: number;
    sold: number;
    checkedIn: number;
    reservedActive: number;
    available: number;
  }>;
  recentScans: Array<{ id: string; scannedAt: string; result: string; reason: string | null; gate: string | null; scannedByEmail: string | null }>;
  alerts: { latePaymentReviewRequired: number; recentEmailFailures: number };
  activity: Array<{ id: string; type: string; occurredAt: string; actorType: string; actorId: string | null; aggregateType: string; aggregateId: string; correlationId: string | null }>;
};

const ranges = ["24h", "7d", "30d", "90d"] as const;

function cents(v: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v / 100);
}

function getVisualRole(): VisualRole {
  if (typeof window === "undefined") return "admin";
  const stored = localStorage.getItem("articket.admin.visualRole");
  if (stored === "staff" || stored === "scanner") return stored;
  return "admin";
}

export function EventDashboardPage() {
  const { organizerSlug = "", eventSlug = "" } = useParams();
  const [range, setRange] = useState<(typeof ranges)[number]>("7d");
  const role = getVisualRole();

  const organizersQuery = useQuery({ queryKey: ["organizers"], queryFn: () => api<Organizer[]>("/organizers") });

  const organizer = useMemo(
    () => (organizersQuery.data ?? []).find((o) => o.slug === organizerSlug),
    [organizersQuery.data, organizerSlug]
  );

  const eventsQuery = useQuery({
    queryKey: ["events", organizer?.id],
    enabled: Boolean(organizer?.id),
    queryFn: () => api<EventRow[]>(`/events?organizerId=${organizer?.id}`)
  });

  const event = useMemo(
    () => (eventsQuery.data ?? []).find((e) => e.slug === eventSlug),
    [eventsQuery.data, eventSlug]
  );

  const dashboardQuery = useQuery({
    queryKey: ["event-dashboard", event?.id, range],
    enabled: Boolean(event?.id),
    queryFn: () => api<DashboardDTO>(`/api/events/${event?.id}/dashboard?range=${range}&bucket=day`)
  });

  if (organizersQuery.isLoading || eventsQuery.isLoading || dashboardQuery.isLoading) return <div>Cargando dashboard...</div>;
  if (!organizer) return <div>Organizer no encontrado</div>;
  if (!event) return <div>Evento no encontrado para slug: {eventSlug}</div>;
  if (!dashboardQuery.data) return <div>Sin datos</div>;

  const data = dashboardQuery.data;
  const operationCards = [
    { title: "Check-ins", value: String(data.kpis.checkins), tone: "normal" as const, helper: "Ingresos confirmados" },
    { title: "Reservas activas", value: String(data.kpis.reservationsActive), tone: "normal" as const, helper: "Stock tomado ahora" },
    { title: "Late review", value: String(data.kpis.latePaymentReviewRequired), tone: data.kpis.latePaymentReviewRequired > 0 ? "danger" as const : "normal" as const, helper: "Excepciones para revisar" }
  ];
  const monitoringCards = [
    { title: "Revenue", value: cents(data.kpis.revenuePaidCents), tone: "normal" as const, helper: "Cobrado confirmado" },
    { title: "Orders paid", value: String(data.kpis.ordersPaid), tone: "normal" as const, helper: "Órdenes pagas" },
    { title: "Tickets sold", value: String(data.kpis.ticketsSold), tone: "normal" as const, helper: "Tickets emitidos o check-in" }
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <Link to="/events" className="text-sm text-slate-600 hover:text-slate-900">← Volver a Eventos</Link>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Panel operativo</p>
            <h2 className="mt-1 text-2xl font-semibold">{data.event.name}</h2>
            <p className="mt-2 text-sm text-slate-600">{organizer.name} · /{data.event.slug} · TZ {data.event.timezone}</p>
            <p className="text-sm text-slate-600">
              Inicio operativo del evento. Check-in y monitoreo quedan al frente; actividad técnica queda como soporte secundario.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <Link to={`/events/${data.event.id}/checkin`} className="rounded-md bg-slate-900 px-3 py-2 font-medium text-white hover:bg-slate-700">
              Abrir check-in
            </Link>
            {role !== "scanner" ? (
              <Link to={`/dashboard/events/${data.event.id}/activity`} className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-100">
                Ver actividad técnica
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Modo operativo</h3>
            <p className="mt-1 text-sm text-slate-600">
              {role === "scanner"
                ? "Perfil scanner: foco en validación, flujo corto a check-in y menos ruido analítico."
                : "Perfil staff/operator: foco en estado operativo, alertas y navegación rápida a check-in y soporte secundario."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">
              {role === "scanner" ? "Scanner" : role === "staff" ? "Staff / Operación" : "Admin / Owner"}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700">Rango {range}</span>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Operación diaria</h3>
              <p className="mt-1 text-sm text-slate-600">Indicadores para operar el evento ahora, no para investigar histórico técnico.</p>
            </div>
            <Link to={`/events/${data.event.id}/checkin`} className="rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100">Ir a check-in</Link>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {operationCards.map((card) => <Kpi key={card.title} title={card.title} value={card.value} helper={card.helper} tone={card.tone} />)}
          </div>

          <div className="mt-5">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Escaneos recientes</h4>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="pb-2 pr-4">When</th>
                    <th className="pb-2 pr-4">Result</th>
                    <th className="pb-2 pr-4">Reason</th>
                    <th className="pb-2 pr-4">Gate</th>
                    <th className="pb-2">By</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentScans.length === 0 ? (
                    <tr><td colSpan={5} className="py-3 text-slate-500">Sin scans recientes.</td></tr>
                  ) : data.recentScans.map((s) => (
                    <tr key={s.id} className="border-t border-slate-100">
                      <td className="py-3 pr-4">{new Date(s.scannedAt).toLocaleString()}</td>
                      <td className="py-3 pr-4">{s.result}</td>
                      <td className="py-3 pr-4">{s.reason ?? "-"}</td>
                      <td className="py-3 pr-4">{s.gate ?? "-"}</td>
                      <td className="py-3">{s.scannedByEmail ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold">Monitoreo</h3>
            <p className="mt-1 text-sm text-slate-600">Indicadores de lectura para staff/operator. Scanner no necesita profundizar acá.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              {monitoringCards.map((card) => <Kpi key={card.title} title={card.title} value={card.value} helper={card.helper} tone={card.tone} />)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold">Alertas operativas</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-700">
              <li>Late payment review required: <strong>{data.alerts.latePaymentReviewRequired}</strong></li>
              <li>Recent email failures: <strong>{data.alerts.recentEmailFailures}</strong></li>
            </ul>
          </div>
        </div>
      </section>

      {role !== "scanner" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Monitoreo comercial</h3>
              <p className="mt-1 text-sm text-slate-600">Vista de apoyo para staff/operator. No es el centro de la operación de puerta.</p>
            </div>
            <div className="flex gap-2 text-sm">
              {ranges.map((r) => (
                <button key={r} onClick={() => setRange(r)} disabled={r === range} className={`rounded-md border px-3 py-1.5 ${r === range ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 h-[300px] rounded-xl border border-slate-100 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.salesSeries.map((s) => ({ ...s, label: new Date(s.bucketStart).toLocaleDateString() }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="ordersPaid" stroke="#2563eb" name="Orders paid" />
                <Line yAxisId="right" type="monotone" dataKey="revenuePaidCents" stroke="#16a34a" name="Revenue cents" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      ) : null}

      {role !== "scanner" ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-lg font-semibold">Capacidad por ticket type</h3>
          <p className="mt-1 text-sm text-slate-600">Lectura operativa de stock y ocupación, separada de la actividad técnica.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-2 pr-4">TicketType</th>
                  <th className="pb-2 pr-4">Precio</th>
                  <th className="pb-2 pr-4">Quota</th>
                  <th className="pb-2 pr-4">Sold</th>
                  <th className="pb-2 pr-4">CheckedIn</th>
                  <th className="pb-2 pr-4">Reserved</th>
                  <th className="pb-2">Available</th>
                </tr>
              </thead>
              <tbody>
                {data.byTicketType.map((t) => (
                  <tr key={t.ticketTypeId} className="border-t border-slate-100">
                    <td className="py-3 pr-4">{t.name}</td>
                    <td className="py-3 pr-4">{cents(t.priceCents)}</td>
                    <td className="py-3 pr-4">{t.quota}</td>
                    <td className="py-3 pr-4">{t.sold}</td>
                    <td className="py-3 pr-4">{t.checkedIn}</td>
                    <td className="py-3 pr-4">{t.reservedActive}</td>
                    <td className="py-3">{t.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Soporte técnico secundario</h3>
            <p className="mt-1 text-sm text-slate-600">La actividad del evento sigue disponible, pero degradada como herramienta de soporte e investigación.</p>
          </div>
          <Link to={`/dashboard/events/${data.event.id}/activity`} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            Abrir actividad técnica
          </Link>
        </div>

        {role !== "scanner" ? (
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="pb-2 pr-4">When</th>
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Actor</th>
                  <th className="pb-2">Aggregate</th>
                </tr>
              </thead>
              <tbody>
                {data.activity.length === 0 ? (
                  <tr><td colSpan={4} className="py-3 text-slate-500">Sin activity.</td></tr>
                ) : data.activity.slice(0, 5).map((a) => (
                  <tr key={a.id} className="border-t border-slate-100">
                    <td className="py-3 pr-4">{new Date(a.occurredAt).toLocaleString()}</td>
                    <td className="py-3 pr-4">{a.type}</td>
                    <td className="py-3 pr-4">{a.actorType}:{a.actorId ?? "-"}</td>
                    <td className="py-3">{a.aggregateType}:{a.aggregateId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-600">El perfil scanner no necesita el feed técnico en primer plano. Si hace falta soporte, se entra a la vista de actividad desde un rol de operación.</p>
        )}
      </section>
    </div>
  );
}

function Kpi({ title, value, helper, tone = "normal" }: { title: string; value: string; helper?: string; tone?: "normal" | "danger" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "danger" ? "border-rose-200 bg-rose-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}
