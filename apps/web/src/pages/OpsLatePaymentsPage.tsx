import { type CSSProperties, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";

type Organizer = { id: string; name: string; slug: string };

type LatePaymentStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "REFUND_REQUESTED" | "REFUNDED";
type ResolveAction = "ACCEPT" | "REJECT" | "REFUND_REQUESTED" | "REFUNDED";

type LatePaymentCase = {
  id: string;
  status: LatePaymentStatus;
  provider: string;
  orderId: string;
  createdAt: string;
  detectedAt: string;
  version: number;
  resolutionNotes?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: string | null;
  outbox?: {
    pendingEvents: number;
    lastRetryCount: number;
    lastError: string | null;
  };
};

const ALL_STATUSES: LatePaymentStatus[] = ["PENDING", "ACCEPTED", "REJECTED", "REFUND_REQUESTED", "REFUNDED"];

function toIsoStart(dateValue: string) {
  if (!dateValue) return undefined;
  return new Date(`${dateValue}T00:00:00`).toISOString();
}

function toIsoEnd(dateValue: string) {
  if (!dateValue) return undefined;
  return new Date(`${dateValue}T23:59:59.999`).toISOString();
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function statusBadgeStyle(status: LatePaymentStatus): CSSProperties {
  const palette: Record<LatePaymentStatus, string> = {
    PENDING: "#a16207",
    ACCEPTED: "#166534",
    REJECTED: "#991b1b",
    REFUND_REQUESTED: "#7e22ce",
    REFUNDED: "#1d4ed8"
  };

  return {
    display: "inline-block",
    borderRadius: 999,
    padding: "2px 8px",
    fontSize: 12,
    fontWeight: 600,
    background: "#f5f5f5",
    color: palette[status]
  };
}

function truncate(value: string, max = 48) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function outboxWarningBadge(pendingEvents: number, lastRetryCount: number): string | null {
  if (pendingEvents > 0) return `⚠ pending:${pendingEvents}`;
  if (lastRetryCount > 0) return `⚠ retries:${lastRetryCount}`;
  return null;
}

export function OpsLatePaymentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LatePaymentStatus>("PENDING");
  const [provider, setProvider] = useState("");
  const [orderId, setOrderId] = useState("");
  const [selectedCase, setSelectedCase] = useState<LatePaymentCase | null>(null);
  const [resolutionAction, setResolutionAction] = useState<ResolveAction>("ACCEPT");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  }, []);

  const defaultTo = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);

  const organizersQuery = useQuery({
    queryKey: ["organizers"],
    queryFn: () => api<Organizer[]>("/organizers")
  });

  const organizerId = organizersQuery.data?.[0]?.id;

  const queryString = useMemo(() => {
    if (!organizerId) return "";
    const qs = new URLSearchParams({
      organizerId,
      status,
      limit: "200"
    });

    if (provider.trim()) qs.set("provider", provider.trim());
    if (orderId.trim()) qs.set("orderId", orderId.trim());

    const from = toIsoStart(fromDate);
    const to = toIsoEnd(toDate);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    return qs.toString();
  }, [organizerId, status, provider, orderId, fromDate, toDate]);

  const casesQuery = useQuery({
    queryKey: ["late-payment-cases", queryString],
    enabled: Boolean(queryString),
    queryFn: () => api<LatePaymentCase[]>(`/late-payment-cases?${queryString}`)
  });

  const refreshCaseAcrossStatuses = async (target: LatePaymentCase) => {
    if (!organizerId) return null;

    for (const statusTry of ALL_STATUSES) {
      const qs = new URLSearchParams({
        organizerId,
        status: statusTry,
        limit: "200"
      });

      qs.set("orderId", target.orderId);

      const found = await api<LatePaymentCase[]>(`/late-payment-cases?${qs.toString()}`);
      const match = found.find((item) => item.id === target.id);
      if (match) return match;
    }

    return null;
  };

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCase) return;

      const notesRequired = resolutionAction === "REFUND_REQUESTED" || resolutionAction === "REFUNDED";
      if (notesRequired && resolutionNotes.trim().length < 10) {
        throw new Error("resolutionNotes es obligatoria (mínimo 10 caracteres) para REFUND_REQUESTED/REFUNDED");
      }

      return api<LatePaymentCase>(`/late-payment-cases/${selectedCase.id}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          action: resolutionAction,
          resolutionNotes: resolutionNotes.trim() ? resolutionNotes.trim() : undefined
        })
      });
    },
    onSuccess: async () => {
      setFeedback("Caso resuelto correctamente");
      setResolutionNotes("");
      await qc.invalidateQueries({ queryKey: ["late-payment-cases"] });
      setSelectedCase(null);
    },
    onError: async (err) => {
      if (err instanceof ApiError && err.status === 409 && selectedCase) {
        const fresh = await refreshCaseAcrossStatuses(selectedCase);
        await qc.invalidateQueries({ queryKey: ["late-payment-cases"] });
        setSelectedCase(fresh);
        setFeedback("Conflicto 409: otro operador lo modificó. Refrescamos el caso.");
        return;
      }

      setFeedback(err instanceof Error ? err.message : "Error al resolver caso");
    }
  });

  if (!localStorage.getItem("token")) {
    return <div>Ruta protegida: iniciá sesión para acceder.</div>;
  }

  if (casesQuery.error instanceof ApiError && casesQuery.error.status === 403) {
    return <div>Acceso denegado. Esta ruta requiere rol ops/admin para el organizador.</div>;
  }

  return (
    <div>
      <h2>Ops · Late Payment Cases</h2>

      {feedback ? <p>{feedback}</p> : null}

      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(6, minmax(120px, 1fr))", marginBottom: 12 }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as LatePaymentStatus)}>
          {ALL_STATUSES.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>

        <input placeholder="provider" value={provider} onChange={(e) => setProvider(e.target.value)} />
        <input placeholder="orderId" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
        <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        <button onClick={() => casesQuery.refetch()}>Aplicar filtros</button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <small>Organizador activo: {organizersQuery.data?.[0]?.name ?? "-"}</small>
      </div>

      <table width="100%" cellPadding={6} style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">status</th>
            <th align="left">provider</th>
            <th align="left">orderId</th>
            <th align="left">caseId</th>
            <th align="left">createdAt</th>
            <th align="left">pendingEvents</th>
            <th align="left">lastRetryCount</th>
            <th align="left">lastError</th>
            <th align="left">warning</th>
            <th align="left">acción</th>
          </tr>
        </thead>
        <tbody>
          {(casesQuery.data ?? []).map((item) => {
            const pendingEvents = item.outbox?.pendingEvents ?? 0;
            const lastRetryCount = item.outbox?.lastRetryCount ?? 0;
            const lastError = item.outbox?.lastError ?? null;
            const warning = outboxWarningBadge(pendingEvents, lastRetryCount);

            return (
              <tr key={item.id} style={{ borderTop: "1px solid #ddd" }}>
                <td><span style={statusBadgeStyle(item.status)}>{item.status}</span></td>
                <td>{item.provider}</td>
                <td>{item.orderId}</td>
                <td>{item.id}</td>
                <td>{formatDate(item.createdAt)}</td>
                <td>{pendingEvents}</td>
                <td>{lastRetryCount}</td>
                <td title={lastError ?? ""}>
                  {lastError ? truncate(lastError) : "-"}
                  {lastError ? (
                    <button style={{ marginLeft: 6 }} onClick={() => navigator.clipboard.writeText(lastError)}>copy</button>
                  ) : null}
                </td>
                <td>{warning ?? "-"}</td>
                <td><button onClick={() => setSelectedCase(item)}>Ver detalle</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {selectedCase ? (
        <div style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <h3>Detalle · {selectedCase.id}</h3>
          <pre style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(selectedCase, null, 2)}</pre>

          <p><strong>Audit</strong></p>
          <ul>
            <li>resolvedBy: {selectedCase.resolvedBy ?? "-"}</li>
            <li>resolvedAt: {formatDate(selectedCase.resolvedAt)}</li>
            <li>notes: {selectedCase.resolutionNotes ?? "-"}</li>
          </ul>

          <div style={{ display: "grid", gap: 8, maxWidth: 720 }}>
            <select value={resolutionAction} onChange={(e) => setResolutionAction(e.target.value as ResolveAction)}>
              <option value="ACCEPT">ACCEPT</option>
              <option value="REJECT">REJECT</option>
              <option value="REFUND_REQUESTED">REFUND_REQUESTED</option>
              <option value="REFUNDED">REFUNDED</option>
            </select>
            <textarea
              rows={4}
              placeholder="resolutionNotes"
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  if (window.confirm("¿Confirmar resolución del caso?")) resolveMutation.mutate();
                }}
                disabled={resolveMutation.isPending}
              >
                Resolver
              </button>
              <button onClick={() => setSelectedCase(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
