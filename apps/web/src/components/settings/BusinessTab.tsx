import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { InputField } from "@/components/ui/FormField";
import { Combobox } from "@/components/ui/Combobox";
import { Listbox } from "@/components/ui/Listbox";
import { toast } from "@/hooks/useToast";
import { GstinInput } from "./GstinInput";
import { PanInput } from "./PanInput";
import { PhoneInput } from "./PhoneInput";
import { PincodeInput } from "./PincodeInput";
import { INDIAN_STATES } from "@/lib/indian-states";

const GST_REG_OPTIONS = [
  { value: "unregistered", label: "Not GST Registered" },
  { value: "regular", label: "GST Regular" },
  { value: "composition", label: "GST Composition Scheme" },
];

interface BusinessTabProps {
  biz: any;
}

export function BusinessTab({ biz }: BusinessTabProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return <BusinessCard biz={biz} onEdit={() => setEditing(true)} />;
  }

  return <BusinessForm existing={biz} onDone={() => setEditing(false)} />;
}

function BusinessCard({ biz, onEdit }: { biz: any; onEdit: () => void }) {
  const fields: [string, string | undefined | null][] = [
    ["Legal Name", biz.legalName],
    ["GSTIN", biz.gstin],
    ["PAN", biz.pan],
    ["Phone", biz.phone],
    ["Email", biz.email],
    ["Address", biz.address],
    ["City", biz.city],
    ["State", biz.state],
    ["Pincode", biz.pincode],
    ["Currency", biz.currency],
  ];

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">{biz.name}</h3>
        <button className="btn-secondary" onClick={onEdit}>Edit</button>
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span className="text-xs text-text-tertiary">{label}</span>
            <p className={value ? "text-text-primary" : "text-text-tertiary"}>
              {value || "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BusinessForm({ existing, onDone }: { existing?: any; onDone: (name?: string) => void }) {
  const [name, setName] = useState(existing?.name || "");
  const [legalName, setLegalName] = useState(existing?.legalName || "");
  const [gstRegType, setGstRegType] = useState(existing?.gstRegistrationType || "unregistered");
  const [gstin, setGstin] = useState(existing?.gstin || "");
  const [stateCode, setStateCode] = useState(existing?.stateCode || "");
  const [pan, setPan] = useState(existing?.pan || "");
  const [phone, setPhone] = useState(existing?.phone || "");
  const [email, setEmail] = useState(existing?.email || "");
  const [address, setAddress] = useState(existing?.address || "");
  const [city, setCity] = useState(existing?.city || "");
  const [stateName, setStateName] = useState(existing?.state || "");
  const [pincode, setPincode] = useState(existing?.pincode || "");

  const utils = trpc.useUtils();

  const stateOptions = INDIAN_STATES.map((s) => ({ value: s.name, label: s.name }));

  const createMutation = trpc.business.create.useMutation({
    onSuccess: () => {
      toast.success("Business created successfully");
      utils.business.list.invalidate();
      onDone(name);
    },
    onError: (err) => {
      toast.error("Failed to create business", err.message);
    },
  });

  const updateMutation = trpc.business.update.useMutation({
    onSuccess: () => {
      toast.success("Business updated successfully");
      utils.business.list.invalidate();
      onDone(name);
    },
    onError: (err) => {
      toast.error("Failed to update business", err.message);
    },
  });

  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const data = {
      name,
      legalName: legalName || undefined,
      gstRegistrationType: gstRegType as "unregistered" | "regular" | "composition",
      gstin: gstRegType !== "unregistered" ? (gstin || undefined) : undefined,
      stateCode: stateCode || undefined,
      pan: pan || undefined,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      city: city || undefined,
      state: stateName || undefined,
      pincode: pincode || undefined,
    };
    if (existing) {
      updateMutation.mutate({ id: existing.id, data });
    } else {
      createMutation.mutate(data);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="text-base font-semibold text-text-primary mb-5">
        {existing ? "Edit Business" : "Set Up Your Business"}
      </h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Business Info */}
        <div className="grid grid-cols-2 gap-4">
          <InputField
            label="Business Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <InputField
            label="Legal Name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
        </div>

        {/* Tax Info */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Listbox
              label="GST Registration"
              value={gstRegType}
              onChange={setGstRegType}
              options={GST_REG_OPTIONS}
            />
          </div>
          <PanInput value={pan} onChange={setPan} />
        </div>
        {gstRegType !== "unregistered" && (
          <div className="grid grid-cols-2 gap-4">
            <GstinInput
              value={gstin}
              onChange={(val) => {
                setGstin(val);
                if (val.length === 15) {
                  setStateCode(val.slice(0, 2));
                }
              }}
              onPanDetected={(detectedPan) => {
                if (!pan) setPan(detectedPan);
              }}
            />
          </div>
        )}

        {/* Contact */}
        <div className="grid grid-cols-2 gap-4">
          <PhoneInput value={phone} onChange={setPhone} required />
          <InputField
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
          />
        </div>

        {/* Address */}
        <InputField
          label="Address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          required
        />
        <div className="grid grid-cols-3 gap-4">
          <PincodeInput
            value={pincode}
            onChange={setPincode}
            onCityStateResolved={(resolvedCity, resolvedState) => {
              setCity(resolvedCity);
              setStateName(resolvedState);
            }}
          />
          <div>
            <InputField
              label="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!pincode || pincode.length < 6}
            />
            {(!pincode || pincode.length < 6) && (
              <p className="text-[11px] text-text-tertiary mt-1">Enter pincode first</p>
            )}
          </div>
          <div className={!pincode || pincode.length < 6 ? "opacity-50 pointer-events-none" : ""}>
            <Combobox
              label="State"
              value={stateName}
              onChange={setStateName}
              options={stateOptions}
              placeholder="Select state..."
            />
          </div>
        </div>

        {/* Currency (readonly) */}
        <InputField
          label="Currency"
          value="INR"
          readOnly
          className="opacity-60 cursor-not-allowed"
        />

        <div className="flex gap-3 pt-2">
          {existing && (
            <button
              type="button"
              onClick={() => onDone()}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={isPending}
            className="btn-primary flex-1"
          >
            {isPending ? "Saving..." : existing ? "Save Changes" : "Create Business"}
          </button>
        </div>
      </form>
    </div>
  );
}
