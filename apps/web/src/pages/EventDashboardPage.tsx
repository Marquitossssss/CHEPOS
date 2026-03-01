import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis, ResponsiveContainer, Legend } from "recharts";
import { api } from "../api/client";

type Organizer = { id: string; name: string; slug: string };
type EventRow = { id: string; organizerId: string; name: string; slug: string };

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

export function EventDashboardPage() {
  const { organizerSlug = "", eventSlug = "" } = useParams();
  const [range, setRange] = useState<(typeof ranges)[number]>("7d");

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

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <Link to="/dashboard">← Volver</Link>
        <h2>Event Control Panel · {data.event.name}</h2>
        <small>{organizer.name} · TZ {data.event.timezone}</small>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        {ranges.map((r) => (
          <button key={r} onClick={() => setRange(r)} disabled={r === range}>{r}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", gap: 10 }}>
        <Kpi title="Revenue" value={cents(data.kpis.revenuePaidCents)} />
        <Kpi title="Orders paid" value={String(data.kpis.ordersPaid)} />
        <Kpi title="Tickets sold" value={String(data.kpis.ticketsSold)} />
        <Kpi title="Check-ins" value={String(data.kpis.checkins)} />
        <Kpi title="Reservas activas" value={String(data.kpis.reservationsActive)} />
        <Kpi title="Late review" value={String(data.kpis.latePaymentReviewRequired)} tone={data.kpis.latePaymentReviewRequired > 0 ? "danger" : "normal"} />
      </div>

      <div style={{ width: "100%", height: 300, border: "1px solid #ddd", borderRadius: 8, padding: 8 }}>
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

      <section>
        <h3>Por TicketType</h3>
        <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th align="left">TicketType</th><th align="left">Precio</th><th align="left">Quota</th><th align="left">Sold</th><th align="left">CheckedIn</th><th align="left">Reserved</th><th align="left">Available</th>
            </tr>
          </thead>
          <tbody>
            {data.byTicketType.map((t) => (
              <tr key={t.ticketTypeId} style={{ borderTop: "1px solid #ddd" }}>
                <td>{t.name}</td><td>{cents(t.priceCents)}</td><td>{t.quota}</td><td>{t.sold}</td><td>{t.checkedIn}</td><td>{t.reservedActive}</td><td>{t.available}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Recent scans</h3>
        <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
          <thead><tr><th align="left">When</th><th align="left">Result</th><th align="left">Reason</th><th align="left">Gate</th><th align="left">By</th></tr></thead>
          <tbody>
            {data.recentScans.length === 0 ? <tr><td colSpan={5}>Sin scans</td></tr> : data.recentScans.map((s) => (
              <tr key={s.id} style={{ borderTop: "1px solid #ddd" }}>
                <td>{new Date(s.scannedAt).toLocaleString()}</td><td>{s.result}</td><td>{s.reason ?? "-"}</td><td>{s.gate ?? "-"}</td><td>{s.scannedByEmail ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3>Alerts</h3>
        <ul>
          <li>Late payment review required: {data.alerts.latePaymentReviewRequired}</li>
          <li>Recent email failures: {data.alerts.recentEmailFailures}</li>
        </ul>
      </section>

      <section>
        <h3>Activity feed</h3>
        <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
          <thead><tr><th align="left">When</th><th align="left">Type</th><th align="left">Actor</th><th align="left">Aggregate</th></tr></thead>
          <tbody>
            {data.activity.length === 0 ? <tr><td colSpan={4}>Sin activity</td></tr> : data.activity.map((a) => (
              <tr key={a.id} style={{ borderTop: "1px solid #ddd" }}>
                <td>{new Date(a.occurredAt).toLocaleString()}</td><td>{a.type}</td><td>{a.actorType}:{a.actorId ?? "-"}</td><td>{a.aggregateType}:{a.aggregateId}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Kpi({ title, value, tone = "normal" }: { title: string; value: string; tone?: "normal" | "danger" }) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: tone === "danger" ? "#fee2e2" : "#fff" }}>
      <small>{title}</small>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
