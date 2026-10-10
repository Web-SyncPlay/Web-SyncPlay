"use client"

import { buttonVariants } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useInlineEdit } from "@/hooks/use-inline-edit"
import type { TypedRoomEventSender } from "@/contracts/room-events"
import { cn } from "@/components/lib/utils"
import type { PublicRoomSecurityState } from "@/contracts/types"
import {
  Copy,
  Dices,
  Eye,
  EyeOff,
  LockKeyhole,
  LockKeyholeOpen,
  Trash2,
} from "lucide-react"
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react"
import { toast } from "sonner"

const PASSWORD_DISPLAY_WIDTH = 6
const LEGACY_PASSWORD_STORAGE_PREFIX = "wsp:join-password:"
const PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

function generateJoinPassword(length = PASSWORD_DISPLAY_WIDTH): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(
    bytes,
    (byte) => PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length],
  ).join("")
}

function maskPassword(password: string | null): string {
  const length = Math.max(
    PASSWORD_DISPLAY_WIDTH,
    password?.length ?? PASSWORD_DISPLAY_WIDTH,
  )
  return "*".repeat(length)
}

const iconButtonClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "size-8",
)

function IconAction(props: {
  label: string
  tooltip: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className={cn(iconButtonClass, props.className)}
        aria-label={props.label}
        onClick={props.onClick}
      >
        {props.children}
      </TooltipTrigger>
      <TooltipContent>{props.tooltip}</TooltipContent>
    </Tooltip>
  )
}

export function RoomJoinPasswordSection(props: {
  roomId: string
  roomSecurity: PublicRoomSecurityState
  canManageRoomSecurity: boolean
  send: TypedRoomEventSender
}) {
  const { roomId, roomSecurity, canManageRoomSecurity, send } = props
  const passwordEnabled = roomSecurity.joinPasswordEnabled
  // Keep plaintext only in memory so the owner can show/copy it for sharing
  // during this page lifetime — never persist to web storage.
  const [knownPassword, setKnownPassword] = useState("")
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      sessionStorage.removeItem(`${LEGACY_PASSWORD_STORAGE_PREFIX}${roomId}`)
    } catch {
      // Ignore storage failures.
    }
  }, [roomId])

  useEffect(() => {
    if (!passwordEnabled) {
      queueMicrotask(() => {
        setKnownPassword("")
        setVisible(false)
      })
    }
  }, [passwordEnabled])

  const applyPassword = (password: string) => {
    const trimmed = password.trim()
    if (!trimmed) {
      setError("Enter a password before saving.")
      return false
    }
    setError(null)
    setKnownPassword(trimmed)
    send("room:password:set", { password: trimmed })
    return true
  }

  const inlineEdit = useInlineEdit({
    onCommit: (nextValue) => {
      applyPassword(nextValue)
    },
  })

  const handleClearPassword = () => {
    setError(null)
    setKnownPassword("")
    setVisible(false)
    send("room:password:clear", {})
  }

  const handleGeneratePassword = () => {
    applyPassword(generateJoinPassword())
    setVisible(true)
  }

  const handleCopyPassword = async () => {
    if (!knownPassword) {
      toast.error("Password isn’t available to copy here. Set a new one first.")
      return
    }
    try {
      await navigator.clipboard.writeText(knownPassword)
      toast.success("Join password copied")
    } catch {
      toast.error("Could not copy password")
    }
  }

  const stopMenuKeyHandling = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
  }

  const displayValue =
    visible && knownPassword
      ? knownPassword
      : passwordEnabled
        ? maskPassword(knownPassword || null)
        : "Not set"

  return (
    <FieldGroup className="gap-3">
      <Field>
        <FieldContent>
          <FieldTitle className="flex items-center gap-2">
            {passwordEnabled ? (
              <LockKeyhole className="size-4" />
            ) : (
              <LockKeyholeOpen className="size-4" />
            )}
            Join password
          </FieldTitle>
          <FieldDescription>
            {canManageRoomSecurity
              ? "Require new users to enter a password before room details are sent."
              : "Only the room owner can change the join password."}
          </FieldDescription>
        </FieldContent>
      </Field>

      {canManageRoomSecurity ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            {inlineEdit.isEditing ? (
              <Input
                className="h-8 min-h-8 flex-1 font-mono text-sm md:text-sm"
                autoFocus
                type={visible ? "text" : "password"}
                value={inlineEdit.draft}
                onChange={(event) => inlineEdit.setDraft(event.target.value)}
                onFocus={() => inlineEdit.reset(knownPassword || "")}
                onBlur={() => inlineEdit.commit(knownPassword)}
                onKeyDown={(event) => {
                  stopMenuKeyHandling(event)
                  if (event.key === "Enter") {
                    inlineEdit.commit(knownPassword)
                    ;(event.target as HTMLInputElement).blur()
                  }
                  if (event.key === "Escape") {
                    inlineEdit.cancel(knownPassword)
                    ;(event.target as HTMLInputElement).blur()
                  }
                }}
                autoComplete="new-password"
                placeholder="Room password"
              />
            ) : (
              <span
                className={cn(
                  "inline-flex h-8 min-w-[4.5rem] flex-1 cursor-pointer items-center rounded-md px-2 font-mono text-sm tracking-widest",
                  "active:bg-muted/80 sm:hover:bg-muted/60",
                  !passwordEnabled && "text-muted-foreground tracking-normal",
                )}
                role="button"
                tabIndex={0}
                title={
                  passwordEnabled ? "Edit join password" : "Set join password"
                }
                onClick={() => inlineEdit.start(knownPassword || "")}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    inlineEdit.start(knownPassword || "")
                  }
                }}
              >
                {displayValue}
              </span>
            )}

            {passwordEnabled ? (
              <>
                <IconAction
                  label={visible ? "Hide password" : "Show password"}
                  tooltip={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible((prev) => !prev)}
                >
                  {visible ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </IconAction>
                <IconAction
                  label="Copy join password"
                  tooltip="Copy password"
                  onClick={() => {
                    void handleCopyPassword()
                  }}
                >
                  <Copy className="size-4" />
                </IconAction>
                <IconAction
                  label="Remove join password"
                  tooltip="Remove password"
                  className="text-destructive hover:text-destructive"
                  onClick={handleClearPassword}
                >
                  <Trash2 className="size-4" />
                </IconAction>
              </>
            ) : (
              <IconAction
                label="Generate random join password"
                tooltip="Generate random password"
                onClick={handleGeneratePassword}
              >
                <Dices className="size-4" />
              </IconAction>
            )}
          </div>
          <FieldError>{error}</FieldError>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {passwordEnabled ? "Password protected" : "No password"}
        </p>
      )}
    </FieldGroup>
  )
}
