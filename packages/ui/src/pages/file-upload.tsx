import { useMemo, useRef, useState, type ChangeEvent } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { Paperclip, Upload } from "lucide-react"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
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

type FileTransferUpload = {
  ftkey: string
  port: string | number
  [key: string]: unknown
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

function normalizePath(value: string | null | undefined) {
  if (!value || value.trim() === "") {
    return "/"
  }

  const normalized = value.replace(/\\/g, "/").replace(/\/+/g, "/")

  if (normalized === "/") {
    return "/"
  }

  const withoutTrailingSlash = normalized.replace(/\/$/g, "")

  return withoutTrailingSlash.startsWith("/")
    ? withoutTrailingSlash
    : "/" + withoutTrailingSlash
}

function trimPathSegment(value: string) {
  return value.replace(/^\/+|\/+$/g, "")
}

function joinFilePath(basePath: string | undefined, name: string) {
  const normalizedBase = normalizePath(basePath)
  const normalizedName = trimPathSegment(name)

  if (!normalizedName) {
    return normalizedBase
  }

  return normalizedBase === "/"
    ? "/" + normalizedName
    : normalizedBase + "/" + normalizedName
}

function getClientFileTransferId() {
  return Math.floor(Math.random() * 10000)
}

function getUploadUrl() {
  const base =
  import.meta.env.DEV && import.meta.env.VITE_WEBSOCKET_URI
    ? import.meta.env.VITE_WEBSOCKET_URI
    : window.location.origin

  return new URL("/api/upload", base).href
}

export function FileUpload() {
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const cid = params.cid ?? ""
  const path = normalizePath(searchParams.get("path"))
  const { queryUser, saveServerId, serverId } = useAuth()
  const { dismissToast, showError, showSuccess, toasts } = useToastStack()
  const [files, setFiles] = useState<globalThis.File[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])

  const filesUrl =
    "/files?cid=" +
    encodeURIComponent(cid) +
    (path === "/" ? "" : "&path=" + encodeURIComponent(path))

  const ensureSelectedServer = async () => {
    if (!isUsableServerId(selectedServerId)) {
      throw new Error("No valid virtual server selected.")
    }

    const validSelectedServerId = selectedServerId as string | number

    await TeamSpeak.useServer(validSelectedServerId, { progress: "background" })
    saveServerId(validSelectedServerId)
  }

  const uploadSingleFile = async (file: globalThis.File) => {
    const response = await TeamSpeak.execute<FileTransferUpload[]>(
      "ftinitupload",
      {
        cid,
        clientftfid: getClientFileTransferId(),
        cpw: "",
        name: joinFilePath(path, file.name),
        overwrite: 1,
        resume: 0,
        size: file.size,
      },
      [],
      { progress: "foreground" },
    )
    const transfer = response[0]

    if (!transfer) {
      throw new Error("Upload could not be initialized.")
    }

    const formData = new FormData()
    formData.append("file", file)

    const uploadResponse = await fetch(getUploadUrl(), {
      body: formData,
      credentials: "include",
      headers: {
        "x-file-transfer-key": String(transfer.ftkey),
        "x-file-transfer-port": String(transfer.port),
      },
      method: "POST",
    })

    if (!uploadResponse.ok) {
      const message = await uploadResponse.text()
      throw new Error(message || "Upload failed.")
    }
  }

  const uploadFiles = async () => {
    if (!files.length) {
      return
    }

    setUploading(true)

    try {
      await ensureSelectedServer()

      for (const file of files) {
        await uploadSingleFile(file)
      }

      showSuccess(files.length === 1 ? "File uploaded" : "Files uploaded")
      window.setTimeout(() => {
        navigate(filesUrl)
      }, 350)
    } catch (uploadError) {
      showError(getErrorMessage(uploadError))
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFiles(Array.from(event.target.files ?? []))
  }

  if (!isUsableServerId(selectedServerId)) {
    return (
      <div className="mx-auto flex min-h-[55vh] w-full max-w-xl items-center justify-center">
        <Card className="w-full">
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
    <div className="mx-auto flex min-h-[55vh] w-full max-w-2xl items-center justify-center">
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Card className="w-full">
        <CardHeader>
          <CardTitle>Upload File</CardTitle>
        </CardHeader>
        <CardContent>
          <input
            ref={fileInputRef}
            className="hidden"
            disabled={uploading}
            id="file-upload-input"
            multiple
            type="file"
            onChange={handleFileChange}
          />
          <button
            className="flex h-12 w-full items-center gap-3 border-b border-input px-1 text-left text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={uploading}
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {files.length
                ? files.map((file) => file.name).join(", ")
                : "Upload File(s)"}
            </span>
          </button>
        </CardContent>
        <CardFooter className="flex-wrap justify-end gap-2 max-sm:[&>*]:w-full">
          <Button
            disabled={uploading || !files.length}
            type="button"
            onClick={() => void uploadFiles()}
          >
            <Upload className="size-4" />
            {uploading ? "Uploading..." : "Upload"}
          </Button>
          <Button disabled={uploading} type="button" variant="outline" onClick={() => navigate(filesUrl)}>
            Cancel
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
