import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { can, type MinimalAdminAuthorizationContext } from "../lib/adminAccess";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

type ArtistSummary = {
  id: string;
  slug: string;
  displayName: string;
  status: "active" | "inactive";
};

type LinkedArtist = {
  id: string;
  eventId: string;
  artistId: string;
  billingOrder: number | null;
  billingLabel: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  artist: {
    id: string;
    slug: string;
    displayName: string;
    status: "active" | "inactive";
    legalOrFullName: string | null;
    shortBio: string | null;
    profileImageUrl: string | null;
    genreTagsJson: string[] | null;
    externalLinksJson: Array<{ platform: string; url: string }> | null;
    createdAt: string;
    updatedAt: string;
  };
};

type EventArtistsResponse = {
  eventId: string;
  artists: LinkedArtist[];
};

type ArtistLinkagePanelProps = {
  eventId: string;
  authorization: MinimalAdminAuthorizationContext;
};

type EditableLinkState = {
  billingOrder: string;
  billingLabel: string;
  isPrimary: boolean;
};

function toEditable(link: LinkedArtist): EditableLinkState {
  return {
    billingOrder: link.billingOrder == null ? "" : String(link.billingOrder),
    billingLabel: link.billingLabel ?? "",
    isPrimary: link.isPrimary
  };
}

function normalizeOrder(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.parseInt(trimmed, 10);
}

