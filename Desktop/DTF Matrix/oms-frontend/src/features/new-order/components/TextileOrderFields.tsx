import { useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Search } from "lucide-react";
import { selectLine, useNewOrderStore } from "../store";
import { getTextileModel } from "../runtimeCatalog";
import {
  computeColorChangeFee,
  computeTotals,
  countDistinctColors,
  formatEUR,
} from "../pricing";
import { isTextileLine, type TextileLine } from "../types";
import { Step1SizeQuantityGrid } from "./Step1ProductQuantities";
import { SupplierCatalogModal } from "./SupplierCatalogModal";
import {
  PlacementSelector,
  IdenticalLogoSetupToggle,
  type PlacementId,
  type BodyPlacement,
  type SleevePlacement,
} from "./LogoPlacementSelector";
import { absoluteMockupUrl } from "@/hooks/useSupplierCatalog";

interface Props {
  error?: string;
}

export function TextileOrderFields({ error }: Props) {
  const line = useNewOrderStore(selectLine);
  const setModel = useNewOrderStore((s) => s.setTextileModel);
  const addRowForColor = useNewOrderStore((s) => s.addTextileRowForColor);
  const upsertTextileItem = useNewOrderStore((s) => s.upsertTextileItem);
  const toggleBodyPlacement = useNewOrderStore((s) => s.toggleBodyPlacement);
  const toggleSleevePlacement = useNewOrderStore((s) => s.toggleSleevePlacement);
  const setIdenticalLogoSetup = useNewOrderStore(
    (s) => s.setIdenticalLogoSetup,
  );

  if (!line || !isTextileLine(line)) return null;

  return (
    <Inner
      line={line}
      setModel={setModel}
      addRowForColor={addRowForColor}
      upsertTextileItem={upsertTextileItem}
      toggleBodyPlacement={toggleBodyPlacement}
      toggleSleevePlacement={toggleSleevePlacement}
      setIdenticalLogoSetup={setIdenticalLogoSetup}
      error={error}
    />
  );
}

