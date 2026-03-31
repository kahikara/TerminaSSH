type DraggedTabGhostProps = {
  isVisible: boolean
  x: number
  y: number
  name: string
}

export default function DraggedTabGhost({
  isVisible,
  x,
  y,
  name
}: DraggedTabGhostProps) {
  if (!isVisible) return null

  return (
    <div
      className="fixed z-[240] pointer-events-none"
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)'
      }}
    >
      <div className="flex items-center px-3.5 h-[32px] min-w-[136px] max-w-[196px] rounded-t-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-app)_94%,black)] text-[var(--text-main)] shadow-2xl opacity-95">
        <span className="truncate flex-1 min-w-0 text-[13px] font-medium">
          {name}
        </span>
      </div>
    </div>
  )
}
