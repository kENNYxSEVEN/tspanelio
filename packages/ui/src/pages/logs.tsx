import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { RefreshCw } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppSelect } from "@/components/app-select"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

type LogLevel = "debug" | "error" | "warning" | "info"
type TimezoneMode = "local" | "utc"

type RawLogLine = {
  l: string
  lastPos?: string | number
  [key: string]: unknown
}

type ParsedLogLine = {
  channel: string
  level: string
  msg: string
  rawTimestamp: string
  sid: number
  timestamp: string
}

type ServerLogsCache = {
  lastLoadedAt?: number
  lastPosition?: string | number
  logs: RawLogLine[]
  serverId?: string
}

const LOGS_CACHE_PREFIX = "tspanelio:logs:"
const serverLogsCache: ServerLogsCache = {
  logs: [],
}
const logViewFlights = new Map<string, Promise<RawLogLine[]>>()

const levelOptions: Array<{ label: string; value: LogLevel }> = [
  { label: "Debug", value: "debug" },
  { label: "Errors", value: "error" },
  { label: "Warnings", value: "warning" },
  { label: "Info", value: "info" },
]

const timezoneOptions = [
  { label: "UTC Time", value: "utc" },
  { label: "Locale Time", value: "local" },
]

const LOG_VIEW_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }
  if (typeof error === "string") return error
  return "TeamSpeak request failed."
}

function isUsableServerId(value: string | number | undefined | null) {
  return (
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== "0"
  )
}

function readStoredLogsCache(serverKey: string | undefined) {
  if (!serverKey || typeof window === "undefined") {
    return null
  }

  try {
    const value = window.sessionStorage.getItem(LOGS_CACHE_PREFIX + serverKey)

    if (!value) {
      return null
    }

    const parsed = JSON.parse(value) as Partial<ServerLogsCache>

    if (!Array.isArray(parsed.logs)) {
      return null
    }

    return {
      lastLoadedAt: parsed.lastLoadedAt,
      lastPosition: parsed.lastPosition,
      logs: parsed.logs,
      serverId: serverKey,
    } satisfies ServerLogsCache
  } catch {
    return null
  }
}

function writeStoredLogsCache(cache: ServerLogsCache) {
  if (!cache.serverId || typeof window === "undefined") {
    return
  }

  try {
    window.sessionStorage.setItem(
      LOGS_CACHE_PREFIX + cache.serverId,
      JSON.stringify(cache),
    )
  } catch {
    // Ignore storage quota/privacy mode failures; in-memory cache still works.
  }
}

function getLogsCache(serverKey: string | undefined) {
  if (!serverKey) {
    return null
  }

  if (serverLogsCache.serverId === serverKey && serverLogsCache.logs.length) {
    return serverLogsCache
  }

  const storedCache = readStoredLogsCache(serverKey)

  if (storedCache) {
    Object.assign(serverLogsCache, storedCache)
  }

  return storedCache
}


function getLocaleDate(timestamp: string) {
  const localeDate = new Date(timestamp)
  const milliseconds =
    localeDate.getTime() + -localeDate.getTimezoneOffset() * 60 * 1000

  localeDate.setTime(milliseconds)

  return localeDate
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0")
}

function getUTCDateString(timestamp: string) {
  const date = getLocaleDate(timestamp)

  return `${date.getUTCFullYear()}.${padDatePart(
    date.getUTCMonth() + 1,
  )}.${padDatePart(date.getUTCDate())} ${padDatePart(
    date.getUTCHours(),
  )}:${padDatePart(date.getUTCMinutes())}:${padDatePart(
    date.getUTCSeconds(),
  )}`
}

function getLocaleDateString(timestamp: string) {
  const date = getLocaleDate(timestamp)

  return `${date.getFullYear()}.${padDatePart(
    date.getMonth() + 1,
  )}.${padDatePart(date.getDate())} ${padDatePart(
    date.getHours(),
  )}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`
}

