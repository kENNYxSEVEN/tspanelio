import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"

import { TeamSpeak } from "@/api/teamspeak"
import { useAuth } from "@/auth/auth-context"
import {
  PermissionPageFlow,
  type Permission,
  type PermissionEditValues,
} from "@/components/permission-page-flow"
import { ToastStack, useToastStack } from "@/components/toast-stack"

type ClientDbRow = {
  cldbid: string | number
  clientNickname: string
  [key: string]: unknown
}

const availablePermissionCache = new Map<string, Permission[]>()
const availablePermissionFlights = new Map<string, Promise<Permission[]>>()
const clientCache = new Map<string, ClientDbRow[]>()
const clientFlights = new Map<string, Promise<ClientDbRow[]>>()
const clientPermissionCache = new Map<string, Permission[]>()
const clientPermissionFlights = new Map<string, Promise<Permission[]>>()

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

async function fullClientDBList() {
  const fullClientDbList: ClientDbRow[] = []
  let start = 0
  const duration = 200

  while (true) {
    const clients = await TeamSpeak.execute<ClientDbRow[]>("clientdblist", {
      start,
      duration,
    })

    if (!clients.length) break

    fullClientDbList.push(...clients)
    start += duration
  }

  return fullClientDbList
}

export function ClientPermissions() {
  const navigate = useNavigate()
  const { cldbid } = useParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, toasts } = useToastStack()
  const [availablePermissions, setAvailablePermissions] = useState<
    Permission[]
  >([])
  const [grantedPermissions, setGrantedPermissions] = useState<Permission[]>([])
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [clientLoading, setClientLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) {
      return queryUser.virtualserverId
    }

    if (isUsableServerId(serverId)) {
      return serverId
    }

    return undefined
  }, [queryUser.virtualserverId, serverId])

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

  const serverCacheKey = selectedServerId
    ? String(selectedServerId)
    : "__unknown__"

  const loadAvailablePermissions = useCallback(async () => {
    await ensureSelectedServer()

    const cachedData = availablePermissionCache.get(serverCacheKey)
    if (cachedData) return cachedData

    let flight = availablePermissionFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<Permission[]>("permissionlist")
        .then((permissions) => {
          availablePermissionCache.set(serverCacheKey, permissions)
          return permissions
        })
        .finally(() => {
          availablePermissionFlights.delete(serverCacheKey)
        })

      availablePermissionFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const loadClients = useCallback(async () => {
    await ensureSelectedServer()

    const cachedData = clientCache.get(serverCacheKey)
    if (cachedData) return cachedData

    let flight = clientFlights.get(serverCacheKey)
    if (!flight) {
      flight = fullClientDBList()
        .then((nextClients) => {
          clientCache.set(serverCacheKey, nextClients)
          return nextClients
        })
        .finally(() => {
          clientFlights.delete(serverCacheKey)
        })

      clientFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const getClientPermissions = useCallback(
    async (clientDbId: string | number) => {
      const key = serverCacheKey + ":" + String(clientDbId)
      const cachedPermissions = clientPermissionCache.get(key)
      if (cachedPermissions) return cachedPermissions

      let flight = clientPermissionFlights.get(key)
      if (!flight) {
        flight = ensureSelectedServer()
          .then(() =>
            TeamSpeak.execute<Permission[]>("clientpermlist", {
              cldbid: clientDbId,
            }),
          )
          .then((permissions) => {
            clientPermissionCache.set(key, permissions)
            return permissions
          })
          .finally(() => {
            clientPermissionFlights.delete(key)
          })

        clientPermissionFlights.set(key, flight)
      }

      return flight
    },
    [ensureSelectedServer, serverCacheKey],
  )

  const refreshClientPermissions = useCallback(
    async (clientDbId: string | number) => {
      const key = serverCacheKey + ":" + String(clientDbId)
      clientPermissionCache.delete(key)
      clientPermissionFlights.delete(key)

      const permissions = await TeamSpeak.execute<Permission[]>(
        "clientpermlist",
        { cldbid: clientDbId },
      )

      clientPermissionCache.set(key, permissions)
      return permissions
    },
    [serverCacheKey],
  )

  useEffect(() => {
    let active = true

    setInitialLoading(availablePermissions.length === 0 || clients.length === 0)

    const availablePermissionsPromise = loadAvailablePermissions()
      .then((permissions) => {
        if (active) setAvailablePermissions(permissions)
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    const clientsPromise = loadClients()
      .then((data) => {
        if (!active) return

        setClients(data)

        if (!cldbid && data[0]) {
          void getClientPermissions(data[0].cldbid).then((permissions) => {
            if (active) setGrantedPermissions(permissions)
          })
          navigate("/permissions/client/" + String(data[0].cldbid), {
            replace: true,
          })
        }
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    Promise.allSettled([availablePermissionsPromise, clientsPromise]).finally(
      () => active && setInitialLoading(false),
    )

    return () => {
      active = false
    }
  }, [
    availablePermissions.length,
    clients.length,
    cldbid,
    getClientPermissions,
    loadAvailablePermissions,
    loadClients,
    navigate,
    showError,
  ])

  useEffect(() => {
    if (!cldbid) return

    let active = true
    const key = serverCacheKey + ":" + String(cldbid)
    const cachedPermissions = clientPermissionCache.get(key)

    if (cachedPermissions) {
      setGrantedPermissions(cachedPermissions)
      setClientLoading(false)
      return () => {
        active = false
      }
    }

    setClientLoading(true)
    getClientPermissions(cldbid)
      .then((permissions) => active && setGrantedPermissions(permissions))
      .catch((error: unknown) => active && showError(getErrorMessage(error)))
      .finally(() => active && setClientLoading(false))

    return () => {
      active = false
    }
  }, [cldbid, getClientPermissions, serverCacheKey, showError])

  const savePermission = async (
    permission: Permission,
    values: PermissionEditValues,
  ) => {
    if (!cldbid) return

    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("clientaddperm", {
        cldbid,
        permid: permission.permid,
        permskip: Number(values.permskip),
        permvalue: Number(values.permvalue),
      })
      setGrantedPermissions(await refreshClientPermissions(cldbid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const removePermission = async (permission: Permission) => {
    if (!cldbid) return

    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("clientdelperm", {
        cldbid,
        permid: permission.permid,
      })
      setGrantedPermissions(await refreshClientPermissions(cldbid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const clientOptions = [
    ...(cldbid &&
    !clients.some((client) => String(client.cldbid) === String(cldbid))
      ? [{ label: "Client " + cldbid, value: String(cldbid) }]
      : []),
    ...clients.map((client) => ({
      label: client.clientNickname,
      value: String(client.cldbid),
    })),
  ]

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PermissionPageFlow
        availablePermissions={availablePermissions}
        busy={
          clientLoading ||
          submitting ||
          (initialLoading && grantedPermissions.length === 0)
        }
        editableFields={["permvalue", "permskip"]}
        grantedPermissions={grantedPermissions}
        loading={
          initialLoading &&
          availablePermissions.length === 0 &&
          grantedPermissions.length === 0
        }
        selectors={[
          {
            label: "Client",
            options: clientOptions,
            searchable: true,
            value: cldbid ?? "",
            onChange: (value) => navigate("/permissions/client/" + value),
          },
        ]}
        submitting={submitting}
        title="Client Permissions"
        onRemove={removePermission}
        onSave={savePermission}
      />
    </>
  )
}
