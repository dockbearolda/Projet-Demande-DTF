import { useEffect, useMemo, useState } from "react";
import { TEXTILE_MODELS } from "../constants";
import { selectLine, useNewOrderStore } from "../store";
import {
  isTextileLine,
  type TextileColor,
  type TextileLine,
} from "../types";
import { Section } from "./primitives";
import { SizeQuantityPicker } from "./SizeQuantityPicker";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { AutoAdvance } from "@/components/ui/AutoAdvance";

interface Props {
  error?: string;
}

const MODEL_FAMILIES: { key: string; label: string; sub?: string }[] = [
  { key: "T-shirt ECO", label: "ECO", sub: "Entrée de gamme" },
  { key: "T-shirt Classic", label: "Classic", sub: "Standard" },
  { key: "Premium", label: "Premium", sub: "Haut de gamme" },
];

/**
 * Step 1 content for textile flow:
 *   Genre → Modèle → Couleurs (S3) → Tailles/Quantités (S4)
 */
export function TextileOrderFields({ error }: Props) {
  const line = useNewOrderStore(selectLine);
  const setTarget = useNewOrderStore((s) => s.setTextileTarget);
  const setModel = useNewOrderStore((s) => s.setTextileModel);
  const removeItem = useNewOrderStore((s) => s.removeTextileItem);

  if (!line || !isTextileLine(line)) return null;

  return (
    <Inner
      line={line}
      setTarget={setTarget}
      setModel={setModel}
      removeItem={removeItem}
      error={error}
    />
  );
}

