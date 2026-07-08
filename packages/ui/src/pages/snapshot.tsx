import {
  Copy,
  Download,
  FileArchive,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react"
import { Link } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import { AppModal } from "@/components/app-modal"
import { ToastStack, useToastStack } from "@/components/toast-stack"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { copyTextToClipboard } from "@/lib/clipboard"

type SnapshotRow = {
  data?: string
  [key: string]: unknown
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

function isUsableServerId(value: string | number | undefined | null) {
  return (
    value !== undefined &&
    value !== null &&
    String(value) !== "" &&
    String(value) !== "0"
  )
}

function generateSnapshotFileName() {
  return `${new Date().toISOString()}.backup`
}

function getSnapshotData(response: SnapshotRow[] | []) {
  const snapshot = response[0]?.data

  if (!snapshot) {
    throw new Error("Snapshot response did not include backup data.")
  }

  return snapshot
}

function downloadSnapshot(snapshot: string, fileName = generateSnapshotFileName()) {
  const url = URL.createObjectURL(new Blob([snapshot]))
  const link = document.createElement("a")

  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function Snapshot() {
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [createdSnapshot, setCreatedSnapshot] = useState("")
  const [createdFileName, setCreatedFileName] = useState("")
  const [deploySnapshotText, setDeploySnapshotText] = useState("")
  const [deployFileName, setDeployFileName] = useState("")
  const [creating, setCreating] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [confirmDeployOpen, setConfirmDeployOpen] = useState(false)

  queryUserRef.current = queryUser

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

    const nextQueryUser = await TeamSpeak.ensureQueryIdentity({
      progress: "background",
    })

    if (nextQueryUser) {
      queryUserRef.current = nextQueryUser
      saveQueryUser(nextQueryUser)
    }

    return queryUserRef.current
  }, [saveQueryUser, saveServerId, selectedServerId])

  const handleCreateSnapshot = async () => {
    setCreating(true)

    try {
      await ensureSelectedServer()

      const snapshot = getSnapshotData(await TeamSpeak.createSnapshot())
      const nextFileName = generateSnapshotFileName()

      setCreatedSnapshot(snapshot)
      setCreatedFileName(nextFileName)
      downloadSnapshot(snapshot, nextFileName)
      showSuccess("Snapshot created")
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const handleCopySnapshot = async () => {
    if (!createdSnapshot) {
      return
    }

    try {
      await copyTextToClipboard(createdSnapshot)
      showSuccess("Snapshot copied")
    } catch (error) {
      showError(getErrorMessage(error))
    }
  }

  const handleDownloadSnapshot = () => {
    if (!createdSnapshot) {
      return
    }

    downloadSnapshot(createdSnapshot, createdFileName || generateSnapshotFileName())
  }

  const clearCreatedSnapshot = () => {
    setCreatedSnapshot("")
    setCreatedFileName("")
  }

  const handleSelectFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    try {
      const text = await file.text()

      setDeployFileName(file.name)
      setDeploySnapshotText(text)
    } catch (error) {
      showError(getErrorMessage(error))
    }
  }

  const clearDeploySnapshot = () => {
    setDeploySnapshotText("")
    setDeployFileName("")

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }

  const openDeployConfirmation = () => {
    if (!deploySnapshotText.trim()) {
      showError("Select or paste a snapshot backup first.")
      return
    }

    setConfirmDeployOpen(true)
  }

  const handleDeploySnapshot = async () => {
    if (!deploySnapshotText.trim()) {
      setConfirmDeployOpen(false)
      return
    }

    setDeploying(true)

    try {
      await ensureSelectedServer()
      await TeamSpeak.deploySnapshot(new Blob([deploySnapshotText]))

      showSuccess("Snapshot successfully restored")

      if (selectedServerKey) {
        const nextQueryUser = await TeamSpeak.selectServer(selectedServerKey, {
          progress: "background",
        })

        saveServerId(selectedServerKey)

        if (nextQueryUser) {
          queryUserRef.current = nextQueryUser
          saveQueryUser(nextQueryUser)
        }
      }

      clearDeploySnapshot()
      setConfirmDeployOpen(false)
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setDeploying(false)
    }
  }

  if (!isUsableServerId(selectedServerId)) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <Card>
          <CardHeader>
            <CardTitle>No server selected</CardTitle>
            <CardDescription>
              Select an online virtual server from Server List first.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button asChild>
              <Link to="/servers">Go to Server List</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card>
        <CardHeader>
          <CardTitle>Backup</CardTitle>
          <CardDescription>
            Download a backup file which contains the data needed to restore the
            virtual server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            disabled={creating || deploying}
            type="button"
            onClick={handleCreateSnapshot}
          >
            <Download className="size-4" />
            {creating ? "Creating..." : "Create Snapshot"}
          </Button>

          {createdSnapshot ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <FileArchive className="size-4 shrink-0" />
                  <span className="truncate">
                    {createdFileName || "snapshot.backup"}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleCopySnapshot}
                  >
                    <Copy className="size-4" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleDownloadSnapshot}
                  >
                    <Download className="size-4" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={clearCreatedSnapshot}
                  >
                    <Trash2 className="size-4" />
                    Clear
                  </Button>
                </div>
              </div>
              <Textarea
                readOnly
                className="min-h-38 resize-y font-mono text-xs"
                value={createdSnapshot}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Restore</CardTitle>
          <CardDescription>
            Upload or paste a backup file to restore the virtual server
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            accept=".backup"
            className="hidden"
            type="file"
            onChange={handleFileChange}
          />

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="snapshot-file">Backup file</Label>
              <Input
                readOnly
                id="snapshot-file"
                placeholder="Select Backup File"
                value={deployFileName}
                onClick={handleSelectFile}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSelectFile}
            >
              <Upload className="size-4" />
              Select File
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="snapshot-content">Snapshot content</Label>
            <Textarea
              id="snapshot-content"
              className="min-h-46 resize-y font-mono text-xs"
              placeholder="Paste snapshot backup content here"
              value={deploySnapshotText}
              onChange={(event) => {
                setDeploySnapshotText(event.target.value)

                if (deployFileName) {
                  setDeployFileName("")
                }
              }}
            />
          </div>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2 max-sm:[&>*]:w-full">
          <Button
            disabled={!deploySnapshotText && !deployFileName}
            type="button"
            variant="outline"
            onClick={clearDeploySnapshot}
          >
            Clear
          </Button>
          <Button
            disabled={!deploySnapshotText.trim() || creating || deploying}
            type="button"
            variant="destructive"
            onClick={openDeployConfirmation}
          >
            <RotateCcw className="size-4" />
            Deploy Snapshot
          </Button>
        </CardFooter>
      </Card>

      <AppModal
        open={confirmDeployOpen}
        preventClose={deploying}
        title="Deploy Snapshot"
        footer={
          <>
            <Button
              disabled={deploying}
              type="button"
              variant="destructive"
              onClick={handleDeploySnapshot}
            >
              {deploying ? "Deploying..." : "Deploy"}
            </Button>
            <Button
              disabled={deploying}
              type="button"
              variant="outline"
              onClick={() => setConfirmDeployOpen(false)}
            >
              Cancel
            </Button>
          </>
        }
        onClose={() => setConfirmDeployOpen(false)}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            Deploying a snapshot can overwrite current server settings,
            channels, permissions, and related virtual server data.
          </p>
          <p>This action should only be used on the intended virtual server.</p>
        </div>
      </AppModal>
    </div>
  )
}
