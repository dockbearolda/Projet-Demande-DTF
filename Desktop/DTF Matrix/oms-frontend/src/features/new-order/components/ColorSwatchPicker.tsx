import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { TextileColor } from "../types";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

interface Props {
  colors: TextileColor[];
  activeColors: Set<string>;
  onToggleColor: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

const SEARCH_THRESHOLD = 12;

/**
 * ColorSwatchPicker — grille de couleurs avec ergonomie tactile (S3).
 *
 * - Tuiles ≥ 56×56 px (cible WCAG 2.5.5 AA confortable même en doigt).
 * - Sélection / désélection au clic, action rapide tout/effacer + compteur.
 * - Navigation clavier 2D (flèches), Espace pour toggle, A tout sélectionner,
 *   X pour effacer (raccourcis actifs uniquement quand le focus est dans le picker).
 * - Recherche instantanée par nom ou référence si > 12 couleurs.
 */
export const ColorSwatchPicker = memo(function ColorSwatchPicker({
  colors,
  activeColors,
  onToggleColor,
  onSelectAll,
  onClearAll,
}: Props) {
  const [query, setQuery] = useState("");
  const showSearch = colors.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return colors;
    return colors.filter((c) => {
      return (
        c.label.toLowerCase().includes(q) ||
        c.pantone?.toLowerCase().includes(q) ||
        c.manufacturerCode?.toLowerCase().includes(q) ||
        c.commercialName?.toLowerCase().includes(q)
      );
    });
  }, [colors, query]);

  const containerRef = useRef<HTMLDivElement>(null);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [hasFocus, setHasFocus] = useState(false);

  // Detect column count from the rendered CSS grid so arrow Up/Down jumps the right
  // number of cells regardless of viewport. Falls back to 4.
  const [columns, setColumns] = useState(4);
  useEffect(() => {
    function update() {
      const grid = containerRef.current?.querySelector<HTMLElement>(
        "[data-swatch-grid]",
      );
      if (!grid) return;
      const tpl = window.getComputedStyle(grid).gridTemplateColumns;
      const n = tpl.split(" ").filter(Boolean).length;
      if (n > 0) setColumns(n);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [filtered.length]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
      const last = filtered.length - 1;
      if (last < 0) return;

      if (e.key === " " || e.key === "Spacebar" || e.key === "Enter") {
        e.preventDefault();
        onToggleColor(filtered[idx].id);
        return;
      }

      let next = idx;
      switch (e.key) {
        case "ArrowRight":
          next = idx < last ? idx + 1 : 0;
          break;
        case "ArrowLeft":
          next = idx > 0 ? idx - 1 : last;
          break;
        case "ArrowDown":
          next = Math.min(idx + columns, last);
          break;
        case "ArrowUp":
          next = Math.max(idx - columns, 0);
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = last;
          break;
        default:
          return;
      }
      e.preventDefault();
      swatchRefs.current[next]?.focus();
    },
    [filtered, columns, onToggleColor],
  );

  useKeyboardShortcuts(
    [
      {
        key: "a",
        label: "Tout sélectionner",
        group: "S3 — Couleurs",
        handler: () => onSelectAll(),
      },
      {
        key: "x",
        label: "Effacer la sélection",
        group: "S3 — Couleurs",
        handler: () => onClearAll(),
      },
    ],
    { enabled: hasFocus },
  );

  const selectedCount = activeColors.size;
  const totalCount = colors.length;
  const allSelected = selectedCount === totalCount && totalCount > 0;
  const noneSelected = selectedCount === 0;

  return (
    <div
      ref={containerRef}
      data-color-picker
      onFocus={() => setHasFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHasFocus(false);
        }
      }}
      className="space-y-3"
    >
      {/* Toolbar : compteur + actions rapides */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="text-[12px] font-semibold text-slate-700"
        >
          {noneSelected ? (
            <span className="text-slate-500">Aucune couleur sélectionnée</span>
          ) : (
            <>
              <span className="text-blue-700">{selectedCount}</span>
              <span className="text-slate-700">
                {" "}
                couleur{selectedCount > 1 ? "s" : ""} sélectionnée
                {selectedCount > 1 ? "s" : ""}
              </span>
              <span className="text-slate-400"> / {totalCount}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={allSelected}
            aria-keyshortcuts="A"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Tout sélectionner
          </button>
          <button
            type="button"
            onClick={onClearAll}
            disabled={noneSelected}
            aria-keyshortcuts="X"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Effacer la sélection
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Rechercher une couleur ou référence…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher une couleur"
            className="block h-10 w-full rounded-md border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
          Aucune couleur ne correspond à « {query} ».
        </div>
      ) : (
        <div
          role="group"
          aria-label="Couleurs disponibles"
          data-swatch-grid
          className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
        >
          {filtered.map((color, idx) => (
            <SwatchTile
              key={color.id}
              color={color}
              isActive={activeColors.has(color.id)}
              onClick={() => onToggleColor(color.id)}
              onKeyDown={(e) => handleKey(e, idx)}
              tileRef={(el) => {
                swatchRefs.current[idx] = el;
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ─────────────────────────────────────────────────────────────
// SwatchTile — une tuile cliquable (≥ 56×56 swatch + nom + ref)
// ─────────────────────────────────────────────────────────────

interface SwatchTileProps {
  color: TextileColor;
  isActive: boolean;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  tileRef: (el: HTMLButtonElement | null) => void;
}

function SwatchTile({
  color,
  isActive,
  onClick,
  onKeyDown,
  tileRef,
}: SwatchTileProps) {
  const reference =
    color.pantone || color.manufacturerCode || color.commercialName || null;
  const checkOnLight = isLightColor(color.hex);
  const ariaLabel = `Couleur ${color.label}${
    reference ? `, code ${reference}` : ""
  }, ${isActive ? "sélectionnée" : "non sélectionnée"}`;

  return (
    <button
      ref={tileRef}
      type="button"
      role="checkbox"
      aria-checked={isActive}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`group relative flex flex-col items-center gap-1.5 rounded-xl border-[3px] bg-white p-2 text-center transition-all duration-150 active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-600 ${
        isActive
          ? "border-blue-600 shadow-[0_2px_8px_rgba(37,99,235,0.18)]"
          : "border-slate-200 hover:border-slate-400 hover:shadow-sm"
      }`}
    >
      <span
        aria-hidden="true"
        className={`relative flex h-14 w-14 flex-none items-center justify-center rounded-lg shadow-[0_1px_2px_rgba(15,23,42,0.18)] ${
          color.swatchBorder ? "ring-1 ring-slate-300" : ""
        }`}
        style={{ backgroundColor: color.hex }}
      >
        {isActive && (
          <span
            className={`absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full ${
              checkOnLight
                ? "bg-white text-slate-900 ring-1 ring-slate-300"
                : "bg-slate-900/85 text-white"
            }`}
          >
            <CheckmarkIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </span>
      <span className="block w-full truncate text-sm font-semibold text-slate-900">
        {color.label}
      </span>
      {reference && (
        <span className="block w-full truncate text-[11px] text-slate-500">
          {reference}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

// Threshold 0.6 keeps deep blues (navy, royal) and saturated greens in the
// "dark" bucket so the white check stays readable.
function isLightColor(hex: string): boolean {
  const h = hex.replace(/^#/, "");
  if (h.length !== 6) return true;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return true;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6;
}

function CheckmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
