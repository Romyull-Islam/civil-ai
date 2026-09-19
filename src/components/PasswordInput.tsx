"use client";
/** Password field with an eye button to show or hide what was typed. */
import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

export function PasswordInput({ className = "input", wrapperClassName = "", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { wrapperClassName?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className={`relative ${wrapperClassName}`}>
      <input {...props} type={show ? "text" : "password"} className={`${className} pr-10`} />
      <button type="button" onClick={() => setShow((v) => !v)} className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-fg" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show} title={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
