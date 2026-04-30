import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Order } from "@/lib/types";

type SessionEntry = { order: Order; productLabel: string; totalQty: number };
import { useCreateOrder, useUpdateOrderStatus } from "@/hooks/useOrders";
import { useLinkBat, useUploadBat } from "@/hooks/useBats";
import { useSearchOrCreateClient } from "@/hooks/useCreateClientOrSearch";
import { useSupplierCatalog } from "@/hooks/useSupplierCatalog";
import { useToast } from "@/components/Toast";
import { generateReference } from "@/lib/utils";
import {
  selectHeader,
  selectLine,
  selectLines,
  selectExpandedLineId,
  selectSecteur,
  selectStep,
  useNewOrderStore,
} from "./store";
import { useAutoSaveDraft, useAutoSaveStatus } from "./useAutoSaveDraft";
import { useDeleteDraft } from "@/hooks/useDrafts";
import {
  isClassicLine,
  isTextileLine,
  type ClassicSecteur,
  type FieldErrorKey,
  type OrderLine,
  type ValidationResult,
} from "./types";
import { type ProductCategoryConfig, PRODUCT_CATEGORIES } from "./constants";
import { OrderHeaderFields } from "./components/OrderHeaderFields";
import { Section, SegmentedControl } from "./components/primitives";
import { StandardOrderFields } from "./components/StandardOrderFields";
import { SourcingFields } from "./components/SourcingFields";
import { TextileOrderFields } from "./components/TextileOrderFields";
import { LeadCaptureModal } from "./components/LeadCaptureModal";
import { ProductCategoryPicker } from "./components/ProductCategoryPicker";
import { QuoteHeader } from "./components/QuoteHeader";
import { ReferenceRow } from "./components/ReferenceRow";
import { BatDrawerPortal } from "./components/BatDrawerPortal";
import { OrderSidebar } from "./components/OrderSidebar";
import { OrderLineCardCollapsed, describeLine } from "./components/OrderLineCardCollapsed";
import { AccordionItem } from "./components/Accordion";
import { Plus } from "lucide-react";
import { OrderConfirmModal } from "./components/OrderConfirmModal";
import { FormWizard } from "./components/FormWizard";
import { SubmissionSummary } from "./components/SubmissionSummary";
import { computeTotals } from "./pricing";
import { getQuoteId, resetQuoteId } from "./quoteId";
import { ShortcutsHelpOverlay } from "@/components/ui/ShortcutsHelpOverlay";
import { getCurrentUser } from "@/lib/currentUser";
import { logger } from "@/lib/logger";

export interface OrderFormProps {
  onCreated?: (orderId: string) => void;
  onStudioBat?: () => void;
  /** Called from the SubmissionSummary "Préparer le BAT maintenant" action. */
  onStudioBatForOrder?: (orderId: string) => void;
  onCancel?: () => void;
}

type FlowStep = "form" | "confirm" | "lead" | "cancel";
type PendingAction = "submit" | null;

