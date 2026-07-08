import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react"

import { TeamSpeak } from "@/api/teamspeak"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"

type ParsedQueryRequest = {
  command: string
  options: string[]
  parameters: Record<string, string>
}

type ConsoleEntry = {
  command: string
  error?: unknown
  id: number
  response?: unknown
  status: "pending" | "success" | "error"
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message)
  }

  if (typeof error === "string") {
    return error
  }

  return "TeamSpeak request failed."
}

function formatConsoleValue(value: unknown, prettyPrint: boolean) {
  if (typeof value === "string") {
    return value
  }

  if (value === undefined) {
    return "undefined"
  }

  try {
    return JSON.stringify(value, null, prettyPrint ? 2 : 0) ?? String(value)
  } catch {
    return String(value)
  }
}

function parseQueryRequest(input: string): ParsedQueryRequest {
  const parts = input.split(" ")
  const command = parts[0] ?? ""
  const parameters: Record<string, string> = {}
  const options: string[] = []

  for (const part of parts) {
    if (/=/.test(part)) {
      const [, key, value] = part.match(/^([^=]+)=(.*)$/) ?? []

      if (key !== undefined) {
        parameters[key] = value ?? ""
      }
    } else if (/^-/.test(part)) {
      options.push(part)
    }
  }

  return { command, options, parameters }
}

