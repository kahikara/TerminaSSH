import type { ToastItem } from "../lib/types"

type Props = {
  toasts: ToastItem[]
}

export default function ToastStack({ toasts }: Props) {
  return (
    <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2.5 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-xl animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-auto ${
            toast.isErr
              ? "border-[color-mix(in_srgb,var(--danger)_58%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-app)_88%,black)]"
              : "border-[color-mix(in_srgb,var(--accent)_34%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--bg-app)_88%,black)]"
          }`}
        >
          <span
            className={`inline-block w-2 h-2 rounded-full shrink-0 ${
              toast.isErr ? "bg-[var(--danger)]" : "bg-[var(--accent)]"
            }`}
          />
          <span className="text-[13px] leading-[1.35] font-medium text-[var(--text-main)] max-w-sm break-words">
            {toast.msg}
          </span>
        </div>
      ))}
    </div>
  )
}
