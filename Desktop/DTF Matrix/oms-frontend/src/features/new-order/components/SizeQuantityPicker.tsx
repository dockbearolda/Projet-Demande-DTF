import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { selectLine, useNewOrderStore } from "../store";
import {
  isTextileLine,
  type TextileColor,
  type TextileLine,
  type TextileSize,
} from "../types";
import { getTextileModel } from "../runtimeCatalog";

interface Props {
  /** Colors currently selected — drives the rows of the matrix. */
  activeColors: Set<string>;
  /** Activate a color from the bubble strip (= add a new row in the matrix). */
  onActivateColor?: (colorId: string) => void;
  /** Deactivate a color from the bubble strip (= remove its row + items). */
  onDeactivateColor?: (colorId: string) => void;
}

/**
 * SizeQuantityPicker — grille couleurs × tailles.
 *
 * Les couleurs actives proviennent du catalogue fournisseur ;
 * cette grille n'affiche que ces couleurs sans colonne de toggle.
 */
export const SizeQuantityPicker = memo(function SizeQuantityPicker({
  activeColors,
  onActivateColor,
  onDeactivateColor,
}: Props) {
  const line = useNewOrderStore(selectLine);
  if (!line || !isTextileLine(line)) return null;
  return (
    <Inner
      line={line}
      activeColors={activeColors}
      onActivateColor={onActivateColor}
      onDeactivateColor={onDeactivateColor}
    />
  );
});

// ─────────────────────────────────────────────────────────────
// Inner — the actual grid
// ─────────────────────────────────────────────────────────────

