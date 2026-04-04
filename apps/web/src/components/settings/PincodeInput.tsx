import { useState } from "react";
import { lookupPincode } from "@/lib/pincode-lookup";

interface PincodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called when PIN resolves and city/state were empty — autofill them. */
  onCityStateResolved: (city: string, state: string) => void;
  /** Current city value (to detect user-filled vs empty). */
  currentCity?: string;
  /** Current state value (to detect user-filled vs empty). */
  currentState?: string;
  error?: string;
}

export function PincodeInput({ value, onChange, onCityStateResolved, currentCity, currentState, error }: PincodeInputProps) {
  const [lookupState, setLookupState] = useState<"idle" | "found" | "found-mismatch" | "not-found">("idle");
  const [resolvedInfo, setResolvedInfo] = useState<{ district: string; state: string } | null>(null);
  const [justFilled, setJustFilled] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 6);
    onChange(raw);
    setJustFilled(false);

    if (raw.length === 6) {
      const result = lookupPincode(raw);
      if (result) {
        setResolvedInfo(result);
        const cityEmpty = !currentCity?.trim();
        const stateEmpty = !currentState?.trim();

        if (cityEmpty && stateEmpty) {
          // Both empty — autofill with a little celebration
          setLookupState("found");
          onCityStateResolved(result.district, result.state);
          setJustFilled(true);
          setTimeout(() => setJustFilled(false), 2000);
        } else {
          // User already filled city/state — check for mismatch
          const cityMatch = !currentCity?.trim() || currentCity.trim().toLowerCase() === result.district.toLowerCase();
          const stateMatch = !currentState?.trim() || currentState.trim().toLowerCase() === result.state.toLowerCase();
          if (cityMatch && stateMatch) {
            setLookupState("found");
          } else {
            setLookupState("found-mismatch");
          }
        }
      } else {
        setLookupState("not-found");
        setResolvedInfo(null);
      }
    } else {
      setLookupState("idle");
      setResolvedInfo(null);
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
            <svg
              className="w-4 h-4 text-emerald-500"
              viewBox="0 0 20 20"
              fill="currentColor"
              style={justFilled ? { animation: "pincode-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" } : undefined}
            >
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        )}
        {lookupState === "found-mismatch" && (
          <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
            <svg className="w-4 h-4 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
        )}
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {lookupState === "found" && justFilled && !error && (
        <p className="text-[11px] text-emerald-600 mt-1" style={{ animation: "pincode-slide 0.3s ease-out" }}>
          Got it! {resolvedInfo?.district}, {resolvedInfo?.state}
        </p>
      )}
      {lookupState === "found" && !justFilled && !error && (
        <p className="text-[11px] text-emerald-600 mt-1">
          {resolvedInfo?.district}, {resolvedInfo?.state}
        </p>
      )}
      {lookupState === "found-mismatch" && !error && resolvedInfo && (
        <p className="text-[11px] text-amber-600 mt-1">
          PIN suggests {resolvedInfo.district}, {resolvedInfo.state} — your entry differs
        </p>
      )}
      {lookupState === "not-found" && !error && (
        <p className="text-[11px] text-text-tertiary mt-1">Pincode not recognized — enter city and state manually</p>
      )}
      <style>{`
        @keyframes pincode-pop { 0% { transform: scale(0); } 50% { transform: scale(1.3); } 100% { transform: scale(1); } }
        @keyframes pincode-slide { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}
