import { useState, useImperativeHandle, forwardRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export type DateMode = "before" | "on" | "after";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export interface SearchDatePickerHandle {
  apply: () => void;
}

export interface SearchDatePickerProps {
  mode: DateMode;
  onApply: (dateStr: string) => void;
  initialDate?: string | null;
}

export const SearchDatePicker = forwardRef<SearchDatePickerHandle, SearchDatePickerProps>(
  function SearchDatePicker({ mode, onApply, initialDate }, ref) {
    const todayInit = new Date();

    function parseInitial(): { year: number; month: number; day: number } {
      if (initialDate) {
        const m = initialDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          const y = parseInt(m[1]);
          const mo = parseInt(m[2]) - 1;
          const d = parseInt(m[3]);
          return { year: y, month: mo, day: Math.min(d, daysInMonth(y, mo)) };
        }
      }
      return { year: todayInit.getFullYear(), month: todayInit.getMonth(), day: todayInit.getDate() };
    }

    const init = parseInitial();
    const [pickerYear, setPickerYear] = useState(init.year);
    const [pickerMonth, setPickerMonth] = useState(init.month);
    const [pickerDay, setPickerDay] = useState(init.day);

    function handleMonthChange(newMonth: number) {
      setPickerMonth(newMonth);
      const maxD = daysInMonth(pickerYear, newMonth);
      if (pickerDay > maxD) setPickerDay(maxD);
    }

    function handleYearChange(delta: number) {
      const newYear = pickerYear + delta;
      setPickerYear(newYear);
      const maxD = daysInMonth(newYear, pickerMonth);
      if (pickerDay > maxD) setPickerDay(maxD);
    }

    function handleDayChange(delta: number) {
      const maxD = daysInMonth(pickerYear, pickerMonth);
      setPickerDay((d) => Math.max(1, Math.min(maxD, d + delta)));
    }

    function handleApply() {
      const maxD = daysInMonth(pickerYear, pickerMonth);
      const safeDay = Math.min(pickerDay, maxD);
      const dateStr = formatDate(pickerYear, pickerMonth, safeDay);
      onApply(dateStr);
    }

    useImperativeHandle(ref, () => ({ apply: handleApply }));

    const label = mode === "before" ? "Before Date" : mode === "on" ? "On Date" : "After Date";

    return (
      <>
        <div className="search-filter-section-label">{label}</div>
        <div className="search-date-picker">
          <div className="search-date-picker-fields">
            <div className="search-date-picker-field">
              <span className="search-date-picker-label">Year</span>
              <div className="search-date-stepper">
                <button onMouseDown={(e) => { e.preventDefault(); handleYearChange(-1); }}><ChevronLeft size={11} /></button>
                <span>{pickerYear}</span>
                <button onMouseDown={(e) => { e.preventDefault(); handleYearChange(1); }}><ChevronRight size={11} /></button>
              </div>
            </div>
            <div className="search-date-picker-field">
              <span className="search-date-picker-label">Month</span>
              <select
                className="search-date-select"
                value={pickerMonth}
                onChange={(e) => handleMonthChange(parseInt(e.target.value))}
              >
                {MONTH_NAMES.map((name, idx) => (
                  <option key={idx} value={idx}>{name}</option>
                ))}
              </select>
            </div>
            <div className="search-date-picker-field">
              <span className="search-date-picker-label">Day</span>
              <div className="search-date-stepper">
                <button onMouseDown={(e) => { e.preventDefault(); handleDayChange(-1); }}><ChevronLeft size={11} /></button>
                <span>{String(pickerDay).padStart(2, "0")}</span>
                <button onMouseDown={(e) => { e.preventDefault(); handleDayChange(1); }}><ChevronRight size={11} /></button>
              </div>
            </div>
          </div>
          <div className="search-date-preview">{formatDate(pickerYear, pickerMonth, pickerDay)}</div>
          <button
            className="search-date-apply"
            onMouseDown={(e) => { e.preventDefault(); handleApply(); }}
          >
            Apply
          </button>
        </div>
      </>
    );
  }
);