export function EventArtistLinkagePanel({ eventId, authorization }: ArtistLinkagePanelProps) {
  const qc = useQueryClient();
  const canManage = can(authorization, "manageTicketTypes");
  const [query, setQuery] = useState("");
  const [selectedArtistId, setSelectedArtistId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, EditableLinkState>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const linkedArtistsQuery = useQuery({
    queryKey: ["event-artists", eventId],
    queryFn: () => api<EventArtistsResponse>(`/events/${eventId}/artists`)
  });

  const artistsQuery = useQuery({
    queryKey: ["artist-options", query],
    queryFn: () => api<ArtistSummary[]>(`/artists?limit=100${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`)
  });

  const linkedArtists = linkedArtistsQuery.data?.artists ?? [];

  const linkedArtistIds = useMemo(() => new Set(linkedArtists.map((link) => link.artistId)), [linkedArtists]);

  const candidateArtists = useMemo(
    () => (artistsQuery.data ?? []).filter((artist) => !linkedArtistIds.has(artist.id)),
    [artistsQuery.data, linkedArtistIds]
  );

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["event-artists", eventId] });
    await qc.invalidateQueries({ queryKey: ["artist-options"] });
  };

  const createLink = useMutation({
    mutationFn: async () => {
      if (!selectedArtistId) throw new Error("Seleccioná un artista existente antes de vincular.");
      return api(`/events/${eventId}/artists`, {
        method: "POST",
        body: JSON.stringify({ artistId: selectedArtistId })
      });
    },
    onSuccess: async () => {
      setMessage("Artista vinculado al evento.");
      setErrorMessage(null);
      setSelectedArtistId("");
      await refresh();
    },
    onError: async (error: any) => {
      setMessage(null);
      setErrorMessage(error?.message ?? "No se pudo vincular el artista.");
      await refresh();
    }
  });

  const updateLink = useMutation({
    mutationFn: async ({ artistId, payload }: { artistId: string; payload: Record<string, unknown> }) =>
      api(`/events/${eventId}/artists/${artistId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      }),
    onSuccess: async (_data, variables) => {
      setMessage("Vínculo actualizado.");
      setErrorMessage(null);
      setDrafts((current) => {
        const copy = { ...current };
        delete copy[variables.artistId];
        return copy;
      });
      await refresh();
    },
    onError: async (error: any) => {
      setMessage(null);
      setErrorMessage(error?.message ?? "No se pudo actualizar el vínculo.");
      await refresh();
    }
  });

  const deleteLink = useMutation({
    mutationFn: async (artistId: string) =>
      api(`/events/${eventId}/artists/${artistId}`, {
        method: "DELETE"
      }),
    onSuccess: async () => {
      setMessage("Artista desvinculado del evento.");
      setErrorMessage(null);
      await refresh();
    },
    onError: async (error: any) => {
      setMessage(null);
      setErrorMessage(error?.message ?? "No se pudo desvincular el artista.");
      await refresh();
    }
  });

  const getDraft = (link: LinkedArtist) => drafts[link.artistId] ?? toEditable(link);

  const handleDraftChange = (artistId: string, next: EditableLinkState) => {
    setDrafts((current) => ({ ...current, [artistId]: next }));
  };

  const handleSave = async (link: LinkedArtist) => {
    const draft = getDraft(link);
    const payload: Record<string, unknown> = {};
    const nextOrder = normalizeOrder(draft.billingOrder);
    const currentOrder = link.billingOrder;
    if (nextOrder !== currentOrder) payload.billingOrder = nextOrder;

    const nextLabel = draft.billingLabel.trim();
    const normalizedLabel = nextLabel ? nextLabel : null;
    if (normalizedLabel !== link.billingLabel) payload.billingLabel = normalizedLabel;

    if (draft.isPrimary !== link.isPrimary) payload.isPrimary = draft.isPrimary;

    if (Object.keys(payload).length === 0) {
      setMessage("No hay cambios para guardar en este vínculo.");
      setErrorMessage(null);
      return;
    }

    await updateLink.mutateAsync({ artistId: link.artistId, payload });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Artistas vinculados al evento</h3>
          <p className="mt-1 text-sm text-slate-600">
            Surface mínima de backoffice para mantener el lineup del evento sin mezclar catálogo editorial público.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${canManage ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {canManage ? "Editable" : "Solo lectura"}
        </span>
      </div>

      {message ? <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p> : null}
      {errorMessage ? <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{errorMessage}</p> : null}

      <Card className="mt-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <label className="text-sm text-slate-700">
            Buscar artista existente
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Nombre o slug"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              disabled={!canManage}
            />
          </label>

          <label className="text-sm text-slate-700">
            Seleccionar artista
            <select
              value={selectedArtistId}
              onChange={(e) => setSelectedArtistId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              disabled={!canManage || artistsQuery.isLoading}
            >
              <option value="">{artistsQuery.isLoading ? "Cargando artistas..." : candidateArtists.length === 0 ? "No hay artistas disponibles" : "Elegí un artista"}</option>
              {candidateArtists.map((artist) => (
                <option key={artist.id} value={artist.id}>{artist.displayName} ({artist.slug})</option>
              ))}
            </select>
          </label>

          <div className="flex items-end">
            <Button disabled={!canManage || !selectedArtistId || createLink.isPending} onClick={() => void createLink.mutateAsync()}>
              Vincular artista
            </Button>
          </div>
        </div>

        {!artistsQuery.isLoading && candidateArtists.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            No hay artistas existentes disponibles para vincular con el filtro actual.
          </p>
        ) : null}
      </Card>

      <div className="mt-5 space-y-3">
        {linkedArtistsQuery.isLoading ? <p className="text-sm text-slate-500">Cargando vínculos del evento...</p> : null}
        {!linkedArtistsQuery.isLoading && linkedArtists.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-600">Este evento todavía no tiene artistas vinculados.</p>
          </Card>
        ) : null}

        {linkedArtists.map((link) => {
          const draft = getDraft(link);
          return (
            <Card key={link.id}>
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold text-slate-900">{link.artist.displayName}</h4>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">/{link.artist.slug}</span>
                    {link.isPrimary ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">Primary</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">Status del artista: {link.artist.status}</p>
                </div>

                <div className="grid gap-3 md:grid-cols-3 xl:min-w-[620px]">
                  <label className="text-sm text-slate-700">
                    Billing order
                    <input
                      value={draft.billingOrder}
                      onChange={(e) => handleDraftChange(link.artistId, { ...draft, billingOrder: e.target.value })}
                      inputMode="numeric"
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                      disabled={!canManage || updateLink.isPending}
                    />
                  </label>

                  <label className="text-sm text-slate-700">
                    Billing label
                    <input
                      value={draft.billingLabel}
                      onChange={(e) => handleDraftChange(link.artistId, { ...draft, billingLabel: e.target.value })}
                      className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
                      disabled={!canManage || updateLink.isPending}
                    />
                  </label>

                  <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={draft.isPrimary}
                      onChange={(e) => handleDraftChange(link.artistId, { ...draft, isPrimary: e.target.checked })}
                      disabled={!canManage || updateLink.isPending}
                    />
                    Marcar como primary
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 text-sm">
                <Button disabled={!canManage || updateLink.isPending} onClick={() => void handleSave(link)}>
                  Guardar vínculo
                </Button>
                <button
                  type="button"
                  onClick={() => handleDraftChange(link.artistId, toEditable(link))}
                  disabled={!canManage}
                  className="rounded-md border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Revertir borrador
                </button>
                <button
                  type="button"
                  onClick={() => void deleteLink.mutateAsync(link.artistId)}
                  disabled={!canManage || deleteLink.isPending}
                  className="rounded-md border border-rose-300 px-3 py-2 text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Desvincular
                </button>
              </div>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