export function OrderForm({
  onCreated,
  onStudioBatForOrder,
  onCancel,
}: OrderFormProps) {
  const header = useNewOrderStore(selectHeader);
  const line = useNewOrderStore(selectLine);
  const lines = useNewOrderStore(selectLines);
  const expandedLineId = useNewOrderStore(selectExpandedLineId);
  const secteur = useNewOrderStore(selectSecteur);
  const currentStep = useNewOrderStore(selectStep);

  const setHeader = useNewOrderStore((s) => s.setHeader);
  const switchSecteur = useNewOrderStore((s) => s.switchSecteur);
  const setStep = useNewOrderStore((s) => s.setStep);
  const validateStep = useNewOrderStore((s) => s.validateStep);
  const reset = useNewOrderStore((s) => s.reset);
  const clearLine = useNewOrderStore((s) => s.clearLine);
  const collapseAll = useNewOrderStore((s) => s.collapseAll);
  const expandLine = useNewOrderStore((s) => s.expandLine);
  const removeLine = useNewOrderStore((s) => s.removeLine);
  const duplicateLine = useNewOrderStore((s) => s.duplicateLine);

  // Auto-save (5 s debounce after every meaningful change). The hook owns the
  // subscription + indicator state; nothing else to do here.
  useAutoSaveDraft();
  const deleteDraft = useDeleteDraft();
  const resetSaveStatus = useAutoSaveStatus((s) => s.set);

  const createOrder = useCreateOrder();
  const uploadBat = useUploadBat();
  const linkBat = useLinkBat();
  const updateStatus = useUpdateOrderStatus();
  const searchClient = useSearchOrCreateClient();
  const toast = useToast();

  // Pré-charge le catalogue fournisseur dès l'arrivée sur le formulaire :
  // le hook enregistre tous les modèles dans le runtime catalog et le picker
  // (et toute résolution de modelId hérité) trouve ses données instantanément.
  useSupplierCatalog();

  // Derive selectedCategory from current line so it survives reload + step changes
  const selectedCategory = useMemo<ProductCategoryConfig | null>(() => {
    if (!line) return null;
    if (isTextileLine(line)) {
      return PRODUCT_CATEGORIES.find((c) => c.id === "textile") ?? null;
    }
    // Sourcing spécial — détecté avant les autres catégories classiques pour
    // que la ligne reste reconnue comme "Hors catalogue" même si son secteur
    // est "Autres" (qui matcherait sinon une autre catégorie par défaut).
    if (line.isSourcingRequired) {
      return PRODUCT_CATEGORIES.find((c) => c.id === "sourcing-special") ?? null;
    }
    // classic — best-effort match by autoSecteur, fallback to "goodies"
    const exact = PRODUCT_CATEGORIES.find(
      (c) =>
        c.autoSecteur === line.secteur &&
        c.id !== "goodies" &&
        c.id !== "sourcing-special",
    );
    if (exact) return exact;
    return PRODUCT_CATEGORIES.find((c) => c.id === "goodies") ?? null;
  }, [line]);

  const [errors, setErrors] = useState<ValidationResult["fieldErrors"]>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>("form");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  /** Commandes créées durant cette session client (accumulées jusqu'au reset complet). */
  const [sessionEntries, setSessionEntries] = useState<SessionEntry[]>([]);
  /** Snapshot kept after successful creation to render the SubmissionSummary
   *  without redirecting. The store is reset, but we need stable values for the
   *  recap (client name, qty, category) to survive after reset. */
  const [createdOrder, setCreatedOrder] = useState<Order | null>(null);
  const [submissionSnapshot, setSubmissionSnapshot] = useState<{
    clientName: string;
    productLabel: string;
    totalQty: number;
    isUrgent: boolean;
    categoryId: ProductCategoryConfig["id"] | null;
  } | null>(null);

  /** Re-validate a single header field on blur — only the blurred field's
   *  error is updated, so untouched fields don't surface errors prématurées.
   *  Le client est validé à l'étape 1 du wizard ; l'opérateur est défini par
   *  la session ouverte, donc plus rien à valider côté UI. */
  const handleHeaderBlur = useCallback(
    (field: "clientNom") => {
      const v = validateStep(1);
      setErrors((prev) => ({ ...prev, [field]: v.fieldErrors[field] }));
    },
    [validateStep],
  );

  const setClassicSourcingRequired = useNewOrderStore(
    (s) => s.setClassicSourcingRequired,
  );

  const handleCategorySelect = useCallback(
    (cat: ProductCategoryConfig) => {
      if (cat.id === "sourcing-special") {
        // Crée d'abord la ligne classique sur le secteur "Autres" (auto), puis
        // active le mode sourcing — l'ordre garantit que setClassicSourcingRequired
        // trouve une ligne classique dépliée à patcher.
        switchSecteur(cat.autoSecteur ?? "Autres");
        setClassicSourcingRequired(true);
        return;
      }
      if (cat.autoSecteur) {
        switchSecteur(cat.autoSecteur);
        setClassicSourcingRequired(false);
      } else {
        clearLine();
      }
    },
    [switchSecteur, clearLine, setClassicSourcingRequired],
  );

  /**
   * Après une sélection de catégorie au clavier, focus la prochaine section
   * d'interaction sur l'étape 1 (genre textile, machine goodies, ou produit).
   */
  const focusNextStep1Section = useCallback(() => {
    // Cherche dans l'ordre: bouton genre HOMME, segmented "Machine", input produit, premier input qty.
    const candidates: (HTMLElement | null)[] = [
      document.querySelector<HTMLElement>('[role="radio"][aria-checked="true"][aria-keyshortcuts="H"]'),
      document.querySelector<HTMLElement>('[aria-keyshortcuts="H"]'),
      document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Machine"] [role="radio"]'),
      document.querySelector<HTMLElement>('input[id^="field-produit"]'),
      document.querySelector<HTMLElement>('[data-qty-grid] input[type="number"]'),
    ];
    for (const el of candidates) {
      if (el) {
        el.focus();
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
  }, []);

  const categoryProducts = useMemo(() => {
    if (!selectedCategory) return undefined;
    return selectedCategory.produits;
  }, [selectedCategory]);

  /**
   * Build the multi-reference payload sent to POST /orders.
   *
   * One backend OrderLine per draft line — variants carry the (color × size ×
   * qty) breakdown for textiles, or a single blanket variant for classic
   * lines. Empty/invalid lines are skipped so the user can keep an in-progress
   * line in the draft without aborting the submit.
   */
  const buildOrderLinesPayload = useCallback(
    (
      records: ReadonlyArray<{ id: string; line: OrderLine }>,
    ): Array<Record<string, unknown>> => {
      const out: Array<Record<string, unknown>> = [];
      records.forEach((r, idx) => {
        const l = r.line;
        if (isClassicLine(l)) {
          const produit = l.customProduit?.trim() || l.produit;
          if (!produit || !l.quantity) return;
          const isSourcing = !!l.isSourcingRequired;
          out.push({
            ligne_numero: idx + 1,
            position: idx,
            secteur: l.secteur,
            product_type: "OTHER",
            produit,
            quantite: l.quantity,
            prix_unitaire: l.prixUnitaire ?? 0,
            notes: l.notes ?? null,
            variants: [
              {
                qty: l.quantity,
                unit_price_ht: l.prixUnitaire ?? 0,
                position: 0,
              },
            ],
            // Champs sourcing — uniquement quand la ligne est marquée hors
            // catalogue. Le backend auto-promeut le statut commande à
            // EN_ATTENTE_SOURCING dès qu'au moins une ligne porte le flag.
            is_sourcing_required: isSourcing,
            sourcing_description: isSourcing
              ? (l.sourcingDescription ?? null)
              : null,
            sourcing_budget_estime: isSourcing
              ? (l.sourcingBudgetEstime ?? null)
              : null,
          });
          return;
        }
        if (isTextileLine(l)) {
          const items = Object.values(l.items).filter((it) => it.qty > 0);
          if (items.length === 0) return;
          const unitPrice = computeTotals(l).unitPrice;
          const totalQty = items.reduce((s, it) => s + it.qty, 0);
          const bodyPlacements = l.bodyPlacements ?? [];
          const sleeves = l.sleeveLogoPlacements ?? [];
          out.push({
            ligne_numero: idx + 1,
            position: idx,
            // Backend Secteur enum has no TEXTILES; textile decoration runs
            // through DTF — preserves legacy reporting keyed on `secteur`.
            secteur: "DTF",
            product_type: "TSHIRT",
            produit: l.modelName || "Textile",
            quantite: totalQty,
            prix_unitaire: unitPrice,
            notes: items.some((it) => it.isPlaceholder)
              ? "devis rapide (taille à préciser)"
              : null,
            options: {
              model_id: l.modelId,
              target: l.target,
              body_placements: bodyPlacements,
              sleeve_placements: sleeves,
            },
            variants: items.map((it, i) => ({
              color: it.isPlaceholder ? null : it.color,
              size: it.isPlaceholder ? null : it.size,
              qty: it.qty,
              unit_price_ht: unitPrice,
              position: i,
            })),
            artworks: [
              ...bodyPlacements.map((p) => ({ side: "front", placement: p })),
              ...sleeves.map((p) => ({ side: "sleeve", placement: p })),
            ],
          });
          return;
        }
      });
      return out;
    },
    [],
  );

  /** Legacy single-line builder kept for the old call sites that still pass
   *  one line directly. Forwards to the multi-reference builder so output is
   *  consistent. */
  const buildLinesPayload = useCallback(
    (l: OrderLine) => buildOrderLinesPayload([{ id: "single", line: l }]),
    [buildOrderLinesPayload],
  );

  /** Create order in DB. Reads fresh state from store to avoid stale closures. */
  const doCreate = useCallback(
    async (clientOverride?: { name: string; phone: string }) => {
      const freshState = useNewOrderStore.getState();
      const allLines = freshState.draft.lines;
      const currentLine = selectLine(freshState);
      if (allLines.length === 0 && !currentLine) {
        setSubmitError("Aucune ligne à enregistrer — vérifiez l'étape Produit.");
        return;
      }

      setSubmitting(true);
      setSubmitError(null);
      try {
        const freshHeader = useNewOrderStore.getState().draft.header;
        const clientName = clientOverride?.name ?? freshHeader.clientNom;
        const usedHeader = clientOverride
          ? { ...freshHeader, clientNom: clientOverride.name, telephone: clientOverride.phone }
          : freshHeader;

        const clientRes = await searchClient.mutateAsync(clientName.trim());
        // Multi-reference: iterate over every drafted line. The legacy mono-
        // reference path lands here too — if `allLines` is empty but a single
        // legacy `currentLine` exists in state, fall back to it.
        const lineRecords =
          allLines.length > 0
            ? allLines
            : currentLine
            ? [{ id: "legacy", line: currentLine }]
            : [];
        const payload = {
          client_id: clientRes.id,
          reference: generateReference(),
          assigned_to: usedHeader.assignedTo || getCurrentUser() || "",
          personne_contact: usedHeader.personneContact.trim() || null,
          telephone: usedHeader.telephone.trim() || null,
          date_livraison_prevue: usedHeader.dateLivraison || null,
          is_urgent: usedHeader.isUrgent,
          notes_globales: usedHeader.notes.trim() || null,
          lines: buildOrderLinesPayload(lineRecords),
        };
        const order = await createOrder.mutateAsync(payload);

        // Upload new BAT drafts AND link reused BATs across every textile
        // line. Each color resolves to exactly one BAT — created from a draft
        // or linked from an existing BAT — depending on the section's mode.
        let anyDeferBat = false;
        for (const record of lineRecords) {
          const tl = record.line;
          if (!isTextileLine(tl)) continue;
          const modelRef = tl.modelId;
          const drafts = collectLatestBatDrafts(tl);
          const linkedColors = tl.linkedBats ?? {};

          for (const draft of drafts) {
            try {
              const file = base64ToFile(
                draft.pdfBase64,
                draft.pdfFileName,
                "application/pdf",
              );
              await uploadBat.mutateAsync({
                order_id: order.id,
                file,
                composition: draft.composition as unknown as Record<string, unknown>,
                model_reference: modelRef,
                color_id: draft.colorId,
              });
            } catch (uploadErr) {
              logger.warn(
                `BAT upload failed for line=${record.id} color=${draft.colorId} v${draft.version}`,
                uploadErr,
              );
            }
          }

          for (const [colorId, ref] of Object.entries(linkedColors)) {
            try {
              await linkBat.mutateAsync({
                source_bat_id: ref.batId,
                target_order_id: order.id,
                color_id: colorId,
                model_reference: modelRef,
              });
            } catch (linkErr) {
              logger.warn(
                `BAT link failed for line=${record.id} color=${colorId}`,
                linkErr,
              );
            }
          }

          if (tl.deferBat) anyDeferBat = true;
        }

        // Defer-BAT flow — if ANY textile line has it set, the order moves to
        // EN_ATTENTE_BAT. (Refining this per-line would require a status per
        // line, which the backend doesn't model today.)
        if (anyDeferBat) {
          try {
            await updateStatus.mutateAsync({
              id: order.id,
              statut: "EN_ATTENTE_BAT",
            });
          } catch (statusErr) {
            logger.warn("Status update to EN_ATTENTE_BAT failed", statusErr);
          }
        }

        // Close modal, clear local state, surface a toast, then redirect.
        setFlowStep("form");
        setPendingAction(null);
        setSubmitError(null);
        setCreatedOrder(null);
        setSubmissionSnapshot(null);
        setSessionEntries([]);
        // Full reset so a reload doesn't re-open the wizard for the order we
        // just created. The persisted draft on the server is also removed so
        // it doesn't reappear in the Brouillons listing.
        const submittedDraftId = useNewOrderStore.getState().draftId;
        if (submittedDraftId) {
          deleteDraft.mutate(submittedDraftId);
        }
        resetSaveStatus({ state: "idle", lastSavedAt: null, errorMessage: null });
        reset();
        resetQuoteId();

        toast.show(`Commande créée — ${order.reference}`, "success");

        // NewOrderPage wires onCreated to navigate("/orders").
        // The orders query is invalidated by useCreateOrder.onSuccess; the
        // backend orders the list by date_commande desc, so the new order
        // appears at the top of the list automatically.
        onCreated?.(order.id);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Une erreur inconnue est survenue. Vérifiez votre connexion et réessayez.";
        setSubmitError(msg);
        // Keep modal open so the user can retry without losing context.
      } finally {
        setSubmitting(false);
      }
    },
    [
      buildLinesPayload,
      createOrder,
      searchClient,
      uploadBat,
      linkBat,
      updateStatus,
      onCreated,
      reset,
      toast,
    ],
  );

  /** Step navigation: validate current step, then advance. */
  const handleRequestNext = useCallback((): boolean => {
    const v = validateStep(currentStep);
    setErrors(v.fieldErrors);
    if (!v.ok) {
      focusFirstError(
        v.fieldErrors,
        currentStep === 1
          ? ["clientNom"]
          : currentStep === 2
            ? ["secteur", "line"]
            : [],
      );
      return false;
    }
    setStep(((currentStep + 1) as 1 | 2 | 3 | 4));
    setSubmitError(null);
    return true;
  }, [currentStep, validateStep, setStep]);

  /** Étape 4 submit → ouvre le récap (filet de sécurité : on revérifie le
   *  client au cas où le store aurait été muté entre l'étape 1 et l'étape 4 ;
   *  l'opérateur vient de la session ouverte sur le poste). */
  const handleSubmitFinal = useCallback(() => {
    const v = validateStep(1);
    setErrors(v.fieldErrors);
    if (!v.ok) {
      focusFirstError(v.fieldErrors, ["clientNom"]);
      return;
    }
    setFlowStep("confirm");
  }, [validateStep]);

  /** Confirm modal → actually create order. */
  const handleConfirmCreate = useCallback(() => {
    if (!header.clientNom.trim()) {
      setPendingAction("submit");
      setFlowStep("lead");
      return;
    }
    void doCreate();
  }, [header.clientNom, doCreate]);

  const handleLeadSubmit = useCallback(
    ({ name, phone }: { name: string; phone: string }) => {
      setHeader({ clientNom: name, clientId: null, telephone: phone });
      if (pendingAction === "submit") {
        void doCreate({ name, phone });
      }
      setPendingAction(null);
    },
    [pendingAction, setHeader, doCreate],
  );

  const handleViewOrder = useCallback(() => {
    if (createdOrder) onCreated?.(createdOrder.id);
  }, [createdOrder, onCreated]);

  const handleStudioBatAfterCreate = useCallback(() => {
    if (!createdOrder) return;
    if (onStudioBatForOrder) onStudioBatForOrder(createdOrder.id);
    else onCreated?.(createdOrder.id);
  }, [createdOrder, onStudioBatForOrder, onCreated]);

  /** "Ajouter un autre article" — conserve le client, réinitialise uniquement la ligne. */
  const handleAddAnotherItem = useCallback(() => {
    setCreatedOrder(null);
    setSubmissionSnapshot(null);
    // The store is already at step 1 with line = null and header intact (set by resetLine in doCreate).
  }, []);

  /** "Nouvelle commande" — réinitialisation complète (client + ligne + session). */
  const handleCreateAnother = useCallback(() => {
    setCreatedOrder(null);
    setSubmissionSnapshot(null);
    setSessionEntries([]);
    reset();
    resetQuoteId();
  }, [reset]);

  const lineError = useMemo(() => errors.line ?? undefined, [errors.line]);

  // ───────── Step content builders ─────────

  const handleAddReference = useCallback(() => {
    // Validate the currently expanded line first; if it's invalid, surface
    // the error and abort. The user keeps their in-progress line on screen.
    if (expandedLineId) {
      const v = validateStep(2);
      if (!v.ok) {
        setErrors(v.fieldErrors);
        focusFirstError(v.fieldErrors, ["secteur", "line"]);
        return;
      }
    }
    // Collapse the current line so the next category click creates a new
    // record (switchSecteur with no expanded line appends to the array).
    collapseAll();
    setErrors({});
  }, [expandedLineId, validateStep, collapseAll]);

  /** Click on a row header — toggles expansion. Clicking the already-expanded
   *  row collapses it; clicking another row expands it (the store ensures a
   *  single open row at a time). Validation noise is cleared on switch so the
   *  user can navigate between references freely. */
  const handleToggleLine = useCallback(
    (id: string) => {
      if (id === expandedLineId) {
        collapseAll();
      } else {
        expandLine(id);
      }
      setErrors({});
    },
    [expandedLineId, collapseAll, expandLine],
  );

  /** Edit form body — shared between an expanded existing line and the
   *  "new reference" virtual row. Rendered inside an AccordionItem panel. */
  const editFormBody = (
    <div className="space-y-7 px-1 pt-4 pb-1">
      <ProductCategoryPicker
        selectedId={selectedCategory?.id ?? null}
        onSelect={handleCategorySelect}
        onAutoAdvance={focusNextStep1Section}
        error={errors.secteur}
        required={!expandedLineId}
      />

      {selectedCategory?.id === "goodies" && (
        <Section label="Machine de production" required>
          <SegmentedControl
            ariaLabel="Machine"
            size="lg"
            value={secteur ?? null}
            onChange={(v) => switchSecteur(v as ClassicSecteur)}
            options={(selectedCategory.secteurOptions ?? []).map((sec) => ({
              value: sec,
              label: sec,
            }))}
          />
        </Section>
      )}

      <div
        key={line?.kind ?? "empty"}
        className="animate-in fade-in slide-in-from-bottom-1 duration-200"
      >
        {line && isClassicLine(line) && line.isSourcingRequired && (
          <SourcingFields error={lineError} products={categoryProducts} />
        )}
        {line && isClassicLine(line) && !line.isSourcingRequired && (
          <StandardOrderFields error={lineError} products={categoryProducts} />
        )}
        {line && isTextileLine(line) && (
          <TextileOrderFields error={lineError} />
        )}
        {selectedCategory && !line && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">
            {selectedCategory.id === "goodies"
              ? "Choisissez la machine de production ci-dessus"
              : "Chargement…"}
          </p>
        )}
        {!selectedCategory && !line && (
          <p className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center text-xs text-slate-400">
            {lines.length === 0
              ? "Sélectionnez une catégorie de produit pour commencer"
              : "Sélectionnez une catégorie pour ajouter une nouvelle référence"}
          </p>
        )}
      </div>
    </div>
  );

  // ── Step 1: accordion of references ──
  // Three layout cases:
  //   A) lines.length === 0 → no list, render the edit form bare so the
  //      user can pick a category and start their first line.
  //   B) lines.length > 0 with an expanded line → accordion of all lines,
  //      the expanded one shows the edit form in its panel.
  //   C) lines.length > 0 with no expanded line → accordion of all lines
  //      (all collapsed) + a virtual "Nouvelle référence" item open at the
  //      bottom that hosts the category picker for the next reference.
  const showNewReferenceSlot = lines.length > 0 && expandedLineId === null;

  // ── Étape 1 : Client ──
  // Sélection client + opérateur assigné. C'est l'entrée du flow : tant
  // qu'aucun client n'est rattaché, l'utilisateur ne peut pas atteindre
  // les étapes Articles / Personnalisation / Livraison.
  const step1Content = (
    <div
      className="space-y-7"
      onKeyDown={(e) => {
        // Enter sur un champ simple → avance à Articles. On exclut textarea
        // (multi-ligne), bouton (activate par défaut) et combobox (interaction
        // de sélection).
        if (e.key !== "Enter" || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        if (
          t.tagName === "TEXTAREA" ||
          t.tagName === "BUTTON" ||
          t.getAttribute("role") === "combobox" ||
          t.getAttribute("role") === "option"
        )
          return;
        e.preventDefault();
        handleRequestNext();
      }}
    >
      <OrderHeaderFields
        errors={errors}
        onFieldBlur={handleHeaderBlur}
        mode="client"
      />
    </div>
  );

  // ── Étape 2 : Articles ──
  const step2Content = (
    <div className="space-y-4">
      {lines.length === 0 ? (
        editFormBody
      ) : (
        <>
          {lines.map((r, idx) => {
            const isExpanded = r.id === expandedLineId;
            const sourcing = isClassicLine(r.line) && !!r.line.isSourcingRequired;
            return (
              <article
                key={r.id}
                className={referenceCardClass({
                  expanded: isExpanded,
                  demoted: !isExpanded && expandedLineId !== null,
                  sourcing,
                })}
                aria-current={isExpanded || undefined}
              >
                <AccordionItem
                  id={r.id}
                  expanded={isExpanded}
                  onToggle={() => handleToggleLine(r.id)}
                  onEscape={() => collapseAll()}
                  header={
                    <OrderLineCardCollapsed
                      id={r.id}
                      index={idx}
                      line={r.line}
                      expanded={isExpanded}
                      demoted={!isExpanded && expandedLineId !== null}
                      borderless
                      onEdit={() => handleToggleLine(r.id)}
                      onDuplicate={() => duplicateLine(r.id)}
                      onDelete={() => removeLine(r.id)}
                    />
                  }
                >
                  <div className="border-t border-slate-200/70 px-3 sm:px-4">
                    {editFormBody}
                  </div>
                </AccordionItem>
              </article>
            );
          })}

          {showNewReferenceSlot && (
            <article className="rounded-xl border border-dashed border-slate-300 bg-white shadow-md ring-1 ring-slate-900/5 transition-[border-color,box-shadow] duration-200 ease-in-out">
              <AccordionItem
                id="__new__"
                expanded
                onToggle={() => {
                  /* always-open virtual slot — header isn't a real toggle */
                }}
                header={<NewReferenceHeader index={lines.length} borderless />}
              >
                <div className="border-t border-dashed border-slate-300/70 px-3 sm:px-4">
                  {editFormBody}
                </div>
              </AccordionItem>
            </article>
          )}
        </>
      )}

      {(line || lines.length > 0) && !showNewReferenceSlot && (
        <button
          type="button"
          onClick={handleAddReference}
          className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-[13px] font-semibold text-slate-600 transition hover:border-slate-900 hover:bg-slate-50 hover:text-slate-900"
        >
          <Plus size={16} />
          Ajouter une référence
        </button>
      )}
    </div>
  );

  // ── Étape 3 : Personnalisation ──
  const step3Content = (
    <CustomizationStep
      lines={lines}
      expandedLineId={expandedLineId}
      onExpand={expandLine}
      onCollapse={collapseAll}
    />
  );

  const step4Totals = useMemo(() => computeTotals(line), [line]);

  // ── Étape 4 : Livraison ──
  const step4Content = (
    <div
      className="space-y-7"
      onKeyDown={(e) => {
        // Enter from any input/select on the delivery step → submit. Excludes
        // textarea (multi-line) and buttons (default activate behaviour).
        if (e.key !== "Enter" || e.defaultPrevented) return;
        const t = e.target as HTMLElement;
        if (
          t.tagName === "TEXTAREA" ||
          t.tagName === "BUTTON" ||
          t.getAttribute("role") === "combobox" ||
          t.getAttribute("role") === "option"
        )
          return;
        e.preventDefault();
        handleSubmitFinal();
      }}
    >
      <OrderHeaderFields
        errors={errors}
        onFieldBlur={handleHeaderBlur}
        categoryId={selectedCategory?.id ?? null}
        totalQty={step4Totals.totalQty}
        mode="delivery"
      />
    </div>
  );

  if (createdOrder && submissionSnapshot) {
    return (
      <SubmissionSummary
        order={createdOrder}
        categoryId={submissionSnapshot.categoryId}
        totalQty={submissionSnapshot.totalQty}
        clientName={submissionSnapshot.clientName}
        productLabel={submissionSnapshot.productLabel}
        isUrgent={submissionSnapshot.isUrgent}
        sessionEntries={sessionEntries}
        onViewOrder={handleViewOrder}
        onAddAnotherItem={handleAddAnotherItem}
        onCreateAnother={handleCreateAnother}
        onStudioBat={
          submissionSnapshot.categoryId === "textile"
            ? handleStudioBatAfterCreate
            : undefined
        }
      />
    );
  }

  return (
    <>
      <ShortcutsHelpOverlay />
      <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-6 shadow-sm sm:p-8">
          <QuoteHeader
            categoryLabel={selectedCategory?.label}
            onCancel={onCancel ? () => setFlowStep("cancel") : undefined}
          />

          {sessionEntries.length > 0 && (
            <SessionCartBanner entries={sessionEntries} />
          )}

          <FormWizard
            step1={step1Content}
            step2={step2Content}
            step3={step3Content}
            step4={step4Content}
            onRequestNext={handleRequestNext}
            onSubmitFinal={handleSubmitFinal}
            submitting={submitting}
          />

          {submitError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-3 rounded-lg border border-rose-300 bg-rose-50 p-3"
            >
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 h-5 w-5 flex-none text-rose-700"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold leading-snug text-rose-900">
                  Échec de la création — la saisie est conservée
                </div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-rose-800">
                  {submitError}
                </div>
              </div>
              <button
                type="button"
                onClick={handleConfirmCreate}
                disabled={submitting}
                className="inline-flex h-9 flex-none items-center gap-1.5 rounded-md bg-rose-700 px-3 text-[12px] font-semibold text-white transition hover:bg-rose-800 disabled:opacity-60"
              >
                {submitting ? "Envoi…" : "Réessayer"}
              </button>
            </div>
          )}
        </div>

        <OrderSidebar />
      </div>

      {/* Lead capture (when client missing at submit time) */}
      <LeadCaptureModal
        open={flowStep === "lead"}
        title="Renseigner le client"
        subtitle="Renseignez le nom et téléphone du client pour finaliser la commande."
        initialName={header.clientNom}
        initialPhone={header.telephone}
        onClose={() => {
          setFlowStep("confirm");
          setPendingAction(null);
        }}
        onSubmit={handleLeadSubmit}
      />

      {/* Final recap modal */}
      <OrderConfirmModal
        open={flowStep === "confirm"}
        header={header}
        line={line}
        lines={lines}
        submitting={submitting}
        error={submitError}
        onClose={() => {
          if (submitting) return;
          setFlowStep("form");
          setSubmitError(null);
        }}
        onConfirm={handleConfirmCreate}
        onEditStep={(step) => {
          if (submitting) return;
          setFlowStep("form");
          setSubmitError(null);
          setStep(step);
        }}
      />

      <CancelConfirmModal
        open={flowStep === "cancel"}
        quoteId={getQuoteId()}
        onKeep={() => setFlowStep("form")}
        onSaveAndExit={() => {
          // Le brouillon est déjà sauvegardé en continu — on attend juste un
          // éventuel flush pendant en cours puis on quitte. Pas de reset :
          // l'utilisateur retrouvera sa saisie dans Commandes → Brouillons.
          setFlowStep("form");
          onCancel?.();
        }}
        onDiscardWithoutSaving={() => {
          // Suppression explicite du brouillon serveur + reset complet.
          const id = useNewOrderStore.getState().draftId;
          if (id) deleteDraft.mutate(id);
          resetSaveStatus({ state: "idle", lastSavedAt: null, errorMessage: null });
          setFlowStep("form");
          reset();
          resetQuoteId();
          onCancel?.();
        }}
      />

      {/* Drawer global studio BAT — ouvrable depuis BatMatrix, SizeQuantityPicker… */}
      <BatDrawerPortal />
    </>
  );
}

// ───────── Cancel confirmation modal ─────────

/** 3-option exit modal :
 *   1. « Continuer le devis » (action sûre par défaut, Esc).
 *   2. « Quitter et sauver » → l'auto-save a déjà persisté le brouillon, on
 *      ferme simplement le tunnel.
 *   3. « Quitter sans sauver » → 2e confirmation inline (rouge).
 *
 *  Style OLDA : scrim duck blue 42%, rounded-20, glass blur 28px. */
function CancelConfirmModal({
  open,
  quoteId,
  onKeep,
  onSaveAndExit,
  onDiscardWithoutSaving,
}: {
  open: boolean;
  quoteId: string;
  onKeep: () => void;
  onSaveAndExit: () => void;
  onDiscardWithoutSaving: () => void;
}) {
  // Confirmation inline pour « Quitter sans sauver » — réinitialisée à chaque
  // ouverture du modal pour qu'un utilisateur ne reste jamais bloqué dans
  // l'état armé.
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (open) setConfirmDiscard(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onKeep();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onKeep]);

  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-confirm-title"
      onClick={onKeep}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        background: "rgba(74, 98, 116, 0.42)",
        backdropFilter: "blur(2px)",
        WebkitBackdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "28px 28px 24px",
          borderRadius: 20,
          background: "rgba(255, 255, 255, 0.78)",
          backdropFilter: "blur(28px) saturate(180%)",
          WebkitBackdropFilter: "blur(28px) saturate(180%)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
          boxShadow:
            "0 24px 48px -12px rgba(74, 98, 116, 0.35), 0 0 0 1px rgba(74, 98, 116, 0.08)",
        }}
      >
        <h3
          id="cancel-confirm-title"
          style={{
            margin: 0,
            fontFamily: "var(--font-display)",
            fontSize: 18,
            fontWeight: 700,
            color: "var(--ink-900, #1f2937)",
            lineHeight: 1.25,
          }}
        >
          Quitter sans valider ?
        </h3>
        <p
          style={{
            margin: "10px 0 4px",
            fontFamily: "var(--font-text)",
            fontSize: 13,
            lineHeight: 1.55,
            color: "#475569",
          }}
        >
          Tes modifications sur <strong>{quoteId}</strong> seront sauvegardées
          en brouillon.
        </p>
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-text)",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#64748b",
          }}
        >
          Tu peux les retrouver dans <strong>Commandes → Brouillons</strong>.
        </p>

        <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            onClick={onKeep}
            autoFocus
            style={{
              height: 44,
              borderRadius: 12,
              border: "none",
              background: "#4A6274",
              color: "#ffffff",
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "var(--font-text)",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(74, 98, 116, 0.18)",
            }}
          >
            Continuer le devis
          </button>

          <button
            type="button"
            onClick={onSaveAndExit}
            style={{
              height: 40,
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: "#3a4e5d",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-text)",
              cursor: "pointer",
            }}
          >
            Quitter et sauver
          </button>

          {confirmDiscard ? (
            <div
              role="alertdialog"
              style={{
                marginTop: 2,
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(220, 38, 38, 0.06)",
                border: "1px solid rgba(220, 38, 38, 0.18)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-text)",
                  fontSize: 12,
                  color: "#7f1d1d",
                  lineHeight: 1.45,
                }}
              >
                Cette action est irréversible. Confirmer ?
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setConfirmDiscard(false)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    border: "1px solid rgba(74, 98, 116, 0.2)",
                    background: "rgba(255, 255, 255, 0.6)",
                    color: "#3a4e5d",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "var(--font-text)",
                    cursor: "pointer",
                  }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={onDiscardWithoutSaving}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 8,
                    border: "none",
                    background: "#dc2626",
                    color: "#ffffff",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "var(--font-text)",
                    cursor: "pointer",
                  }}
                >
                  Oui, supprimer
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDiscard(true)}
              style={{
                height: 40,
                borderRadius: 10,
                border: "none",
                background: "transparent",
                color: "#dc2626",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-text)",
                cursor: "pointer",
              }}
            >
              Quitter sans sauver
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ───────── Session cart banner ─────────

