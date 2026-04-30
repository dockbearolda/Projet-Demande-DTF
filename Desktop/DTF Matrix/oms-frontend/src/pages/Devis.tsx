/**
 * Liste des devis (étape 5A).
 *
 * Affiche les devis enregistrés via Devis Flash v2. Filtre par statut,
 * tri par date DESC. Les actions de sortie (Mail, WhatsApp, PDF, CSV,
 * Mettre en attente) seront ajoutées à l'étape 5B.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Filter, Plus } from "lucide-react";
import {
  useQuotes,
  useUpdateQuoteStatus,
  type QuoteStatus,
} from "@/hooks/useQuotes";
import { useToast } from "@/components/Toast";

const EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
});
const DATE = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Brouillon",
  on_hold: "En attente",
  sent: "Envoyé",
  converted: "Converti",
};

const STATUS_TONE: Record<
  QuoteStatus,
  { bg: string; fg: string; border: string }
> = {
  draft: {
    bg: "rgba(74,98,116,0.08)",
    fg: "var(--fg-2)",
    border: "rgba(74,98,116,0.15)",
  },
  on_hold: {
    bg: "rgba(217,177,32,0.14)",
    fg: "var(--accent-warning, #b45309)",
    border: "rgba(180,83,9,0.30)",
  },
  sent: {
    bg: "rgba(56,142,60,0.14)",
    fg: "#1f6e26",
    border: "rgba(56,142,60,0.30)",
  },
  converted: {
    bg: "rgba(74,98,116,0.14)",
    fg: "var(--brand-duck-500)",
    border: "rgba(74,98,116,0.30)",
  },
};

const STATUS_FILTERS: Array<{ value: QuoteStatus | "all"; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "draft", label: "Brouillons" },
  { value: "on_hold", label: "En attente" },
  { value: "sent", label: "Envoyés" },
  { value: "converted", label: "Convertis" },
];

export function DevisPage() {
  const [filter, setFilter] = useState<QuoteStatus | "all">("all");
  const { data, isLoading } = useQuotes(filter === "all" ? undefined : filter);
  const updateStatus = useUpdateQuoteStatus();
  const toast = useToast();

  const quotes = useMemo(() => data ?? [], [data]);

  async function handleHold(id: string, ref: string) {
    try {
      await updateStatus.mutateAsync({ id, status: "on_hold" });
      toast.show(`Devis ${ref} mis en attente.`, "info");
    } catch {
      toast.show("Impossible de mettre le devis en attente.", "error");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "var(--brand-duck-500)",
            color: "var(--fg-on-primary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <FileText size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 700,
              color: "var(--fg-1)",
              letterSpacing: "-0.01em",
            }}
          >
            Devis
          </h1>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 12.5,
              color: "var(--fg-3)",
            }}
          >
            Tous les devis enregistrés depuis Devis Flash. Référence et
            montant figés au moment de la sauvegarde.
          </p>
        </div>
        <Link
          to="/flash-devis"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--brand-duck-500)",
            background: "var(--brand-duck-500)",
            color: "var(--fg-on-primary)",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <Plus size={14} />
          Nouveau devis
        </Link>
      </header>

      {/* Filtres */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <Filter size={13} aria-hidden="true" style={{ color: "var(--fg-3)" }} />
        {STATUS_FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              aria-pressed={active}
              style={{
                padding: "4px 12px",
                borderRadius: 999,
                border: `1px solid ${
                  active ? "var(--brand-duck-500)" : "rgba(74,98,116,0.18)"
                }`,
                background: active ? "var(--brand-duck-500)" : "#fff",
                color: active ? "var(--fg-on-primary)" : "var(--fg-2)",
                fontSize: 11.5,
                fontWeight: active ? 600 : 500,
                cursor: "pointer",
                transition: "all 120ms ease",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Tableau */}
      {isLoading ? (
        <div style={{ padding: 24, color: "var(--fg-3)" }}>Chargement…</div>
      ) : quotes.length === 0 ? (
        <div
          style={{
            padding: "48px 16px",
            textAlign: "center",
            border: "1px dashed rgba(74,98,116,0.20)",
            borderRadius: 12,
            background: "rgba(244,244,242,0.5)",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-2)" }}>
            Aucun devis pour ce filtre.
          </div>
          <div
            style={{ fontSize: 12.5, color: "var(--fg-3)", marginTop: 4 }}
          >
            Crée ton premier devis depuis « Flash Devis (v2) ».
          </div>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid rgba(74,98,116,0.10)",
            borderRadius: 12,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr
                style={{
                  background: "rgba(244,244,242,0.6)",
                  borderBottom: "1px solid rgba(74,98,116,0.10)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--fg-4)",
                  textAlign: "left",
                }}
              >
                <Th>Référence</Th>
                <Th>Client</Th>
                <Th>Modèle</Th>
                <Th align="right">Qté</Th>
                <Th align="right">Total TTC</Th>
                <Th>Statut</Th>
                <Th>Date</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const tone = STATUS_TONE[q.status];
                return (
                  <tr
                    key={q.id}
                    style={{
                      borderBottom: "1px solid rgba(74,98,116,0.06)",
                      fontSize: 13,
                    }}
                  >
                    <Td>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-mono, ui-monospace, monospace)",
                          fontWeight: 700,
                          color: "var(--fg-1)",
                        }}
                      >
                        {q.reference}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 600, color: "var(--fg-1)" }}>
                        {q.client.nom}
                      </div>
                      {q.client.email && (
                        <div style={{ fontSize: 11.5, color: "var(--fg-3)" }}>
                          {q.client.email}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span
                        style={{
                          fontFamily:
                            "var(--font-mono, ui-monospace, monospace)",
                          color: "var(--fg-2)",
                        }}
                      >
                        {q.model_ref}
                      </span>
                    </Td>
                    <Td align="right">{q.quantity}</Td>
                    <Td align="right">
                      <span style={{ fontWeight: 700, color: "var(--fg-1)" }}>
                        {EUR.format(q.snapshot_total_ttc)}
                      </span>
                    </Td>
                    <Td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 10.5,
                          fontWeight: 700,
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          background: tone.bg,
                          color: tone.fg,
                          border: `1px solid ${tone.border}`,
                        }}
                      >
                        {STATUS_LABEL[q.status]}
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: "var(--fg-2)" }}>
                        {DATE.format(new Date(q.created_at))}
                      </span>
                    </Td>
                    <Td align="right">
                      {q.status === "draft" && (
                        <button
                          type="button"
                          onClick={() => handleHold(q.id, q.reference)}
                          disabled={updateStatus.isPending}
                          style={{
                            padding: "4px 10px",
                            borderRadius: 6,
                            border: "1px solid rgba(74,98,116,0.18)",
                            background: "#fff",
                            fontSize: 11.5,
                            color: "var(--fg-2)",
                            cursor: "pointer",
                          }}
                        >
                          Mettre en attente
                        </button>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "12px 14px",
        textAlign: align ?? "left",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
