import { useState } from "react";
import { lookupPincode } from "@/lib/pincode-lookup";

interface PincodeInputProps {
  value: string;
  onChange: (value: string) => void;
  onCityStateResolved: (city: string, state: string) => void;
  error?: string;
}

export function PincodeInput({ value, onChange, onCityStateResolved, error }: PincodeInputProps) {
  const [lookupState, setLookupState] = useState<"idle" | "found" | "not-found">("idle");

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(raw);

    if (raw.length === 6) {
      const result = lookupPincode(raw);
      if (result) {
        setLookupState("found");
        onCityStateResolved(result.district, result.state);
      } else {
        setLookupState("not-found");
      }
    } else {
      setLookupState("idle");
    }
  }

  return (
    <div>
      <label className="label">Pincode</label>
      <div className="relative">
        <input
          className="input"
          value={value}
          onChange={handleChange}
          maxLength={6}
          inputMode="numeric"
          placeholder="400001"
        />
        {lookupState === "found" && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg className="w-4 h-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {lookupState === "found" && !error && (
        <p className="text-[11px] text-emerald-600 mt-1">City and state auto-filled</p>
      )}
      {lookupState === "not-found" && !error && (
        <p className="text-[11px] text-text-tertiary mt-1">Pincode not recognized — enter city and state manually</p>
      )}
    </div>
  );
}
