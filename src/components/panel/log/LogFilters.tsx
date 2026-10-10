import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { actionLabelByType, visibleActionTypes } from "@/shared/log-format"

export function LogFilters(props: {
  actionFilter: string
  userFilter: string
  users: Array<{ id: string; label: string }>
  onActionFilterChange: (value: string) => void
  onUserFilterChange: (value: string) => void
}) {
  const {
    actionFilter,
    userFilter,
    users,
    onActionFilterChange,
    onUserFilterChange,
  } = props

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Action</span>
        <Select
          value={actionFilter}
          onValueChange={(value) => onActionFilterChange(value ?? "all")}
        >
          <SelectTrigger size="sm" aria-label="Filter by action">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {visibleActionTypes.map((actionType) => (
              <SelectItem key={actionType} value={actionType}>
                {actionLabelByType[actionType]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">User</span>
        <Select
          value={userFilter}
          onValueChange={(value) => onUserFilterChange(value ?? "all")}
        >
          <SelectTrigger size="sm" aria-label="Filter by user">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
    </div>
  )
}
