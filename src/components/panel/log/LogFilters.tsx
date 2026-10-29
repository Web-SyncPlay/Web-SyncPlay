"use client"

import { Search, X } from "lucide-react"

import { cn } from "@/components/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  actionLabelByType,
  categoryLabelByType,
  logActionCategories,
  type LogActionCategory,
  type VisibleActionType,
} from "@/shared/log-format"

export function LogFilters(props: {
  query: string
  categories: readonly LogActionCategory[]
  actions: readonly string[]
  userIds: readonly string[]
  users: Array<{ id: string; label: string }>
  categoryCounts: Record<LogActionCategory, number>
  matchedCount: number
  totalVisibleCount: number
  hasActiveFilters: boolean
  timeRangeActive: boolean
  onQueryChange: (value: string) => void
  onToggleCategory: (category: LogActionCategory) => void
  onToggleUser: (userId: string) => void
  onToggleAction: (action: string) => void
  onClearTimeRange: () => void
  onClearFilters: () => void
}) {
  const {
    query,
    categories,
    actions,
    userIds,
    users,
    categoryCounts,
    matchedCount,
    totalVisibleCount,
    hasActiveFilters,
    timeRangeActive,
    onQueryChange,
    onToggleCategory,
    onToggleUser,
    onToggleAction,
    onClearTimeRange,
    onClearFilters,
  } = props

  const selectedUsers = users.filter((user) => userIds.includes(user.id))

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search actions, users, details…"
          aria-label="Search action log"
          className="pr-8 pl-8"
        />
        {query.trim().length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
            aria-label="Clear search"
            onClick={() => onQueryChange("")}
          >
            <X />
          </Button>
        ) : null}
      </div>

      <div
        className="flex flex-wrap gap-1.5"
        role="group"
        aria-label="Filter by category"
      >
        {logActionCategories.map((category) => {
          const active = categories.includes(category)
          const count = categoryCounts[category]
          const disabled = count === 0 && !active
          return (
            <Button
              key={category}
              type="button"
              size="xs"
              variant={active ? "default" : "outline"}
              disabled={disabled}
              aria-pressed={active}
              aria-label={`Filter category ${categoryLabelByType[category]} (${count})`}
              className={cn(
                "gap-1",
                category === "error" &&
                  !active &&
                  count > 0 &&
                  "border-destructive/40 text-destructive",
              )}
              onClick={() => onToggleCategory(category)}
            >
              {categoryLabelByType[category]}
              <span className="tabular-nums opacity-70" aria-hidden>
                {count}
              </span>
            </Button>
          )
        })}
      </div>

      {users.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label="Filter by user"
        >
          {users.map((user) => {
            const active = userIds.includes(user.id)
            return (
              <Button
                key={user.id}
                type="button"
                size="xs"
                variant={active ? "secondary" : "ghost"}
                aria-pressed={active}
                aria-label={`Filter user ${user.label}`}
                className="max-w-40 truncate"
                onClick={() => onToggleUser(user.id)}
              >
                {user.label}
              </Button>
            )
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">
          Showing {matchedCount} of {totalVisibleCount}
        </span>
        {hasActiveFilters ? (
          <>
            <span aria-hidden>·</span>
            {categories.map((category) => (
              <Badge
                key={category}
                variant="secondary"
                className="h-5 cursor-pointer gap-1"
                render={<button type="button" />}
                aria-label={`Remove ${categoryLabelByType[category]} filter`}
                onClick={() => onToggleCategory(category)}
              >
                {categoryLabelByType[category]}
                <X className="size-3" />
              </Badge>
            ))}
            {actions.map((action) => (
              <Badge
                key={action}
                variant="outline"
                className="h-5 cursor-pointer gap-1"
                render={<button type="button" />}
                aria-label={`Remove ${action} filter`}
                onClick={() => onToggleAction(action)}
              >
                {action in actionLabelByType
                  ? actionLabelByType[action as VisibleActionType]
                  : action}
                <X className="size-3" />
              </Badge>
            ))}
            {selectedUsers.map((user) => (
              <Badge
                key={user.id}
                variant="outline"
                className="h-5 max-w-36 cursor-pointer gap-1"
                render={<button type="button" />}
                aria-label={`Remove ${user.label} filter`}
                onClick={() => onToggleUser(user.id)}
              >
                <span className="truncate">{user.label}</span>
                <X className="size-3 shrink-0" />
              </Badge>
            ))}
            {timeRangeActive ? (
              <Badge
                variant="outline"
                className="h-5 cursor-pointer gap-1"
                render={<button type="button" />}
                aria-label="Clear time range filter"
                onClick={onClearTimeRange}
              >
                Time range
                <X className="size-3" />
              </Badge>
            ) : null}
            {query.trim().length > 0 ? (
              <Badge
                variant="outline"
                className="h-5 max-w-40 cursor-pointer gap-1"
                render={<button type="button" />}
                aria-label="Clear search"
                onClick={() => onQueryChange("")}
              >
                <span className="truncate">“{query.trim()}”</span>
                <X className="size-3 shrink-0" />
              </Badge>
            ) : null}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={onClearFilters}
            >
              Clear all
            </Button>
          </>
        ) : null}
      </div>
    </div>
  )
}
