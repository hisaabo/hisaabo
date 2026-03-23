import { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface FormFieldProps {
  label: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, error, required, children, className }: FormFieldProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label className="label">
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

export function InputField({ label, error, required, className, ...props }: InputFieldProps) {
  return (
    <FormField label={label} error={error} required={required}>
      <input className={cn("input", className)} {...props} />
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
  ...props
}: SelectFieldProps) {
  return (
    <FormField label={label} error={error} required={required}>
      <select className={cn("input", className)} {...props}>
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
  ...props
}: TextareaFieldProps) {
  return (
    <FormField label={label} error={error} required={required}>
      <textarea className={cn("input", className)} {...props} />
    </FormField>
  );
}