function Inner({
  line,
  setTarget,
  setModel,
  removeItem,
  error,
}: {
  line: TextileLine;
  setTarget: (t: "HOMME" | "FEMME") => void;
  setModel: (id: string) => void;
  removeItem: (id: string) => void;
  error?: string;
}) {
  const modelsForTarget = useMemo(
    () => TEXTILE_MODELS.filter((m) => m.target === line.target),
    [line.target],
  );

  const familyCards = useMemo(
    () =>
      MODEL_FAMILIES.map((fam) => ({
        ...fam,
        model: modelsForTarget.find((m) => m.name === fam.key) ?? null,
      })).filter((c) => c.model !== null),
    [modelsForTarget],
  );

  const currentModel = useMemo(
    () => TEXTILE_MODELS.find((m) => m.id === line.modelId) ?? null,
    [line.modelId],
  );

  // Default Homme on mount if target is somehow unset/ENFANT.
  useEffect(() => {
    if (line.target !== "HOMME" && line.target !== "FEMME") {
      setTarget("HOMME");
    }
  }, [line.target, setTarget]);

  // ── Raccourcis S2 : H/F (genre) + 1/2/3 (modèle) ──
  const [modelAdvanceTick, setModelAdvanceTick] = useState(0);

  const familyKeyShortcut = useMemo(() => {
    return (idx: number) => String(idx + 1);
  }, []);

  useKeyboardShortcuts([
    {
      key: "h",
      label: "Genre Homme",
      group: "S2 — Genre & Modèle",
      handler: () => setTarget("HOMME"),
    },
    {
      key: "f",
      label: "Genre Femme",
      group: "S2 — Genre & Modèle",
      handler: () => setTarget("FEMME"),
    },
    ...familyCards.map((fc, i) => ({
      key: familyKeyShortcut(i),
      label: `Modèle ${fc.label}`,
      group: "S2 — Genre & Modèle",
      handler: () => {
        if (fc.model) {
          setModel(fc.model.id);
          setModelAdvanceTick((t) => t + 1);
        }
      },
    })),
  ]);

  const focusFirstSwatch = () => {
    const first = document.querySelector<HTMLButtonElement>(
      "[data-color-picker] [data-swatch-grid] button",
    );
    if (first) {
      first.focus();
      first.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

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

  const toggleColor = (color: TextileColor) => {
    if (!currentModel) return;
    const isActive = activeColors.has(color.id);
    if (isActive) {
      const total = Object.values(line.items)
        .filter((it) => it.color === color.id)
        .reduce((s, it) => s + it.qty, 0);
      if (total > 0) {
        const ok = window.confirm(
          `Retirer « ${color.label} » et effacer les ${total} pièce${
            total > 1 ? "s" : ""
          } ?`,
        );
        if (!ok) return;
      }
      for (const it of Object.values(line.items)) {
        if (it.color === color.id) removeItem(it.id);
      }
      setActiveColors((prev) => {
        const next = new Set(prev);
        next.delete(color.id);
        return next;
      });
    } else {
      setActiveColors((prev) => new Set(prev).add(color.id));
    }
  };

  const selectAllColors = () => {
    if (!currentModel) return;
    setActiveColors(new Set(currentModel.colors.map((c) => c.id)));
  };

  const clearAllColors = () => {
    if (!currentModel) return;
    const hasAnyQty = currentModel.colors.some((c) =>
      Object.values(line.items).some(
        (it) => it.color === c.id && it.qty > 0,
      ),
    );
    if (hasAnyQty) {
      const ok = window.confirm(
        "Effacer toutes les couleurs et les quantités saisies ?",
      );
      if (!ok) return;
    }
    for (const it of Object.values(line.items)) {
      removeItem(it.id);
    }
    setActiveColors(new Set());
  };

  return (
    <div className="space-y-6">
      {/* ── Genre ── */}
      <div role="radiogroup" aria-label="Genre" className="flex items-center gap-3">
        <span className="text-[13px] font-bold uppercase tracking-wider text-slate-700">
          Genre
        </span>
        {(["HOMME", "FEMME"] as const).map((v) => {
          const hk = v === "HOMME" ? "H" : "F";
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={line.target === v}
              aria-keyshortcuts={hk}
              onClick={() => setTarget(v)}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:scale-[0.97] ${
                line.target === v
                  ? "border-blue-700 bg-blue-50 text-blue-800"
                  : "border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <span>{v === "HOMME" ? "Homme" : "Femme"}</span>
            </button>
          );
        })}
      </div>

      {/* ── Modèle ── */}
      <Section
        label="Modèle"
        name="modele"
        required
        error={error && error.includes("Modèle") ? error : undefined}
      >
        <div
          role="radiogroup"
          aria-label="Modèle de textile"
          className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible"
        >
          {familyCards.map(({ key, label, sub, model }, idx) => {
            if (!model) return null;
            const selected = line.modelId === model.id;
            const hk = familyKeyShortcut(idx);
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-keyshortcuts={hk}
                onClick={() => {
                  setModel(model.id);
                  setModelAdvanceTick((t) => t + 1);
                }}
                aria-label={`Modèle ${label}${sub ? ` — ${sub}` : ""}, référence ${model.reference}`}
                className={`group relative flex min-w-[140px] flex-none snap-start flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 pr-3 text-center transition active:scale-[0.97] focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 sm:min-w-0 sm:flex-1 ${
                  selected
                    ? "border-blue-700 bg-blue-50 text-blue-800 shadow-sm"
                    : "border-slate-300 bg-white text-slate-900 hover:border-slate-500 hover:bg-slate-50"
                }`}
              >
                <ShirtGlyph
                  className={`h-7 w-7 ${selected ? "text-blue-700" : "text-slate-700"}`}
                  aria-hidden="true"
                />
                <span className="mt-1 text-base font-bold leading-tight">{label}</span>
                {sub && (
                  <span
                    className={`text-[12px] font-semibold uppercase tracking-wide ${
                      selected ? "text-blue-700" : "text-slate-600"
                    }`}
                  >
                    {sub}
                  </span>
                )}
                <span
                  className={`mt-1 rounded-full px-2 py-0.5 font-mono text-[12px] font-bold ${
                    selected
                      ? "bg-blue-100 text-blue-800"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {model.reference}
                </span>
              </button>
            );
          })}
        </div>
        <AutoAdvance
          active={modelAdvanceTick > 0 && !!line.modelId}
          resetKey={modelAdvanceTick}
          onComplete={focusFirstSwatch}
          visibleLabel="Passage automatique aux couleurs dans 300ms… (Esc pour annuler)"
          announcement="Le focus passera à la sélection des couleurs dans 300 millisecondes."
        />
      </Section>

      {/* ── S3 : Couleurs disponibles ── */}
      {currentModel && (
        <div>
          <SectionHeader
            icon={<PaletteIcon />}
            label="Couleurs disponibles"
            required
            error={
              error && error.toLowerCase().includes("couleur") ? error : undefined
            }
          />
          <ColorSwatchPicker
            colors={currentModel.colors}
            activeColors={activeColors}
            onToggleColor={(id) => {
              const color = currentModel.colors.find((c) => c.id === id);
              if (color) toggleColor(color);
            }}
            onSelectAll={selectAllColors}
            onClearAll={clearAllColors}
          />
        </div>
      )}

      {/* ── Divider + S4 : Quantités par taille ── */}
      {currentModel && (
        <div>
          <div className="mb-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            <SectionHeader
              icon={<GridIcon />}
              label="Quantités par taille"
              required
              inline
              error={
                error && error.toLowerCase().includes("taille") ? error : undefined
              }
            />
            <div className="h-px flex-1 bg-slate-200" aria-hidden="true" />
          </div>

          {activeColors.size === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5">
              <span className="text-xl" aria-hidden="true">👆</span>
              <p className="text-sm text-slate-600">
                Sélectionnez au moins une couleur ci-dessus pour saisir les quantités.
              </p>
            </div>
          ) : (
            <SizeQuantityPicker activeColors={activeColors} />
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SectionHeader — label avec icône, optionnellement inline
// ─────────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  required,
  inline = false,
  error,
}: {
  icon: React.ReactNode;
  label: string;
  required?: boolean;
  inline?: boolean;
  error?: string;
}) {
  return (
    <div className={inline ? "" : "mb-3"}>
      <div className="flex items-center gap-2">
        <span
          className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-slate-100 text-slate-600"
          aria-hidden="true"
        >
          {icon}
        </span>
        <span className="text-[13px] font-bold uppercase tracking-wider text-slate-700">
          {label}
          {required && (
            <>
              <span className="ml-0.5 text-rose-700" aria-hidden="true">*</span>
              <span className="sr-only"> (champ requis)</span>
            </>
          )}
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[12px] font-medium text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

// ───────── Icons ─────────

function ShirtGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7l4-3 2 2h4l2-2 4 3-2 4-2-1v9H8v-9l-2 1z" />
    </svg>
  );
}

function PaletteIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}
