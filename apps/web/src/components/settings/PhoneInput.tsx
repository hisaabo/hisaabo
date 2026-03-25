interface PhoneInputProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export function PhoneInput({ value, onChange, error }: PhoneInputProps) {
  const digits = value.replace(/^\+91/, "").replace(/\D/g, "");

  return (
    <div>
      <label className="label">Phone</label>
      <div className="flex">
        <span
          className="inline-flex items-center px-3 rounded-l-lg border border-r-0 text-sm font-medium bg-surface-1 text-text-secondary border-border-light"
        >
          +91
        </span>
        <input
          className="input rounded-l-none flex-1"
          value={digits}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, "").slice(0, 10);
            onChange(raw ? `+91${raw}` : "");
          }}
          type="tel"
          maxLength={10}
          placeholder="9876543210"
          inputMode="numeric"
        />
      </div>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
      {digits.length > 0 && digits.length < 10 && !error && (
        <p className="text-[11px] text-text-tertiary mt-1">Enter 10-digit mobile number</p>
      )}
    </div>
  );
}
