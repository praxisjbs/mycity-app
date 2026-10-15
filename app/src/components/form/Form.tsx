import type { FormEvent, ReactNode } from "react";

/**
 * The one <form> (FRONTEND_GUIDE §8.6). Enter submits; the browser's own
 * validation bubbles are off, because every field shows its own mark as it is
 * filled (gate 12).
 */
export function Form({ onSubmit, children, className, id }: { onSubmit: () => void; children: ReactNode; className?: string; id?: string }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form id={id} className={className} noValidate onSubmit={submit}>
      {children}
    </form>
  );
}