function SessionCartBanner({ entries }: { entries: SessionEntry[] }) {
  return (
    <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
          {entries.length}
        </span>
        <span className="text-[12px] font-semibold text-emerald-900">
          {entries.length === 1
            ? "1 article déjà commandé pour ce client"
            : `${entries.length} articles déjà commandés pour ce client`}
        </span>
      </div>
      <ul className="mt-2 space-y-1 pl-7">
        {entries.map((e) => (
          <li key={e.order.id} className="text-[11px] text-emerald-800">
            <span className="font-mono font-semibold">{e.order.reference}</span>
            {" · "}
            {e.productLabel}
            {e.totalQty > 0 && <> · {e.totalQty} pcs</>}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────── Local helpers ─────────

/**
 * Étape 2 — Personnalisation. Liste **toutes** les références ajoutées dans
 * la fiche produit. Une ligne par référence (composant ReferenceRow), avec
 * Zone 1 = récap commande (cliquable → accordion détaillé) et Zone 2 = CTA
 * BAT contextuel (Créer / Reprendre / Modifier / Activer) + menu kebab pour
 * skip / dupliquer / réinitialiser. Les lignes classiques sont listées en
 * lecture seule — elles n'ont pas de personnalisation BAT.
 */
function CustomizationStep({
  lines,
  expandedLineId,
  onExpand,
  onCollapse,
}: {
  lines: import("./types").OrderLineRecord[];
  expandedLineId: string | null;
  onExpand: (id: string) => void;
  onCollapse: () => void;
}) {
  const textileRecords = lines.filter((r) => isTextileLine(r.line));
  const classicRecords = lines.filter((r) => isClassicLine(r.line));

  if (textileRecords.length === 0) return null;

  // Sources éligibles pour "Dupliquer le BAT depuis…" : toute autre ligne
  // textile possédant au moins un BAT (draft ou linked).
  const sourcesWithBat = textileRecords.filter((r) => {
    const tLine = r.line as import("./types").TextileLine;
    const hasDraft = Object.values(tLine.batDrafts ?? {}).some(
      (arr) => (arr?.length ?? 0) > 0,
    );
    const hasLinked = Object.keys(tLine.linkedBats ?? {}).length > 0;
    return hasDraft || hasLinked;
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-[13px] font-bold uppercase tracking-wider text-slate-700">
          Références à personnaliser
        </h3>
      </div>

      <ul role="list" className="flex flex-col gap-2">
        {textileRecords.map((record) => {
          const isExpanded = record.id === expandedLineId;
          const indexInList = lines.findIndex((x) => x.id === record.id);
          const duplicateSources = sourcesWithBat.filter(
            (s) => s.id !== record.id,
          );
          return (
            <ReferenceRow
              key={record.id}
              record={record}
              index={indexInList}
              isExpanded={isExpanded}
              onToggleExpand={() =>
                isExpanded ? onCollapse() : onExpand(record.id)
              }
              duplicateSources={duplicateSources}
            />
          );
        })}
      </ul>

      {classicRecords.length > 0 && (
        <div className="space-y-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Sans personnalisation
          </div>
          {classicRecords.map((record) => {
            const indexInList = lines.findIndex((x) => x.id === record.id);
            const summary = describeLine(record.line);
            return (
              <div
                key={record.id}
                className="flex items-center gap-2 text-[12px] text-slate-600"
              >
                <span className="font-semibold text-slate-500">
                  #{indexInList + 1}
                </span>
                <span className="truncate">{summary.title}</span>
                {summary.reference && (
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                    {summary.reference}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ───────── Focus-first-error helpers ─────────

/**
 * Scrolls the first errored field into view and moves focus to it.
 * Falls back, in order: matching `id`, the element described-by the error,
 * then the first non-empty `[role="alert"]` in the document.
 */
function focusFirstError(
  fieldErrors: ValidationResult["fieldErrors"],
  priority: ReadonlyArray<FieldErrorKey>,
) {
  if (typeof document === "undefined") return;
  for (const key of priority) {
    const msg = fieldErrors[key];
    if (!msg) continue;
    if (focusFieldByKey(key, msg)) return;
  }
  // Final fallback: any visible inline alert in the form area.
  const alerts = document.querySelectorAll<HTMLElement>('[role="alert"]');
  for (const a of alerts) {
    if (a.textContent && a.textContent.trim().length > 0) {
      a.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
  }
}

function focusFieldByKey(key: string, message?: string): boolean {
  // The generic "line" key covers several Step 1 fields — pick by message.
  if (key === "line" && message) {
    const sub = lineErrorToFieldName(message);
    if (sub && focusFieldByKey(sub)) return true;
  }
  // 1) Direct id (used by Input/textarea-style fields, e.g. clientNom).
  const direct = document.getElementById(`field-${key}`);
  if (direct && isFocusable(direct)) {
    scrollAndFocus(direct);
    return true;
  }
  // 2) An owner element described-by the field's error (radiogroups etc.).
  const owner = document.querySelector<HTMLElement>(
    `[aria-describedby~="field-${key}-error"]`,
  );
  if (owner) {
    const target = isFocusable(owner)
      ? owner
      : owner.querySelector<HTMLElement>(
          'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
    if (target) scrollAndFocus(target);
    else owner.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }
  // 3) Scroll the error message itself into view.
  const errEl = document.getElementById(`field-${key}-error`);
  if (errEl) {
    errEl.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }
  return false;
}

function lineErrorToFieldName(msg: string): string | null {
  if (msg.includes("Produit")) return "produit";
  if (msg.includes("Quantité")) return "quantite";
  if (msg.includes("Modèle")) return "modele";
  if (msg.includes("Description")) return "sourcing-description";
  return null;
}

function isFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (["INPUT", "BUTTON", "SELECT", "TEXTAREA", "A"].includes(el.tagName)) return true;
  return el.tabIndex >= 0;
}

function scrollAndFocus(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Defer focus until smooth scroll begins — prevents an extra jump.
  window.setTimeout(() => el.focus({ preventScroll: true }), 60);
}

function base64ToFile(base64: string, fileName: string, mime: string): File {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
}

/** Header shown for the "Nouvelle référence" virtual accordion item — slot
 *  where the user picks a category to start a new line after closing the
 *  previous one. Visually mirrors `OrderLineCardCollapsed` in expanded state
 *  so the list keeps a consistent rhythm.
 *  When `borderless` is true, the unified parent `<article>` provides the
 *  outer chrome (border/rounded/bg/shadow). */
function NewReferenceHeader({
  index,
  borderless = false,
}: {
  index: number;
  borderless?: boolean;
}) {
  const chrome = borderless
    ? ""
    : "rounded-xl border border-dashed border-slate-300 bg-white shadow-md ring-1 ring-slate-900/5";
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 ${chrome}`}>
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50">
        <Plus size={18} className="text-slate-400" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            #{index + 1}
          </span>
          <h3 className="truncate text-[14px] font-semibold text-slate-800">
            Nouvelle référence
          </h3>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-slate-500">
          Sélectionnez une catégorie pour démarrer
        </p>
      </div>
    </div>
  );
}

/** Visual chrome of a unified reference container — single border, single
 *  shadow, single rounded corner. Encapsulates the collapsed header AND the
 *  expanded configuration zone so the user perceives them as a single
 *  "article". State (expanded / demoted / sourcing) drives only colour and
 *  elevation; layout is identical across states. */
function referenceCardClass(params: {
  expanded: boolean;
  demoted: boolean;
  sourcing: boolean;
}): string {
  const { expanded, demoted, sourcing } = params;
  const base =
    "rounded-xl border transition-[border-color,box-shadow,opacity] duration-200 ease-in-out";
  const state = expanded
    ? sourcing
      ? "border-amber-400 bg-amber-50/40 shadow-md ring-1 ring-amber-500/10 opacity-100"
      : "border-slate-300 bg-white shadow-md ring-1 ring-slate-900/5 opacity-100"
    : demoted
      ? sourcing
        ? "border-amber-200 bg-amber-50/30 opacity-70 hover:opacity-100 hover:border-amber-300 hover:bg-amber-50 hover:shadow"
        : "border-slate-200 bg-slate-50/60 opacity-70 hover:opacity-100 hover:border-slate-300 hover:bg-white hover:shadow"
      : sourcing
        ? "border-amber-300 bg-amber-50/40 shadow-sm hover:border-amber-400 hover:shadow"
        : "border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:shadow";
  return `${base} ${state}`;
}

/** Collect, for each color, the latest BAT draft (v_max). Falls back to legacy
 *  single-draft `batDraft` if `batDrafts` is absent. */
function collectLatestBatDrafts(line: OrderLine): import("./types").BatDraft[] {
  if (!isTextileLine(line)) return [];
  if (line.batDrafts && Object.keys(line.batDrafts).length > 0) {
    const out: import("./types").BatDraft[] = [];
    for (const versions of Object.values(line.batDrafts)) {
      const latest = versions[versions.length - 1];
      if (latest) out.push(latest);
    }
    return out;
  }
  return line.batDraft ? [line.batDraft] : [];
}

