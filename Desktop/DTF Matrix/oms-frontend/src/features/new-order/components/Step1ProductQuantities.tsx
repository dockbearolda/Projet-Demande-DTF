import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Plus, Search, X } from "lucide-react";

// ────────────────────────────────────────────────────────────
// Public types — presentational component, no store coupling.
// Plug onto the zustand layer at the call site (see end of file).
// ────────────────────────────────────────────────────────────

export interface Step1Size {
  id: string;
  label: string;
  order: number;
}

export interface Step1Color {
  id: string;
  label: string;
  hex: string;
  commercialName?: string;
}

export interface Step1Product {
  category: string;
  reference: string;
  name?: string;
  imageUrl?: string;
}

export interface Step1Props {
  product: Step1Product;
  sizes: Step1Size[];
  availableColors: Step1Color[];
  activeColorIds: string[];
  /** key = `${colorId}__${sizeId}` */
  quantities: Record<string, number>;
  onActivateColor: (colorId: string) => void;
  onDeactivateColor: (colorId: string) => void;
  onQuantityChange: (colorId: string, sizeId: string, qty: number) => void;
}

const cellKey = (colorId: string, sizeId: string) => `${colorId}__${sizeId}`;
const displayName = (c: Step1Color) => c.commercialName ?? c.label;

// ────────────────────────────────────────────────────────────
// Root
// ────────────────────────────────────────────────────────────

export const Step1ProductQuantities = memo(function Step1ProductQuantities({
  product,
  sizes,
  availableColors,
  activeColorIds,
  quantities,
  onActivateColor,
  onDeactivateColor,
  onQuantityChange,
}: Step1Props) {
  const sortedSizes = useMemo(
    () => [...sizes].sort((a, b) => a.order - b.order),
    [sizes],
  );

  const activeSet = useMemo(() => new Set(activeColorIds), [activeColorIds]);
  const activeColors = useMemo(
    () =>
      availableColors
        .filter((c) => activeSet.has(c.id))
        .sort(
          (a, b) =>
            activeColorIds.indexOf(a.id) - activeColorIds.indexOf(b.id),
        ),
    [availableColors, activeColorIds, activeSet],
  );
  const inactiveColors = useMemo(
    () => availableColors.filter((c) => !activeSet.has(c.id)),
    [availableColors, activeSet],
  );

  const totalQty = useMemo(
    () => Object.values(quantities).reduce((a, b) => a + b, 0),
    [quantities],
  );

  return (
    <section
      className="mx-auto flex w-full max-w-5xl flex-col gap-6 font-sans antialiased"
      aria-labelledby="step1-title"
    >
      <h2 id="step1-title" className="sr-only">
        Étape 1 — Produit et quantités
      </h2>

      <ProductHeaderCard product={product} totalQty={totalQty} />

      <Step1ColorSelector
        activeColors={activeColors}
        inactiveColors={inactiveColors}
        onActivate={onActivateColor}
        onDeactivate={onDeactivateColor}
      />

      {activeColors.length === 0 ? (
        <EmptyState />
      ) : (
        <Step1SizeQuantityGrid
          sizes={sortedSizes}
          colors={activeColors}
          quantities={quantities}
          onChange={onQuantityChange}
        />
      )}
    </section>
  );
});

// ────────────────────────────────────────────────────────────
// Product header card
// ────────────────────────────────────────────────────────────

function ProductHeaderCard({
  product,
  totalQty,
}: {
  product: Step1Product;
  totalQty: number;
}) {
  return (
    <header className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white px-5 py-4">
      <div className="h-16 w-16 flex-none overflow-hidden rounded-xl bg-gray-50 ring-1 ring-inset ring-gray-200">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name ?? product.reference}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] font-medium uppercase tracking-wider text-gray-400">
            visuel
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
          {product.category}
        </span>
        <span className="truncate text-base font-semibold text-gray-900">
          {product.name ?? product.reference}
        </span>
        <span className="font-mono text-xs text-gray-400">
          {product.reference}
        </span>
      </div>

      <div className="flex flex-col items-end pl-4">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
          Total partiel
        </span>
        <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-gray-900">
          {totalQty}
          <span className="ml-1 text-xs font-medium text-gray-400">pcs</span>
        </span>
      </div>
    </header>
  );
}

// ────────────────────────────────────────────────────────────
// Color selector — active pills + dropdown to add a color
// ────────────────────────────────────────────────────────────