export function Console() {
  const outputEndRef = useRef<HTMLDivElement | null>(null)
  const commandInputRef = useRef<HTMLInputElement | null>(null)
  const nextEntryIdRef = useRef(0)
  const historyDraftRef = useRef("")
  const { dismissToast, showError, toasts } = useToastStack()
  const [commandInput, setCommandInput] = useState("")
  const [commandHistory, setCommandHistory] = useState<string[]>([])
  const [entries, setEntries] = useState<ConsoleEntry[]>([])
  const [executing, setExecuting] = useState(false)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [prettyPrint, setPrettyPrint] = useState(true)

  const hasEntries = entries.length > 0
  const latestEntry = entries[entries.length - 1]

  useEffect(() => {
    outputEndRef.current?.scrollIntoView({ block: "end" })
  }, [latestEntry])

  const formattedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        output: formatConsoleValue(
          entry.status === "error" ? entry.error : entry.response,
          prettyPrint,
        ),
      })),
    [entries, prettyPrint],
  )

  const focusCommandInput = () => {
    window.requestAnimationFrame(() => {
      commandInputRef.current?.focus()
    })
  }

  const executeCommand = async () => {
    const input = commandInput.trim()

    if (!input || executing) {
      return
    }

    const { command, options, parameters } = parseQueryRequest(input)
    const entryId = nextEntryIdRef.current + 1

    nextEntryIdRef.current = entryId
    historyDraftRef.current = ""
    setHistoryIndex(null)
    setCommandInput("")
    focusCommandInput()
    setCommandHistory((currentHistory) => {
      if (currentHistory[currentHistory.length - 1] === input) {
        return currentHistory
      }

      return [...currentHistory, input].slice(-50)
    })
    setExecuting(true)
    setEntries((currentEntries) => [
      ...currentEntries,
      {
        command: input,
        id: entryId,
        status: "pending",
      },
    ])

    try {
      const response = await TeamSpeak.execute(command, parameters, options)

      setEntries((currentEntries) =>
        currentEntries.map((entry) =>
          entry.id === entryId
            ? { ...entry, response, status: "success" }
            : entry,
        ),
      )
    } catch (error) {
      setEntries((currentEntries) =>
        currentEntries.map((entry) =>
          entry.id === entryId ? { ...entry, error, status: "error" } : entry,
        ),
      )
      showError(getErrorMessage(error))
    } finally {
      setExecuting(false)
      focusCommandInput()
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void executeCommand()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowUp") {
      if (!commandHistory.length) {
        return
      }

      event.preventDefault()

      setHistoryIndex((currentIndex) => {
        if (currentIndex === null) {
          historyDraftRef.current = commandInput
          const nextIndex = commandHistory.length - 1

          setCommandInput(commandHistory[nextIndex] ?? "")

          return nextIndex
        }

        const nextIndex = Math.max(0, currentIndex - 1)

        setCommandInput(commandHistory[nextIndex] ?? "")

        return nextIndex
      })

      return
    }

    if (event.key === "ArrowDown") {
      if (historyIndex === null) {
        return
      }

      event.preventDefault()

      setHistoryIndex((currentIndex) => {
        if (currentIndex === null) {
          return null
        }

        if (currentIndex >= commandHistory.length - 1) {
          setCommandInput(historyDraftRef.current)
          historyDraftRef.current = ""

          return null
        }

        const nextIndex = currentIndex + 1

        setCommandInput(commandHistory[nextIndex] ?? "")

        return nextIndex
      })

      return
    }

    if (event.key === "Enter") {
      event.preventDefault()
      void executeCommand()
    }
  }

  const handleCommandInputChange = (value: string) => {
    historyDraftRef.current = ""
    setHistoryIndex(null)
    setCommandInput(value)
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center gap-3">
            <button
              aria-checked={prettyPrint}
              aria-label="Toggle pretty print"
              className="inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-muted px-0.5 transition-colors data-[state=checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              data-state={prettyPrint ? "checked" : "unchecked"}
              role="switch"
              type="button"
              onClick={() => setPrettyPrint((current) => !current)}
            >
              <span
                className="size-5 rounded-full bg-background shadow-sm transition-transform data-[state=checked]:translate-x-5"
                data-state={prettyPrint ? "checked" : "unchecked"}
              />
            </button>
            <span className="text-sm font-medium">Pretty print</span>
          </div>

          <ScrollArea className="h-[min(58vh,520px)] overflow-x-hidden rounded-lg border bg-muted/30">
            <div className="min-h-full min-w-0 max-w-full space-y-4 overflow-x-hidden p-4 font-mono text-xs leading-relaxed">
              {hasEntries ? (
                formattedEntries.map((entry) => (
                  <div className="min-w-0 max-w-full space-y-2 overflow-x-hidden" key={entry.id}>
                    <div className="flex min-w-0 max-w-full items-center gap-2 overflow-x-hidden text-foreground">
                      <span className="shrink-0 text-muted-foreground">~$</span>
                      <span className="min-w-0 break-all [overflow-wrap:anywhere]">
                        {entry.command}
                      </span>
                    </div>
                    {entry.status === "pending" ? (
                      <div className="pl-6 text-muted-foreground">Running...</div>
                    ) : (
                      <pre
                        className={
                          entry.status === "error"
                            ? "max-w-full whitespace-pre-wrap break-all pl-6 text-destructive [overflow-wrap:anywhere]"
                            : "max-w-full whitespace-pre-wrap break-all pl-6 text-foreground [overflow-wrap:anywhere]"
                        }
                      >
                        {entry.output}
                      </pre>
                    )}
                  </div>
                ))
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-center text-sm font-normal text-muted-foreground">
                  Run a command like version or whoami to see the response here
                </div>
              )}
              <div ref={outputEndRef} />
            </div>
          </ScrollArea>
        </CardContent>
        <CardFooter>
          <form className="w-full" onSubmit={handleSubmit}>
            <div className="flex min-w-0 items-center rounded-lg border border-input bg-background px-2.5 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
              <span className="mr-2 font-mono text-lg leading-none text-muted-foreground">
                »
              </span>
              <Input
                ref={commandInputRef}
                className="h-8 min-w-0 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
                aria-disabled={executing}
                placeholder="Type a command and press Enter."
                value={commandInput}
                onChange={(event) => handleCommandInputChange(event.target.value)}
                onKeyDown={handleInputKeyDown}
              />
            </div>
          </form>
        </CardFooter>
      </Card>
    </div>
  )
}
