import { useState } from "react";

interface GstinInputProps {
  value: string;
  onChange: (value: string) => void;
  onPanDetected?: (pan: string) => void;
  error?: string;
}

export function GstinInput({ value, onChange, onPanDetected, error }: GstinInputProps) {
  const [blurred, setBlurred] = useState(false);
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  const isValid = !value || gstinRegex.test(value);
  const showError = blurred && value.length > 0 && !isValid;
  const detectedPan = value.length === 15 && isValid ? value.slice(2, 12) : null;

  return (
    <div>
      <label className="label">GSTIN</label>
      <input
        className={`input font-mono tracking-wide ${showError || error ? "border-red-500" : ""}`}
        value={value}
        onChange={(e) => {
          const upper = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
          onChange(upper);
          if (upper.length === 15 && gstinRegex.test(upper)) {
            onPanDetected?.(upper.slice(2, 12));
          }
        }}
        onBlur={() => setBlurred(true)}
        maxLength={15}
        placeholder="22AAAAA0000A1Z5"
        spellCheck={false}
        autoCapitalize="characters"
      />
      {showError && (
        <p className="text-[11px] text-red-500 mt-1">Invalid GSTIN format</p>
      )}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {!showError && !error && (
        <p className="text-[11px] text-text-tertiary mt-1">15-character GST Identification Number</p>
      )}
      {detectedPan && (
        <p className="text-[11px] text-brand-600 mt-1">
          PAN detected: {detectedPan}
        </p>
      )}
    </div>
  );
}
