import { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, useId } from "react";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
  /** Explicit id for the control — used when you pass a custom child (e.g. Combobox) */
  htmlFor?: string;
}

export function FormField({ label, error, required, children, className, htmlFor }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={htmlFor} className="label">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error && (
        <p className="text-xs mt-1 text-red-500">{error}</p>
      )}
    </div>
  );
}

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  required?: boolean;
}

export function InputField({ label, error, required, className, id, ...props }: InputFieldProps) {
  // Generate a stable id so the <label htmlFor> association works even when
  // the caller does not supply an explicit id.
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <input id={fieldId} className={cn("input", className)} {...props} />
    </FormField>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function SelectField({
  label,
  error,
  required,
  children,
  className,
  id,
  ...props
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <select id={fieldId} className={cn("input", className)} {...props}>
        {children}
      </select>
    </FormField>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  required?: boolean;
}

export function TextareaField({
  label,
  error,
  required,
  className,
  id,
  ...props
}: TextareaFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FormField label={label} error={error} required={required} htmlFor={fieldId}>
      <textarea id={fieldId} className={cn("input", className)} {...props} />
    </FormField>
  );
}
