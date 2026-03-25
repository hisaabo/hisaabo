import { useState } from "react";

interface PanInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function PanInput({ value, onChange, error }: PanInputProps) {
  const [blurred, setBlurred] = useState(false);
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  const isValid = !value || panRegex.test(value);
  const showError = blurred && value.length > 0 && !isValid;

  return (
    <div>
      <label className="label">PAN <span className="text-red-500">*</span></label>
      <input
        className={`input font-mono tracking-wide ${showError || error ? "border-red-500" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        onBlur={() => setBlurred(true)}
        maxLength={10}
        placeholder="AAAAA0000A"
        spellCheck={false}
        autoCapitalize="characters"
      />
      {showError && (
        <p className="text-[11px] text-red-500 mt-1">Invalid PAN format (5 letters + 4 digits + 1 letter)</p>
      )}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
