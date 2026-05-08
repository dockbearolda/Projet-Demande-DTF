"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { getAvailableSlots, type DaySlots } from "@/lib/pickup";

interface Props {
  value: string | null;
  onChange: (iso: string) => void;
  onUrgencyChange?: (urgent: boolean) => void;
}

const FR_WEEKDAY_SHORT = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];

const FR_MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
];

function isoDateOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PickupSlotPicker({ value, onChange, onUrgencyChange }: Props) {
  const days = useMemo<DaySlots[]>(
    () => getAvailableSlots(),
    [],
  );

  const availableIsoDates = useMemo(
    () => new Set(days.map((d) => d.isoDate)),
    [days],
  );

  const initialIsoDate = useMemo(() => {
    if (value) {
      const valueDate = new Date(value);
      const iso = isoDateOf(valueDate);
      if (availableIsoDates.has(iso)) return iso;
    }
    return days[0]?.isoDate ?? null;
  }, [value, days, availableIsoDates]);

  const [selectedIsoDate, setSelectedIsoDate] = useState<string | null>(
    initialIsoDate,
  );

  const [currentMonth, setCurrentMonth] = useState<Date>(() => {
    if (initialIsoDate) {
      const [year, month] = initialIsoDate.split("-").slice(0, 2);
      return new Date(parseInt(year), parseInt(month) - 1, 1);
    }
    return new Date();
  });

  useEffect(() => {
    if (!selectedIsoDate && initialIsoDate) {
      setSelectedIsoDate(initialIsoDate);
    }
  }, [initialIsoDate, selectedIsoDate]);

  if (days.length === 0) {
    return (
      <div className="rounded-3xl border border-line bg-white/70 p-5 text-sm text-ink/70 shadow-soft">
        Aucun créneau de récupération disponible. Contacte-nous pour organiser
        ta récupération.
      </div>
    );
  }

  const selectedDay = days.find((d) => d.isoDate === selectedIsoDate) ?? null;

  const firstDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1,
  );
  const lastDayOfMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  );
  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(startDate.getDate() - firstDayOfMonth.getDay());

  const calendarDays: (DaySlots | null)[] = [];
  let currentDate = new Date(startDate);
  while (currentDate <= lastDayOfMonth) {
    const iso = isoDateOf(currentDate);
    const dayData = days.find((d) => d.isoDate === iso);
    calendarDays.push(dayData || null);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const previousMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
    );
  };

  const nextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
    );
  };

  return (
    <div className="rounded-3xl border border-line bg-white/70 p-4 shadow-soft sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold capitalize tracking-tight text-ink sm:text-base">
          {FR_MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={previousMonth}
            className="p-1 transition-colors hover:bg-sand/50"
            aria-label="Mois précédent"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            className="p-1 transition-colors hover:bg-sand/50"
            aria-label="Mois suivant"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-1">
        {FR_WEEKDAY_SHORT.map((day) => (
          <div
            key={day}
            className="text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-ink/50"
          >
            {day}
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {calendarDays.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} />;
          }

          const isSelected = day.isoDate === selectedIsoDate;
          const isCurrentMonth =
            day.day.getMonth() === currentMonth.getMonth();

          return (
            <button
              key={day.isoDate}
              type="button"
              onClick={() => setSelectedIsoDate(day.isoDate)}
              className={cn(
                "flex items-center justify-center rounded-lg border py-2 text-xs font-semibold transition-colors",
                !isCurrentMonth && "opacity-30",
                isSelected
                  ? "border-paprika bg-paprika text-sand-soft shadow-soft"
                  : "border-line bg-white text-ink hover:bg-sand/50",
              )}
              aria-pressed={isSelected}
              disabled={!isCurrentMonth}
            >
              {day.day.getDate()}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="border-t border-line/60 pt-4">
          <p className="mb-2.5 text-xs font-semibold uppercase tracking-[0.2em] text-ink/60">
            Choisis un créneau
          </p>
          <div className="flex flex-wrap gap-2">
            {selectedDay.slots.map((slot) => {
              const iso = slot.start.toISOString();
              const selected = iso === value;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    onChange(iso);
                    onUrgencyChange?.(false);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-colors",
                    selected
                      ? "border-paprika bg-paprika text-sand-soft"
                      : "border-line bg-white text-ink hover:bg-sand",
                  )}
                  aria-pressed={selected}
                >
                  {selected && <Check className="h-3 w-3" aria-hidden />}
                  {slot.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
