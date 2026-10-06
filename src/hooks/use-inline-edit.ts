import { useCallback, useState } from "react"

interface InlineEditConfig {
  initialValue?: string
  onCommit: (nextValue: string) => void
}

export function useInlineEdit(config: InlineEditConfig) {
  const [draft, setDraft] = useState(config.initialValue ?? "")
  const [isEditing, setIsEditing] = useState(false)

  const reset = useCallback((value: string) => {
    setDraft(value)
  }, [])

  const start = useCallback((value?: string) => {
    if (typeof value === "string") {
      setDraft(value)
    }
    setIsEditing(true)
  }, [])

  const cancel = useCallback((value?: string) => {
    if (typeof value === "string") {
      setDraft(value)
    }
    setIsEditing(false)
  }, [])

  const commit = useCallback(
    (currentValue: string) => {
      const trimmed = (draft || currentValue).trim()
      if (!trimmed || trimmed === currentValue) {
        setDraft(currentValue)
        setIsEditing(false)
        return
      }
      config.onCommit(trimmed)
      setIsEditing(false)
    },
    [config, draft],
  )

  return {
    draft,
    setDraft,
    reset,
    commit,
    isEditing,
    start,
    cancel,
  }
}
