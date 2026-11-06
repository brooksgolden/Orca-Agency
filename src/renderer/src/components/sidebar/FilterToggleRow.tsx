import React from 'react'
import { DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { SwitchIndicator } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function FilterToggleRow({
  icon,
  label,
  ariaLabel,
  checked,
  onChange,
  shortcutLabel,
  indented = false
}: {
  icon: React.ReactNode
  label: string
  /** Full sentence for assistive tech when `label` only reads in visual context. */
  ariaLabel?: string
  checked: boolean
  onChange: (next: boolean) => void
  shortcutLabel?: string
  indented?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        // Why pl-* and not px-2 + pl-6: Tailwind v4 emits px as padding-inline,
        // which outranks a physical pl-6 override and flattens the indent.
        // text-left: a button centers by default, which shows the moment a label wraps.
        // items-start (stable): multi-line labels keep the icon at the top line.
        'flex w-full items-start justify-between gap-2 rounded-[5px] py-1.5 pr-2 text-left text-[12px] font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        indented ? 'pl-7' : 'pl-2'
      )}
    >
      <span
        className={cn(
          'inline-flex min-w-0 items-start gap-2',
          indented ? 'text-muted-foreground' : 'text-foreground'
        )}
      >
        <span className="shrink-0 text-muted-foreground mt-0.5">{icon}</span>
        <span className="min-w-0">{label}</span>
      </span>
      <span className="inline-flex items-center gap-2 mt-0.5">
        {shortcutLabel ? <DropdownMenuShortcut>{shortcutLabel}</DropdownMenuShortcut> : null}
        <SwitchIndicator
          checked={checked}
          size="compact"
          className="data-[state=checked]:bg-primary"
        />
      </span>
    </button>
  )
}