function parseLogLine(line: RawLogLine, timezone: TimezoneMode): ParsedLogLine {
  const [rawTimestamp = "", rawLevel = "", rawChannel = "", rawSid = "", ...msg] =
    line.l.split("|")

  return {
    channel: rawChannel.trim(),
    level: rawLevel.trim(),
    msg: msg.join("|"),
    rawTimestamp,
    sid: Number.parseInt(rawSid, 10),
    timestamp:
      timezone === "utc"
        ? getUTCDateString(rawTimestamp)
        : getLocaleDateString(rawTimestamp),
  }
}

function getLastPosition(logs: RawLogLine[]) {
  return logs[logs.length - 1]?.lastPos
}

function getLevelBadgeClass(level: string) {
  switch (level.toLowerCase()) {
    case "debug":
      return "border-primary/30 bg-primary/10 text-primary"
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive"
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

function getLevelFilterClass(level: LogLevel, active: boolean) {
  if (!active) {
    return "border-border bg-background text-muted-foreground hover:bg-muted/50"
  }

  switch (level) {
    case "debug":
      return "border-primary/30 bg-primary/10 text-primary"
    case "error":
      return "border-destructive/30 bg-destructive/10 text-destructive"
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
    case "info":
      return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

function getLevelCheckboxClass(level: LogLevel) {
  switch (level) {
    case "debug":
      return "border-primary/40 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-white"
    case "error":
      return "border-destructive/40 data-[state=checked]:border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-white"
    case "warning":
      return "border-amber-500/40 data-[state=checked]:border-amber-500 data-[state=checked]:bg-amber-500 data-[state=checked]:text-white"
    case "info":
      return "border-sky-500/40 data-[state=checked]:border-sky-500 data-[state=checked]:bg-sky-500 data-[state=checked]:text-white"
    default:
      return ""
  }
}

async function fetchLogView(
  serverKey: string,
  beginPos: string | number | undefined,
  progress: "foreground" | "background" | "none" =
    beginPos === undefined ? "foreground" : "background",
) {
  const key =
    serverKey + ":" + (beginPos === undefined ? "__initial__" : String(beginPos))
  const existingFlight = logViewFlights.get(key)

  if (existingFlight) {
    return existingFlight
  }

  const flight = withTimeout(
    TeamSpeak.execute<RawLogLine[]>(
      "logview",
      {
        instance: 0,
        reverse: 1,
        lines: 100,
        beginPos,
      },
      [],
      { progress },
    ),
    LOG_VIEW_TIMEOUT_MS,
    "Log request timed out. Check the connection and try again.",
  )
    .then((logs) => {
      if (!Array.isArray(logs)) {
        throw new Error("Invalid logview response.")
      }

      return logs
    })
    .finally(() => {
      logViewFlights.delete(key)
    })

  logViewFlights.set(key, flight)

  return flight
}

export function Logs() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const { dismissToast, showError, toasts } = useToastStack()
  const [filter, setFilter] = useState("")
  const [levels, setLevels] = useState<Record<LogLevel, boolean>>({
    debug: true,
    error: true,
    warning: true,
    info: true,
  })
  const [selectedTimezone, setSelectedTimezone] =
    useState<TimezoneMode>("local")
  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])
  const selectedServerKey = isUsableServerId(selectedServerId)
    ? String(selectedServerId)
    : undefined
  const initialCache = useMemo(
    () => getLogsCache(selectedServerKey),
    [selectedServerKey],
  )
  const hasInitialCache = Boolean(initialCache?.logs.length)
  const [logView, setLogView] = useState<RawLogLine[]>(
    () => initialCache?.logs ?? [],
  )
  const [lastPosition, setLastPosition] = useState<
    string | number | undefined
  >(() => initialCache?.lastPosition)
  const [loading, setLoading] = useState(() => !hasInitialCache)
  const [refreshing, setRefreshing] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const ensureSelectedServer = useCallback(async () => {
    if (!isUsableServerId(selectedServerId)) {
      throw new Error("No valid virtual server selected.")
    }

    const validSelectedServerId = selectedServerId as string | number
    const currentQueryUser = queryUserRef.current

    if (
      isUsableServerId(currentQueryUser.virtualserverId) &&
      String(currentQueryUser.virtualserverId) === String(validSelectedServerId)
    ) {
      saveServerId(validSelectedServerId)
      return currentQueryUser
    }

    if (!selectServerFlightRef.current) {
      selectServerFlightRef.current = TeamSpeak.useServer(
        validSelectedServerId,
        { progress: "background" },
      ).finally(() => {
        selectServerFlightRef.current = null
      })
    }

    await selectServerFlightRef.current
    saveServerId(validSelectedServerId)

    void TeamSpeak.ensureQueryIdentity({ progress: "background" })
      .then((nextQueryUser) => {
        if (nextQueryUser) {
          queryUserRef.current = nextQueryUser
          saveQueryUser(nextQueryUser)
        }
      })
      .catch(() => undefined)

    return queryUserRef.current
  }, [saveQueryUser, saveServerId, selectedServerId])

  const cacheLogs = useCallback(
    (logs: RawLogLine[]) => {
      const nextLastPosition = getLastPosition(logs)

      if (selectedServerKey) {
        serverLogsCache.serverId = selectedServerKey
        serverLogsCache.logs = logs
        serverLogsCache.lastLoadedAt = Date.now()
        serverLogsCache.lastPosition = nextLastPosition
        writeStoredLogsCache(serverLogsCache)
      }

      setLogView(logs)
      setLastPosition(nextLastPosition)
    },
    [selectedServerKey],
  )

  useEffect(() => {
    let active = true

    if (!selectedServerKey) {
      setLoading(false)
      return () => {
        active = false
      }
    }

    if (initialCache?.logs.length) {
      setLogView(initialCache.logs)
      setLastPosition(initialCache.lastPosition)
      setLoading(false)

      ensureSelectedServer()
        .then(() => fetchLogView(selectedServerKey, undefined, "background"))
        .then((logs) => {
          if (active) {
            cacheLogs(logs)
          }
        })
        .catch((error: unknown) => {
          if (active) showError(getErrorMessage(error))
        })

      return () => {
        active = false
      }
    }

    setLoading(true)
    ensureSelectedServer()
      .then(() => fetchLogView(selectedServerKey, undefined))
      .then((logs) => {
        if (active) {
          cacheLogs(logs)
        }
      })
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [cacheLogs, ensureSelectedServer, initialCache, selectedServerKey, showError])

  const reloadLogView = async () => {
    if (!selectedServerKey) {
      showError("No valid virtual server selected.")
      return
    }

    setRefreshing(true)

    try {
      await ensureSelectedServer()
      cacheLogs(await fetchLogView(selectedServerKey, undefined))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setRefreshing(false)
    }
  }

  const loadMoreLogs = useCallback(async () => {
    if (!selectedServerKey || !lastPosition || Number(lastPosition) <= 0) {
      return
    }

    setLoadingMore(true)

    try {
      await ensureSelectedServer()
      const moreLogs = await fetchLogView(selectedServerKey, lastPosition)
      const nextLogs = [...logView, ...moreLogs]
      cacheLogs(nextLogs)
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setLoadingMore(false)
    }
  }, [
    cacheLogs,
    ensureSelectedServer,
    lastPosition,
    logView,
    selectedServerKey,
    showError,
  ])

  useEffect(() => {
    if (
      !loadMoreRef.current ||
      loading ||
      loadingMore ||
      !lastPosition ||
      Number(lastPosition) <= 0
    ) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMoreLogs()
        }
      },
      { rootMargin: "240px" },
    )

    observer.observe(loadMoreRef.current)

    return () => observer.disconnect()
  }, [lastPosition, loadMoreLogs, loading, loadingMore])

  const parsedLogView = useMemo(
    () => logView.map((line) => parseLogLine(line, selectedTimezone)),
    [logView, selectedTimezone],
  )

  const visibleLogs = useMemo(() => {
    const normalizedFilter = filter.trim().toLowerCase()

    return parsedLogView
      .filter((log) => {
        const level = log.level.toLowerCase() as LogLevel

        return Boolean(levels[level])
      })
      .filter((log) => {
        if (!normalizedFilter) {
          return true
        }

        return [log.timestamp, log.level, log.channel, log.sid, log.msg].some(
          (value) => String(value).toLowerCase().includes(normalizedFilter),
        )
      })
  }, [filter, levels, parsedLogView])

  const busy = loading || refreshing || loadingMore

  return (
    <div className="mx-auto w-full max-w-8xl space-y-4">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {!selectedServerKey ? (
        <Card>
          <CardContent className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
            <CardTitle>No server selected</CardTitle>
            <p className="max-w-md text-sm text-muted-foreground">
              Select an online virtual server from Server List first.
            </p>
            <Button asChild>
              <Link to="/servers">Open Server List</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <CardHeader className="space-y-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.3fr_220px_1fr_auto]">
              <div className="flex flex-wrap items-center gap-3">
                {levelOptions.map((level) => (
                  <label
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors",
                      getLevelFilterClass(level.value, levels[level.value]),
                      busy && "opacity-60",
                    )}
                    key={level.value}
                  >
                    <Checkbox
                      checked={levels[level.value]}
                      className={getLevelCheckboxClass(level.value)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        setLevels((currentLevels) => ({
                          ...currentLevels,
                          [level.value]: checked === true,
                        }))
                      }
                    />
                    {level.label}
                  </label>
                ))}
              </div>

              <AppSelect
                disabled={busy}
                options={timezoneOptions}
                placeholder="Timestamp"
                value={selectedTimezone}
                onChange={(value) => setSelectedTimezone(value as TimezoneMode)}
              />

              <Input
                className="h-9"
                disabled={busy}
                placeholder="Filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />


              
              <Button
                disabled={busy || !selectedServerKey}
                type="button"
                variant="outline"
                className="h-9"
                onClick={() => void reloadLogView()}
              >
                <RefreshCw
                  className={cn("size-4", (loading || refreshing) && "animate-spin")}
                />
                Refresh
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="space-y-2 p-3 md:hidden">
              {loading && !logView.length ? (
                <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                  ...loading
                </div>
              ) : visibleLogs.length ? (
                visibleLogs.map((log, index) => (
                  <div
                    className="rounded-md border p-3 text-sm"
                    key={`${log.rawTimestamp}:${index}`}
                  >
                    <div className="grid gap-2">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          Timestamp
                        </span>
                        <span
                          className="min-w-0 truncate text-right font-mono text-xs text-foreground"
                          title={log.timestamp}
                        >
                          {log.timestamp}
                        </span>
                      </div>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          Level
                        </span>
                        <Badge
                          className={cn(
                            "shrink-0 rounded-sm border font-mono uppercase",
                            getLevelBadgeClass(log.level),
                          )}
                          variant="outline"
                        >
                          {log.level}
                        </Badge>
                      </div>
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          Channel
                        </span>
                        <span
                          className="min-w-0 truncate text-right font-mono text-xs text-muted-foreground"
                          title={log.channel}
                        >
                          {log.channel}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 border-t pt-3">
                      <div className="text-xs font-medium text-muted-foreground">
                        Message
                      </div>
                      <div className="mt-2 whitespace-pre-wrap break-words font-mono text-xs leading-5 text-foreground">
                        {log.msg}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-md border p-4 text-center text-sm text-muted-foreground">
                  No logs found.
                </div>
              )}
            </div>
            <div className="hidden max-w-full overflow-x-auto md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Timestamp</TableHead>
                    <TableHead className="w-28">Level</TableHead>
                    <TableHead className="w-40">Channel</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && !logView.length ? (
                    <TableRow>
                      <TableCell
                        className="h-40 text-center text-sm text-muted-foreground"
                        colSpan={4}
                      >
                        ...loading
                      </TableCell>
                    </TableRow>
                  ) : visibleLogs.length ? (
                    visibleLogs.map((log, index) => (
                      <TableRow key={`${log.rawTimestamp}:${index}`}>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {log.timestamp}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              "rounded-sm border font-mono uppercase",
                              getLevelBadgeClass(log.level),
                            )}
                            variant="outline"
                          >
                            {log.level}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {log.channel}
                        </TableCell>
                        <TableCell className="min-w-[28rem] whitespace-pre-wrap font-mono text-xs leading-5">
                          {log.msg}
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell
                        className="h-40 text-center text-sm text-muted-foreground"
                        colSpan={4}
                      >
                        No logs found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <div ref={loadMoreRef} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