function Inner({
  line,
  activeColors,
  onActivateColor,
  onDeactivateColor,
}: {
  line: TextileLine;
  activeColors: Set<string>;
  onActivateColor?: (colorId: string) => void;
  onDeactivateColor?: (colorId: string) => void;
}) {
  const upsert = useNewOrderStore((s) => s.upsertTextileItem);

  const model = useMemo(
    () => getTextileModel(line.modelId) ?? null,
    [line.modelId],
  );

  const sortedSizes = useMemo<TextileSize[]>(
    () => (model ? [...model.sizes].sort((a, b) => a.order - b.order) : []),
    [model],
  );

  const colorsOrdered = useMemo(
    () => (model ? model.colors.filter((c) => activeColors.has(c.id)) : []),
    [model, activeColors],
  );

  // ── Ref grid [row][col] for keyboard navigation ──
  const refs = useRef<(HTMLInputElement | null)[][]>([]);

  // ── Qty helpers — deterministic item ID: colorId__sizeId ──

  const getQty = useCallback(
    (colorId: string, sizeId: string): number =>
      line.items[`${colorId}__${sizeId}`]?.qty ?? 0,
    [line.items],
  );

  const setQty = useCallback(
    (colorId: string, sizeId: string, rawQty: number) => {
      upsert({
        id: `${colorId}__${sizeId}`,
        color: colorId,
        size: sizeId,
        qty: Math.max(0, rawQty || 0),
      });
    },
    [upsert],
  );

  // ── Keyboard navigation ──

  const focusCell = useCallback((ri: number, ci: number) => {
    const el = refs.current[ri]?.[ci];
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.select());
    }
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
      const lastRow = colorsOrdered.length - 1;
      const lastCol = sortedSizes.length - 1;
      const el = e.currentTarget;
      const len = el.value.length;
      const start = el.selectionStart ?? 0;
      const endSel = el.selectionEnd ?? 0;
      const allSelected = start === 0 && endSel === len && len > 0;
      const atStart = start === 0 && endSel === 0;
      const atEnd = start === len && endSel === len;

      switch (e.key) {
        case "Enter":
          e.preventDefault();
          if (ri < lastRow) focusCell(ri + 1, ci);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (ri < lastRow) focusCell(ri + 1, ci);
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
            if (ci < lastCol) focusCell(ri, ci + 1);
            else if (ri < lastRow) focusCell(ri + 1, 0);
          }
          break;
        case "ArrowLeft":
          if (atStart || allSelected) {
            e.preventDefault();
            if (ci > 0) focusCell(ri, ci - 1);
            else if (ri > 0) focusCell(ri - 1, lastCol);
          }
          break;
        // Tab/Shift+Tab : pas d'interception → ordre DOM naturel
        // (XS → S → M → ... → 3XL → ligne suivante).
      }
    },
    [colorsOrdered.length, sortedSizes.length, focusCell],
  );

  // ── First-focus hint ("Tab ou ↑↓←→ pour naviguer") ──

  const HINT_KEY = "dtf:qty-grid-hint-seen";
  const [hintVisible, setHintVisible] = useState(false);
  const hintTimerRef = useRef<number | null>(null);

  const dismissHint = useCallback((markSeen: boolean) => {
    if (hintTimerRef.current) {
      window.clearTimeout(hintTimerRef.current);
      hintTimerRef.current = null;
    }
    setHintVisible(false);
    if (markSeen) {
      try {
        localStorage.setItem(HINT_KEY, "1");
      } catch {
        /* localStorage unavailable */
      }
    }
  }, []);

  const handleCellFocus = useCallback(
    (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.select();
      let seen = false;
      try {
        seen = localStorage.getItem(HINT_KEY) === "1";
      } catch {
        seen = true;
      }
      if (seen || hintVisible || hintTimerRef.current) return;
      setHintVisible(true);
      hintTimerRef.current = window.setTimeout(() => dismissHint(true), 3000);
    },
    [hintVisible, dismissHint],
  );

  useEffect(
    () => () => {
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    },
    [],
  );

  // ── Power-mode quick-fill ──

  const handleQuickFill = useCallback(
    (colorId: string, parsed: ParseResult) => {
      if (parsed.kind === "fill-empty") {
        for (const sz of sortedSizes) {
          if (getQty(colorId, sz.id) === 0) {
            setQty(colorId, sz.id, parsed.value);
          }
        }
      } else {
        for (const [sizeId, v] of Object.entries(parsed.values)) {
          setQty(colorId, sizeId, v);
        }
      }
    },
    [sortedSizes, getQty, setQty],
  );

  // ── Derived totals ──

  const rowTotals = useMemo(
    () => colorsOrdered.map((c) => sortedSizes.reduce((s, sz) => s + getQty(c.id, sz.id), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line.items, colorsOrdered, sortedSizes],
  );

  const colTotals = useMemo(
    () => sortedSizes.map((sz) => colorsOrdered.reduce((s, c) => s + getQty(c.id, sz.id), 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [line.items, colorsOrdered, sortedSizes],
  );

  const grandTotal = colTotals.reduce((s, v) => s + v, 0);

  if (!model || colorsOrdered.length === 0) return null;

  return (
    <div className="space-y-3" data-qty-grid>
      {model && (onActivateColor || onDeactivateColor) && (
        <ColorDotsStrip
          colors={model.colors}
          activeColors={activeColors}
          onActivate={onActivateColor}
          onDeactivate={onDeactivateColor}
        />
      )}

      <div
        className="relative"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            dismissHint(false);
          }
        }}
      >
        {hintVisible && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute -top-9 right-2 z-20 rounded-md bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg animate-in fade-in slide-in-from-bottom-1 duration-150"
          >
            <span aria-hidden="true">⌨ </span>
            Tab ou ↑↓←→ pour naviguer
          </div>
        )}
        {/* Scroll surface — bornée pour ne jamais pousser le footer/CTA hors viewport.
            Scroll interne uniquement ; en-tête et ligne de total figés via sticky cells. */}
        <div className="max-h-[clamp(220px,calc(100dvh-420px),640px)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col style={{ width: 160 }} />
            {sortedSizes.map((sz) => (
              <col key={sz.id} />
            ))}
            <col style={{ width: 52 }} />
            <col style={{ width: 96 }} />
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 z-10 bg-slate-50 py-2 pl-3 pr-2 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-[inset_0_-1px_0_0_#e2e8f0]"
              >
                Couleur
              </th>
              {sortedSizes.map((sz) => (
                <th
                  key={sz.id}
                  scope="col"
                  className="sticky top-0 z-10 bg-slate-50 px-1 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-[inset_0_-1px_0_0_#e2e8f0]"
                >
                  {sz.label}
                </th>
              ))}
              <th
                scope="col"
                className="sticky top-0 z-10 bg-slate-100 px-2 py-2 text-right text-[11px] font-extrabold uppercase tracking-wider text-slate-700 shadow-[inset_0_-1px_0_0_#e2e8f0]"
              >
                Total
              </th>
              <th
                scope="col"
                className="sticky top-0 z-10 bg-slate-50 px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-[inset_0_-1px_0_0_#e2e8f0]"
              >
                Remplir
              </th>
            </tr>
          </thead>

          <tbody>
            {colorsOrdered.map((color, ri) => {
              if (!refs.current[ri]) refs.current[ri] = [];
              const rowTotal = rowTotals[ri] ?? 0;

              return (
                <tr
                  key={color.id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="py-2 pl-3 pr-2 align-middle">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`block h-4 w-4 flex-none rounded-sm ${
                          color.swatchBorder ? "ring-1 ring-slate-300" : ""
                        }`}
                        style={{ backgroundColor: color.hex }}
                      />
                      <span className="truncate text-[13px] font-semibold text-slate-900">
                        {color.label}
                      </span>
                    </div>
                  </td>

                  {sortedSizes.map((sz, ci) => {
                    const qty = getQty(color.id, sz.id);
                    return (
                      <td key={sz.id} className="px-1 py-1.5">
                        <QtyCell
                          qty={qty}
                          colorLabel={color.label}
                          sizeLabel={sz.label}
                          inputRef={(el) => {
                            refs.current[ri][ci] = el;
                          }}
                          onCommit={(v) => setQty(color.id, sz.id, v)}
                          onKeyDown={(e) => handleKeyDown(e, ri, ci)}
                          onFocus={handleCellFocus}
                        />
                      </td>
                    );
                  })}

                  <td className="bg-slate-50 px-2 py-2 text-right">
                    <span
                      className={`font-mono text-sm font-extrabold tabular-nums ${
                        rowTotal > 0 ? "text-slate-900" : "text-slate-400"
                      }`}
                      aria-label={`Sous-total ${color.label} : ${rowTotal}`}
                    >
                      {rowTotal > 0 ? rowTotal : 0}
                    </span>
                  </td>

                  <td className="px-2 py-1.5">
                    <QuickFillInput
                      colorLabel={color.label}
                      sizes={sortedSizes}
                      onApply={(parsed) => handleQuickFill(color.id, parsed)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>

          <tfoot>
            <tr>
              <td className="sticky bottom-0 z-10 bg-[#F4F4F2] py-2 pl-3 pr-2 text-[11px] font-semibold uppercase tracking-wider text-slate-700 shadow-[inset_0_2px_0_0_#cbd5e1]">
                Total
              </td>
              {colTotals.map((total, i) => (
                <td
                  key={i}
                  className="sticky bottom-0 z-10 bg-[#F4F4F2] px-1 py-2 text-center shadow-[inset_0_2px_0_0_#cbd5e1]"
                >
                  <span
                    className={`font-mono text-sm font-semibold tabular-nums ${
                      total > 0 ? "text-slate-900" : "text-slate-500"
                    }`}
                  >
                    {total > 0 ? total : 0}
                  </span>
                </td>
              ))}
              <td className="sticky bottom-0 z-10 bg-[#F4F4F2] px-2 py-2 text-right shadow-[inset_0_2px_0_0_#cbd5e1]">
                <span className="font-mono text-base font-semibold tabular-nums text-slate-900">
                  {grandTotal > 0 ? grandTotal : 0}
                </span>
              </td>
              <td
                aria-hidden="true"
                className="sticky bottom-0 z-10 bg-[#F4F4F2] shadow-[inset_0_2px_0_0_#cbd5e1]"
              />
            </tr>
          </tfoot>
        </table>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-xl border-2 border-slate-900 bg-slate-900 px-4 py-3 text-white">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
          Total commande
        </span>
        <span className="font-mono text-lg font-extrabold tabular-nums">
          {grandTotal}{" "}
          <span className="text-xs font-medium text-slate-300">pcs</span>
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// QtyCell — minimalist Google-Sheets-style data-entry cell.
//
// Single <input type="number"> with native spinners hidden via
// `.qty-cell-input` (see index.css). Local `draft` string so the
// user can clear the field mid-edit without a 0 reappearing under
// their fingers ; commit on every parseable keystroke and on blur.
// `editingRef` blocks external commits from clobbering the draft
// while the user types (e.g. a sibling quick-fill firing).
// ─────────────────────────────────────────────────────────────

interface QtyCellProps {
  qty: number;
  colorLabel: string;
  sizeLabel: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onCommit: (value: number) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
}

function QtyCell({
  qty,
  colorLabel,
  sizeLabel,
  inputRef,
  onCommit,
  onKeyDown,
  onFocus,
}: QtyCellProps) {
  const [draft, setDraft] = useState<string>(qty > 0 ? String(qty) : "");
  const editingRef = useRef(false);

  // Sync from upstream only when the user is not actively editing
  // this cell (otherwise their keystrokes would get overwritten).
  useEffect(() => {
    if (!editingRef.current) setDraft(qty > 0 ? String(qty) : "");
  }, [qty]);

  const hasValue = qty > 0;

  return (
    <input
      ref={inputRef}
      type="number"
      inputMode="numeric"
      min={0}
      step={1}
      value={draft}
      aria-label={`${colorLabel} · taille ${sizeLabel}`}
      onFocus={(e) => {
        editingRef.current = true;
        onFocus(e);
      }}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") {
          setDraft("");
          // Don't commit yet — wait for blur to coerce to 0.
          return;
        }
        // Reject anything that isn't a non-negative integer
        // (blocks `e`, `+`, `-`, `.` from `type=number`).
        if (!/^\d+$/.test(raw)) return;
        setDraft(raw);
        onCommit(parseInt(raw, 10));
      }}
      onBlur={() => {
        editingRef.current = false;
        const n = parseInt(draft, 10);
        const clamped = Math.max(0, Number.isFinite(n) ? n : 0);
        setDraft(clamped > 0 ? String(clamped) : "");
        if (clamped !== qty) onCommit(clamped);
      }}
      onKeyDown={onKeyDown}
      className={[
        "qty-cell-input mx-auto block h-[38px] w-full max-w-[130px] rounded-lg border tabular-nums transition-colors duration-[140ms] focus:outline-none",
        hasValue
          ? "border-blue-200 bg-[#EFF6FF] text-sm font-bold text-blue-700"
          : "border-transparent bg-transparent text-sm text-slate-400 hover:border-slate-300 focus:border-slate-300",
      ].join(" ")}
      style={{ textAlign: "center" }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// QuickFillInput — power-mode "remplissage rapide" par couleur.
// "5"           → remplit toutes les tailles vides (qty=0) avec 5
// "M:4 L:6 XL:2" → patche M=4, L=6, XL=2 (espaces ou virgules ok)
// ─────────────────────────────────────────────────────────────

type ParseResult =
  | { kind: "fill-empty"; value: number }
  | { kind: "patch"; values: Record<string, number> };

function parseQuickFill(input: string, sizes: TextileSize[]): ParseResult | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { kind: "fill-empty", value: parseInt(trimmed, 10) };
  }
  const tokens = trimmed.split(/[\s,]+/).filter(Boolean);
  const values: Record<string, number> = {};
  const sizeIdByLabel = new Map(sizes.map((s) => [s.label.toLowerCase(), s.id]));
  for (const token of tokens) {
    const m = token.match(/^([A-Za-z0-9]+)[:=](\d+)$/);
    if (!m) return null;
    const sizeId = sizeIdByLabel.get(m[1].toLowerCase());
    if (!sizeId) return null;
    values[sizeId] = parseInt(m[2], 10);
  }
  return Object.keys(values).length ? { kind: "patch", values } : null;
}

function QuickFillInput({
  colorLabel,
  sizes,
  onApply,
}: {
  colorLabel: string;
  sizes: TextileSize[];
  onApply: (parsed: ParseResult) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState(false);
  const [focused, setFocused] = useState(false);

  const submit = () => {
    const parsed = parseQuickFill(value, sizes);
    if (!parsed) {
      setError(true);
      window.setTimeout(() => setError(false), 600);
      return;
    }
    onApply(parsed);
    setValue("");
  };

  const tooltipId = `qf-tip-${colorLabel.replace(/\s+/g, "-")}`;

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        placeholder="Remplir"
        title={`Remplissage rapide ${colorLabel} — saisir un nombre (ex: 5) pour remplir les tailles vides, ou des paires (ex: M:4 L:6 XL:2) pour cibler des tailles précises. Entrée pour valider.`}
        aria-label={`Remplissage rapide ${colorLabel}`}
        aria-describedby={focused ? tooltipId : undefined}
        tabIndex={-1}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        className={[
          "block w-full rounded-md border bg-white px-2 py-1 text-xs text-slate-700 tabular-nums placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30",
          error
            ? "border-red-400 ring-2 ring-red-200"
            : "border-slate-200 hover:border-slate-300 focus:border-slate-400",
        ].join(" ")}
      />
      {focused && (
        <div
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none absolute right-0 top-full z-30 mt-1 w-[260px] rounded-md bg-slate-900 px-3 py-2 text-[11px] leading-snug text-white shadow-lg animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <div className="mb-1 font-semibold text-slate-100">
            Remplissage rapide — {colorLabel}
          </div>
          <div className="space-y-0.5 text-slate-300">
            <div>
              <code className="rounded bg-slate-800 px-1 font-mono text-slate-100">5</code>{" "}
              · remplit les tailles vides
            </div>
            <div>
              <code className="rounded bg-slate-800 px-1 font-mono text-slate-100">
                M:4 L:6 XL:2
              </code>{" "}
              · tailles précises
            </div>
            <div className="pt-1 text-slate-400">↵ pour valider</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ColorDotsStrip — bandeau de bulles couleurs au-dessus de la
// grille. Cliquer une bulle inactive l'active (ajoute la ligne) ;
// cliquer une bulle active la désactive.
// ─────────────────────────────────────────────────────────────

interface ColorDotsStripProps {
  colors: TextileColor[];
  activeColors: Set<string>;
  onActivate?: (colorId: string) => void;
  onDeactivate?: (colorId: string) => void;
}

function ColorDotsStrip({
  colors,
  activeColors,
  onActivate,
  onDeactivate,
}: ColorDotsStripProps) {
  return (
    <div
      role="group"
      aria-label="Sélection des couleurs"
      className="flex flex-wrap gap-2"
    >
      {colors.map((c) => (
        <ColorBubble
          key={c.id}
          color={c}
          active={activeColors.has(c.id)}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
        />
      ))}
    </div>
  );
}

interface ColorBubbleProps {
  color: TextileColor;
  active: boolean;
  onActivate?: (colorId: string) => void;
  onDeactivate?: (colorId: string) => void;
}

function ColorBubble({
  color,
  active,
  onActivate,
  onDeactivate,
}: ColorBubbleProps) {
  const label = color.commercialName ?? color.label;
  const tooltip = active
    ? `${label} — activée (cliquer pour retirer)`
    : `${label} — cliquer pour activer`;
  const baseShadow =
    "0 1px 3px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(0,0,0,0.06)";
  const haloShadow = `0 0 0 2px #ffffff, 0 0 0 4px #007AFF, ${baseShadow}`;
  const checkLight = isLightHex(color.hex);
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={active}
      onClick={() => {
        if (active) onDeactivate?.(color.id);
        else onActivate?.(color.id);
      }}
      className="swatch-pip relative flex-none cursor-pointer rounded-full p-0 transition-transform duration-200 ease-out hover:scale-[1.08] focus:outline-none focus-visible:scale-[1.08]"
      style={{
        width: 32,
        height: 32,
        backgroundColor: color.hex,
        boxShadow: active ? haloShadow : baseShadow,
      }}
    >
      {active && (
        <Check
          className={`absolute inset-0 m-auto h-4 w-4 ${
            checkLight ? "text-slate-900" : "text-white"
          }`}
          strokeWidth={3}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/** Returns true if the swatch background is light enough to need a dark check. */
function isLightHex(hex: string): boolean {
  const m = hex.replace("#", "");
  if (m.length !== 6 && m.length !== 3) return false;
  const expand =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(expand.slice(0, 2), 16);
  const g = parseInt(expand.slice(2, 4), 16);
  const b = parseInt(expand.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  // Relative luminance (sRGB approximation)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.7;
}