function Inner({
  line,
  setModel,
  addRowForColor,
  upsertTextileItem,
  toggleBodyPlacement,
  toggleSleevePlacement,
  setIdenticalLogoSetup,
  error,
}: {
  line: TextileLine;
  setModel: (id: string) => void;
  addRowForColor: (colorId: string) => string | null;
  upsertTextileItem: (item: import("../types").TextileItem) => void;
  toggleBodyPlacement: (p: BodyPlacement) => void;
  toggleSleevePlacement: (p: SleevePlacement) => void;
  setIdenticalLogoSetup: (value: boolean) => void;
  error?: string;
}) {
  // Open automatically on first mount when no model is selected yet (i.e. user
  // just picked the "Textile" category) — skips the empty intermediate card.
  const [pickerOpen, setPickerOpen] = useState(!line.modelId);
  const supplierSelectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (supplierSelectTimerRef.current !== null) {
        window.clearTimeout(supplierSelectTimerRef.current);
      }
    };
  }, []);

  const currentModel = useMemo(
    () => (line.modelId ? getTextileModel(line.modelId) ?? null : null),
    [line.modelId],
  );

  // ── Active colors ──
  const [activeColors, setActiveColors] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const it of Object.values(line.items)) {
      if (!it.isPlaceholder) set.add(it.color);
    }
    return set;
  });

  useEffect(() => {
    const set = new Set<string>();
    for (const it of Object.values(line.items)) {
      if (!it.isPlaceholder) set.add(it.color);
    }
    setActiveColors(set);
    // only react to model change so user-toggled colors persist
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.modelId]);

  const handleSupplierSelect = ({
    refInternal,
    colorSlug,
  }: {
    refInternal: string;
    colorSlug: string;
    model: unknown;
    color: unknown;
  }) => {
    setModel(refInternal);
    setPickerOpen(false);
    if (supplierSelectTimerRef.current !== null) {
      window.clearTimeout(supplierSelectTimerRef.current);
    }
    supplierSelectTimerRef.current = window.setTimeout(() => {
      addRowForColor(colorSlug);
      setActiveColors(new Set([colorSlug]));
      supplierSelectTimerRef.current = null;
    }, 50);
  };

  // Derived values used in JSX
  const distinctColors = currentModel ? countDistinctColors(line) : 0;
  const feeEstimate =
    currentModel && distinctColors >= 2
      ? computeColorChangeFee(
          { ...line, hasIdenticalLogoSetup: false },
          distinctColors,
        )
      : 0;

  const showError =
    error && (error.includes("Modèle") || error.toLowerCase().includes("modele"));

  return (
    <div className="space-y-5">
      {/* ── Section header ── */}
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-slate-700">
          Référence textile
          <span className="text-rose-700" aria-hidden="true"> *</span>
        </h2>
        {showError && (
          <p role="alert" className="mt-2 text-[12px] font-medium text-rose-700">
            {error}
          </p>
        )}
      </div>

      {/* ── Model + placements card (or picker) ── */}
      {currentModel ? (
        <ModelPlacementCard
          line={line}
          model={currentModel}
          activeColors={currentModel.colors.filter((c) => activeColors.has(c.id))}
          onChangeModel={() => setPickerOpen(true)}
          onTogglePlacement={(id) => {
            if (id === "front-center") toggleBodyPlacement("front");
            else if (id === "back-center" || id === "back-upper") toggleBodyPlacement("back");
            else if (id === "sleeve-left") toggleSleevePlacement("sleeve-left");
            else if (id === "sleeve-right") toggleSleevePlacement("sleeve-right");
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-slate-300 bg-white px-5 py-5 text-left transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:border-slate-600 focus-visible:ring-2 focus-visible:ring-slate-200"
        >
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <Search size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-slate-900">
              Choisir une référence
            </span>
            <span className="mt-0.5 block text-[12.5px] text-slate-500">
              Catalogue fournisseur — t-shirts, polos, sweats…
            </span>
          </span>
        </button>
      )}

      {/* ── Identical logo toggle — n'apparaît qu'avec ≥ 2 couleurs ── */}
      {currentModel && distinctColors >= 2 && (
        <IdenticalLogoSetupToggle
          checked={line.hasIdenticalLogoSetup !== false}
          onChange={setIdenticalLogoSetup}
          activeColorCount={distinctColors}
          feeEstimate={feeEstimate}
        />
      )}

      {/* ── Couleurs + grille tailles ── */}
      {currentModel && (
        <div className="flex flex-col gap-3">
          {error && error.toLowerCase().includes("taille") && (
            <p role="alert" className="text-[12px] font-medium text-rose-700">
              {error}
            </p>
          )}
          {(() => {
            const sortedSizes = [...currentModel.sizes].sort(
              (a, b) => a.order - b.order,
            );
            const activeColorsList = currentModel.colors.filter((c) =>
              activeColors.has(c.id),
            );
            const quantities: Record<string, number> = {};
            for (const it of Object.values(line.items)) {
              if (!it.isPlaceholder) {
                quantities[`${it.color}__${it.size}`] = it.qty;
              }
            }
            return (
              <>
                {activeColors.size === 0 ? (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
                    <span className="text-xl" aria-hidden="true">👆</span>
                    <p className="text-sm text-slate-600">
                      Ajoutez une couleur pour commencer la saisie des quantités.
                    </p>
                  </div>
                ) : (
                  <Step1SizeQuantityGrid
                    sizes={sortedSizes}
                    colors={activeColorsList}
                    quantities={quantities}
                    hideTotals={activeColors.size === 1}
                    onChange={(colorId, sizeId, qty) =>
                      upsertTextileItem({
                        id: `${colorId}__${sizeId}`,
                        color: colorId,
                        size: sizeId,
                        qty: Math.max(0, qty || 0),
                      })
                    }
                  />
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* ── Prix ── */}
      {currentModel && (
        <PriceAndRecap
          line={line}
          model={currentModel}
        />
      )}

      <SupplierCatalogModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSupplierSelect}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ModelPlacementCard — modèle + sélecteur de placement en une carte
// ─────────────────────────────────────────────────────────────

function deriveSelectedPlacements(line: TextileLine): PlacementId[] {
  const result: PlacementId[] = [];
  const body = line.bodyPlacements ?? [];
  const sleeves = line.sleeveLogoPlacements ?? [];
  if (body.includes("front")) result.push("front-center");
  if (body.includes("back")) result.push("back-center");
  if (sleeves.includes("sleeve-left")) result.push("sleeve-left");
  if (sleeves.includes("sleeve-right")) result.push("sleeve-right");
  return result;
}

function ModelPlacementCard({
  line,
  model,
  activeColors,
  onChangeModel,
  onTogglePlacement,
}: {
  line: TextileLine;
  model: NonNullable<ReturnType<typeof getTextileModel>>;
  activeColors: Array<{ id: string; label: string; hex: string; swatchBorder?: boolean }>;
  onChangeModel: () => void;
  onTogglePlacement: (id: PlacementId) => void;
}) {
  const selectedPlacements = deriveSelectedPlacements(line);

  const previewColor =
    model.colors.find((c) => activeColors.some((a) => a.id === c.id)) ??
    model.colors[0];
  const previewUrl = previewColor?.mockupUrl
    ? absoluteMockupUrl(previewColor.mockupUrl)
    : undefined;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center">
        {/* Vignette produit */}
        <div className="flex h-[88px] w-[88px] flex-none items-center justify-center overflow-hidden rounded-l-2xl bg-slate-50">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt={previewColor?.label ?? model.name}
              className="h-full w-full object-contain"
            />
          ) : (
            <span
              className="h-full w-full"
              style={{ backgroundColor: previewColor?.hex ?? "#ccc" }}
            />
          )}
        </div>

        {/* Infos modèle */}
        <div className="flex w-[180px] flex-none flex-col justify-center px-4 py-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">
            {model.reference}
          </p>
          <p className="mt-0.5 text-[14px] font-bold leading-tight text-slate-900">
            {model.name}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {activeColors.map((c) => (
              <span
                key={c.id}
                className="h-4 w-4 rounded-full ring-1 ring-slate-900/10"
                style={{ backgroundColor: c.hex }}
                title={c.label}
              />
            ))}
          </div>
        </div>

        {/* Sélecteur de placement — multi-sélection cumulable */}
        <div className="min-w-0 flex-1 px-3">
          <PlacementSelector selected={selectedPlacements} onToggle={onTogglePlacement} />
        </div>

        {/* Bouton Changer */}
        <div className="flex flex-none items-center pr-4">
          <button
            type="button"
            onClick={onChangeModel}
            className="inline-flex h-9 flex-none items-center gap-1.5 rounded-lg bg-slate-50 px-3 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:ring-slate-300"
          >
            <Pencil size={13} />
            Changer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// PriceAndRecap — prix unitaire + récap total (barre en bas)
// ─────────────────────────────────────────────────────────────

function PriceAndRecap({
  line,
  model,
}: {
  line: TextileLine;
  model: NonNullable<ReturnType<typeof getTextileModel>>;
}) {
  const lineTotals = useMemo(() => computeTotals(line), [line]);
  const unitPrice = lineTotals.unitPrice;

  const perColor = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of Object.values(line.items)) {
      if (it.isPlaceholder) continue;
      if (!it.qty) continue;
      map.set(it.color, (map.get(it.color) ?? 0) + it.qty);
    }
    return [...map.entries()]
      .map(([colorId, qty]) => ({
        colorId,
        qty,
        color: model.colors.find((c) => c.id === colorId),
        subtotal: qty * unitPrice,
      }))
      .sort((a, b) => b.qty - a.qty);
  }, [line.items, model.colors, unitPrice]);

  const sizeBreakdown = useMemo(() => {
    const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL"];
    const map = new Map<string, number>();
    for (const it of Object.values(line.items)) {
      if (it.isPlaceholder) continue;
      if (!it.qty) continue;
      map.set(it.size, (map.get(it.size) ?? 0) + it.qty);
    }
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ia = SIZE_ORDER.indexOf(a.toUpperCase());
        const ib = SIZE_ORDER.indexOf(b.toUpperCase());
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      })
      .map(([size, qty]) => ({ size, qty }));
  }, [line.items]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      {/* Prix de cette référence */}
      <div className="flex justify-end">
        <div className="flex flex-col items-end">
          <span className="text-[20px] font-bold tabular-nums text-slate-900">
            {formatEUR(lineTotals.subtotal)}
          </span>
          {sizeBreakdown.length > 0 && (
            <span className="text-[11px] text-slate-500 tabular-nums">
              {sizeBreakdown.map(({ size, qty }) => `${qty} ${size}`).join(" · ")}
            </span>
          )}
          {unitPrice > 0 && (
            <span className="mt-0.5 text-[11px] text-slate-400 tabular-nums">
              {formatEUR(unitPrice)}/pc
            </span>
          )}
          {lineTotals.colorChangeFee > 0 && (
            <span
              className="mt-0.5 text-[11px] font-medium tabular-nums text-slate-600"
              title={`${lineTotals.distinctColorCount} couleurs × placements actifs`}
            >
              + {formatEUR(lineTotals.colorChangeFee)} calage
            </span>
          )}
        </div>
      </div>

      {/* Récap par couleur — seulement à partir de 2 couleurs */}
      {perColor.length > 1 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Récapitulatif par couleur
          </div>
          <ul className="divide-y divide-slate-100">
            {perColor.map(({ colorId, qty, color, subtotal }) => (
              <li
                key={colorId}
                className="flex items-center gap-3 py-1.5 text-[12.5px]"
              >
                <span
                  aria-hidden="true"
                  className={`h-4 w-4 flex-none rounded-full ${
                    color?.swatchBorder ? "ring-1 ring-slate-300" : ""
                  }`}
                  style={{ backgroundColor: color?.hex ?? "#cccccc" }}
                />
                <span className="min-w-0 flex-1 truncate text-slate-700">
                  {color?.label ?? colorId}
                </span>
                <span className="w-16 text-right tabular-nums text-slate-600">
                  {qty} pcs
                </span>
                <span className="w-20 text-right font-semibold tabular-nums text-slate-900">
                  {formatEUR(subtotal)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