export function Step1ColorSelector({
  activeColors,
  inactiveColors,
  onActivate,
  onDeactivate,
}: {
  activeColors: Step1Color[];
  inactiveColors: Step1Color[];
  onActivate: (id: string) => void;
  onDeactivate: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500">
          Couleurs
        </h3>
        <span className="text-xs text-gray-400 tabular-nums">
          {activeColors.length} / {activeColors.length + inactiveColors.length}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activeColors.map((c) => (
          <ActiveColorPill
            key={c.id}
            color={c}
            onRemove={() => onDeactivate(c.id)}
          />
        ))}
        <AddColorButton inactive={inactiveColors} onPick={onActivate} />
      </div>
    </div>
  );
}

function ActiveColorPill({
  color,
  onRemove,
}: {
  color: Step1Color;
  onRemove: () => void;
}) {
  const label = displayName(color);
  return (
    <div
      className="group/pill relative inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white py-1 pl-1 pr-2.5 transition-colors duration-150 hover:border-gray-300"
      title={label}
    >
      <span
        aria-hidden
        className="h-6 w-6 flex-none rounded-full ring-1 ring-inset ring-gray-900/10"
        style={{ backgroundColor: color.hex }}
      />
      <span className="text-xs font-medium text-gray-900">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Retirer ${label}`}
        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 opacity-0 transition-all duration-150 hover:bg-gray-100 hover:text-gray-700 group-hover/pill:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300"
      >
        <X className="h-3 w-3" strokeWidth={2.25} />
      </button>
    </div>
  );
}

function AddColorButton({
  inactive,
  onPick,
}: {
  inactive: Step1Color[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Position the popover via fixed coordinates so it escapes any ancestor
  // overflow:hidden (the accordion panel clips its contents during animation).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (!r) return;
      const popoverWidth = 288; // matches w-72
      const margin = 8;
      let left = r.left;
      const maxLeft = window.innerWidth - popoverWidth - margin;
      if (left > maxLeft) left = Math.max(margin, maxLeft);
      setPos({ top: r.bottom + margin, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
    else setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return inactive;
    return inactive.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.commercialName?.toLowerCase().includes(q) ?? false),
    );
  }, [inactive, query]);

  const disabled = inactive.length === 0;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors duration-150 hover:border-gray-900 hover:bg-gray-50 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray-300 disabled:hover:bg-white disabled:hover:text-gray-600"
      >
        <Plus className="h-3.5 w-3.5" strokeWidth={2.25} />
        Ajouter une couleur
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Choisir une couleur"
            style={{ position: "fixed", top: pos.top, left: pos.left, width: 288 }}
            className="z-50 origin-top-left overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_10px_30px_-12px_rgba(15,23,42,0.18),0_2px_6px_-1px_rgba(15,23,42,0.06)]"
          >
            <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
              <Search className="h-3.5 w-3.5 flex-none text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher une couleur…"
                className="block w-full border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
              />
            </div>

            <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-3 text-center text-xs text-gray-400">
                  Aucune couleur
                </li>
              ) : (
                filtered.map((c) => (
                  <li key={c.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(c.id);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors duration-100 hover:bg-gray-50"
                    >
                      <span
                        aria-hidden
                        className="h-5 w-5 flex-none rounded-full ring-1 ring-inset ring-gray-900/10"
                        style={{ backgroundColor: c.hex }}
                      />
                      <span className="truncate text-sm font-medium text-gray-900">
                        {displayName(c)}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}

// ────────────────────────────────────────────────────────────
// Empty state — when no color is yet active
// ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-gray-200 bg-white px-6 py-10 text-center">
      <span className="text-sm font-medium text-gray-700">
        Aucune couleur sélectionnée
      </span>
      <span className="text-xs text-gray-500">
        Ajoutez une couleur pour commencer la saisie des quantités.
      </span>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Size × Color grid
// ────────────────────────────────────────────────────────────

export const Step1SizeQuantityGrid = memo(function Step1SizeQuantityGrid({
  sizes,
  colors,
  quantities,
  onChange,
}: {
  sizes: Step1Size[];
  colors: Step1Color[];
  quantities: Record<string, number>;
  onChange: (colorId: string, sizeId: string, qty: number) => void;
}) {
  const refs = useRef<(HTMLInputElement | null)[][]>([]);

  const get = useCallback(
    (c: string, s: string) => quantities[cellKey(c, s)] ?? 0,
    [quantities],
  );

  const rowTotals = useMemo(
    () =>
      colors.map((c) => sizes.reduce((sum, sz) => sum + get(c.id, sz.id), 0)),
    [colors, sizes, get],
  );

  const colTotals = useMemo(
    () =>
      sizes.map((sz) => colors.reduce((sum, c) => sum + get(c.id, sz.id), 0)),
    [colors, sizes, get],
  );

  const grandTotal = colTotals.reduce((a, b) => a + b, 0);

  const focusCell = (ri: number, ci: number) => {
    const el = refs.current[ri]?.[ci];
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.select());
    }
  };

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
      const lr = colors.length - 1;
      const lc = sizes.length - 1;
      const el = e.currentTarget;
      const len = el.value.length;
      const start = el.selectionStart ?? 0;
      const endSel = el.selectionEnd ?? 0;
      const allSelected = start === 0 && endSel === len && len > 0;
      const atStart = start === 0 && endSel === 0;
      const atEnd = start === len && endSel === len;

      switch (e.key) {
        case "Enter":
        case "ArrowDown":
          e.preventDefault();
          if (ri < lr) focusCell(ri + 1, ci);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (ri > 0) focusCell(ri - 1, ci);
          break;
        case "ArrowRight":
          // Ne navigue que si le caret est en fin de champ ou si la valeur
          // est entièrement sélectionnée — sinon laisse l'édition naturelle.
          if (atEnd || allSelected) {
            e.preventDefault();
            if (ci < lc) focusCell(ri, ci + 1);
            else if (ri < lr) focusCell(ri + 1, 0);
          }
          break;
        case "ArrowLeft":
          if (atStart || allSelected) {
            e.preventDefault();
            if (ci > 0) focusCell(ri, ci - 1);
            else if (ri > 0) focusCell(ri - 1, lc);
          }
          break;
      }
    },
    [colors.length, sizes.length],
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <table className="w-full border-collapse">
        <colgroup>
          <col style={{ width: 200 }} />
          {sizes.map((sz) => (
            <col key={sz.id} />
          ))}
          <col style={{ width: 88 }} />
        </colgroup>

        <thead>
          <tr className="border-b border-gray-200">
            <th
              scope="col"
              className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500"
            >
              Couleur
            </th>
            {sizes.map((sz) => (
              <th
                key={sz.id}
                scope="col"
                className="px-1 py-2.5 text-center text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500"
              >
                {sz.label}
              </th>
            ))}
            <th
              scope="col"
              className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-700"
            >
              Total
            </th>
          </tr>
        </thead>

        <tbody>
          {colors.map((color, ri) => {
            if (!refs.current[ri]) refs.current[ri] = [];
            const rowTotal = rowTotals[ri] ?? 0;
            return (
              <tr
                key={color.id}
                className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/40"
              >
                <td className="px-4 py-2 align-middle">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      aria-hidden
                      className="h-5 w-5 flex-none rounded-full ring-1 ring-inset ring-gray-900/10"
                      style={{ backgroundColor: color.hex }}
                    />
                    <span className="truncate text-sm font-medium text-gray-900">
                      {displayName(color)}
                    </span>
                  </div>
                </td>
                {sizes.map((sz, ci) => {
                  const v = get(color.id, sz.id);
                  return (
                    <td key={sz.id} className="px-1 py-1.5">
                      <QtyInput
                        value={v}
                        ariaLabel={`${displayName(color)} · ${sz.label}`}
                        inputRef={(el) => {
                          refs.current[ri][ci] = el;
                        }}
                        onChange={(n) => onChange(color.id, sz.id, n)}
                        onKeyDown={(e) => handleKey(e, ri, ci)}
                      />
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-right">
                  <span
                    className={[
                      "font-mono text-sm tabular-nums",
                      rowTotal > 0
                        ? "font-semibold text-gray-900"
                        : "font-medium text-gray-300",
                    ].join(" ")}
                  >
                    {rowTotal}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-gray-300 bg-gray-50">
            <td className="px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-700">
              Total
            </td>
            {colTotals.map((t, i) => (
              <td
                key={i}
                className="px-1 py-3 text-center font-mono text-sm tabular-nums"
              >
                {t > 0 ? (
                  <span className="font-semibold text-gray-900">{t}</span>
                ) : (
                  <span className="font-medium text-gray-300">0</span>
                )}
              </td>
            ))}
            <td className="px-4 py-3 text-right font-mono text-base font-semibold tabular-nums text-gray-900">
              {grandTotal}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
});

// ────────────────────────────────────────────────────────────
// QtyInput — Google-Sheets-style data-entry cell.
//
// Uses `type="text" inputMode="numeric"` rather than `type="number"`:
// same numeric mobile keyboard, no native spinners (no CSS hack
// needed), AND `selectionStart/End` actually return numbers (the
// HTML spec leaves them null on type=number, which would break the
// caret-aware ArrowLeft/Right navigation in the parent grid).
//
// Local `draft` string lets the user clear the field mid-edit
// without a 0 reappearing under their fingers ; commit on every
// parseable keystroke and clamp silently to 0 on blur.
// `editingRef` blocks external prop sync from clobbering the
// draft while the user types (e.g. a sibling cell update fires).
// ────────────────────────────────────────────────────────────

interface QtyInputProps {
  value: number;
  ariaLabel: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (n: number) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

function QtyInput({
  value,
  ariaLabel,
  inputRef,
  onChange,
  onKeyDown,
}: QtyInputProps) {
  const [draft, setDraft] = useState<string>(value > 0 ? String(value) : "");
  const editingRef = useRef(false);

  // Sync from upstream only when the user is not actively editing
  // this cell (otherwise their keystrokes would get overwritten).
  useEffect(() => {
    if (!editingRef.current) setDraft(value > 0 ? String(value) : "");
  }, [value]);

  const isZero = value === 0;

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      value={draft}
      aria-label={ariaLabel}
      onFocus={(e) => {
        editingRef.current = true;
        const el = e.currentTarget;
        requestAnimationFrame(() => el.select());
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          setDraft("");
          // Don't commit yet — wait for blur to coerce to 0.
          return;
        }
        // Only non-negative integers allowed.
        if (!/^\d+$/.test(raw)) return;
        setDraft(raw);
        onChange(parseInt(raw, 10));
      }}
      onBlur={(e) => {
        editingRef.current = false;
        // Read from the DOM rather than the `draft` state — onBlur's
        // closure can hold a stale `draft` if React hasn't re-rendered
        // between the last keystroke and the blur (esp. under batching).
        const raw = e.currentTarget.value;
        const n = parseInt(raw, 10);
        const clamped = Math.max(0, Number.isFinite(n) ? n : 0);
        setDraft(clamped > 0 ? String(clamped) : "");
        if (clamped !== value) onChange(clamped);
      }}
      onKeyDown={onKeyDown}
      className={[
        "mx-auto block h-9 w-full max-w-[104px] rounded-md border bg-transparent text-center font-mono text-sm tabular-nums transition-colors duration-150 focus:outline-none",
        isZero
          ? "border-transparent text-gray-300 hover:border-gray-200 focus:border-gray-300"
          : "border-gray-200 font-bold text-gray-900 focus:border-gray-900 focus:ring-1 focus:ring-gray-900",
      ].join(" ")}
    />
  );
}

// ────────────────────────────────────────────────────────────
// Wiring example (zustand) — keep here as reference, do not export.
// ────────────────────────────────────────────────────────────
//
// const line = useNewOrderStore(selectLine);
// const upsert = useNewOrderStore((s) => s.upsertTextileItem);
// const model = getTextileModel(line.modelId);
//
// const quantities = useMemo(() => {
//   const out: Record<string, number> = {};
//   for (const it of Object.values(line.items)) {
//     if (!it.isPlaceholder) out[`${it.color}__${it.size}`] = it.qty;
//   }
//   return out;
// }, [line.items]);
//
// <Step1ProductQuantities
//   product={{
//     category: "T-shirt unisexe",
//     reference: model.reference,
//     name: model.name,
//     imageUrl: model.colors[0]?.mockupUrl,
//   }}
//   sizes={model.sizes}
//   availableColors={model.colors}
//   activeColorIds={[...activeColors]}
//   quantities={quantities}
//   onActivateColor={(id) => activate(id)}
//   onDeactivateColor={(id) => deactivate(id)}
//   onQuantityChange={(c, s, q) =>
//     upsert({ id: `${c}__${s}`, color: c, size: s, qty: q })
//   }
// />
