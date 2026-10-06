"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Copy, ExternalLink, Smartphone } from "lucide-react"
import { QRCodeSVG } from "qrcode.react"
import { toast } from "sonner"

export function RemotePrepPanel(props: {
  controlEmbedUrl: string
  onOpenControl?: () => void
}) {
  const { controlEmbedUrl, onOpenControl } = props

  const copyControlUrl = async () => {
    try {
      await navigator.clipboard.writeText(controlEmbedUrl)
      toast.success("Control URL copied")
    } catch {
      toast.error("Failed to copy control URL")
    }
  }

  const openControl = () => {
    if (onOpenControl) {
      onOpenControl()
      return
    }
    window.open(controlEmbedUrl, "_blank", "noopener,noreferrer")
  }

  return (
    <Card className="mx-auto w-full max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Smartphone className="size-5" />
          Open on phone
        </CardTitle>
        <CardDescription>
          Scan the QR code or copy the control URL to run the room remote on
          another device.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <div className="rounded-lg bg-white p-3">
          <QRCodeSVG
            value={controlEmbedUrl}
            size={220}
            className="size-48 sm:size-60"
          />
        </div>
        <InputGroup className="w-full">
          <InputGroupInput value={controlEmbedUrl} readOnly />
          <InputGroupAddon align="inline-end">
            <InputGroupButton aria-label="Copy control URL" onClick={copyControlUrl}>
              <Copy />
              Copy
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={openControl}>
            <ExternalLink />
            Open control view
          </Button>
          <Button variant="outline" onClick={copyControlUrl}>
            <Copy />
            Copy URL
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
