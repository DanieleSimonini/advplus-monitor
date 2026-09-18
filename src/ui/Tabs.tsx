import React from 'react'
import Icon, { type IconName } from './Icon'

export type TabItem<T extends string> = {
  value: T
  label: string
  icon?: IconName
  count?: number
}

/** Tab list con navigazione da tastiera (frecce, Home/End) come da pattern ARIA. */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
}: {
  value: T
  items: TabItem<T>[]
  onChange: (v: T) => void
  ariaLabel: string
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex(it => it.value === value)
    if (i < 0) return
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    onChange(items[next].value)
  }

  return (
    <div className="gu-tabs" role="tablist" aria-label={ariaLabel} onKeyDown={onKeyDown}>
      {items.map(it => (
        <button
          key={it.value}
          type="button"
          role="tab"
          className="gu-tab"
          aria-selected={value === it.value}
          tabIndex={value === it.value ? 0 : -1}
          onClick={() => onChange(it.value)}
        >
          {it.icon && <Icon name={it.icon} size={15} />}
          {it.label}
          {typeof it.count === 'number' && it.count > 0 && <span className="gu-tab__count">{it.count}</span>}
        </button>
      ))}
    </div>
  )
}
