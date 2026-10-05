"use client"

import { TooltipProvider } from "@/components/ui/tooltip"
import { type ReactNode } from "react"

export function AppProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}
