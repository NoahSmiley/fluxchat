import { X } from "lucide-react";

export interface SearchFilterTagProps {
  label: string;
  value: string;
  onRemove: () => void;
}

export function SearchFilterTag({ label, value, onRemove }: SearchFilterTagProps) {
  return (
    <span className="search-filter-tag">
      {label}: <strong>{value}</strong>
      <button onMouseDown={(e) => { e.preventDefault(); onRemove(); }} title="Remove filter"><X size={11} /></button>
    </span>
  );
}
