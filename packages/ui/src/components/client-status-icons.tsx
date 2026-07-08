import { MicOff, MonitorX, VolumeX } from "lucide-react"

import { cn } from "@/lib/utils"

type ClientStatus = {
  clientAway?: unknown
  clientInputMuted?: unknown
  clientOutputMuted?: unknown
}

type StatusIcon = {
  Icon: typeof MicOff
  label: string
  active: boolean
}

function isTruthyStatus(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true"
}

export function ClientStatusIcons({
  className,
  client,
}: {
  className?: string
  client: ClientStatus
}) {
  const statusIcon = [
    {
      Icon: MonitorX,
      label: "Away",
      active: isTruthyStatus(client.clientAway),
    },
    {
      Icon: VolumeX,
      label: "Output muted",
      active: isTruthyStatus(client.clientOutputMuted),
    },
    {
      Icon: MicOff,
      label: "Input muted",
      active: isTruthyStatus(client.clientInputMuted),
    },
  ].find((icon) => icon.active) satisfies StatusIcon | undefined

  if (!statusIcon) {
    return null
  }

  const { Icon, label } = statusIcon

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center text-muted-foreground",
        className,
      )}
      aria-label={label}
      role="img"
      title={label}
    >
      <Icon className="size-3.5" />
    </span>
  )
}
