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

type ChannelRow = {
  cid: string | number
  channelName: string
  [key: string]: unknown
}

type ClientDbRow = {
  cldbid: string | number
  clientNickname: string
  [key: string]: unknown
}

const availablePermissionCache = new Map<string, Permission[]>()
const availablePermissionFlights = new Map<string, Promise<Permission[]>>()
const channelCache = new Map<string, ChannelRow[]>()
const channelFlights = new Map<string, Promise<ChannelRow[]>>()
const clientCache = new Map<string, ClientDbRow[]>()
const clientFlights = new Map<string, Promise<ClientDbRow[]>>()
const permissionCache = new Map<string, Permission[]>()
const permissionFlights = new Map<string, Promise<Permission[]>>()

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

export function ChannelClientPermissions() {
  const navigate = useNavigate()
  const { cid, cldbid } = useParams()
  const { queryUser, saveQueryUser, saveServerId, serverId } = useAuth()
  const queryUserRef = useRef(queryUser)
  const selectServerFlightRef = useRef<ReturnType<
    typeof TeamSpeak.useServer
  > | null>(null)
  const { dismissToast, showError, toasts } = useToastStack()
  const [availablePermissions, setAvailablePermissions] = useState<Permission[]>([])
  const [grantedPermissions, setGrantedPermissions] = useState<Permission[]>([])
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [clients, setClients] = useState<ClientDbRow[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [entityLoading, setEntityLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    queryUserRef.current = queryUser
  }, [queryUser])

  const selectedServerId = useMemo(() => {
    if (isUsableServerId(queryUser.virtualserverId)) return queryUser.virtualserverId
    if (isUsableServerId(serverId)) return serverId
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

  const serverCacheKey = selectedServerId ? String(selectedServerId) : "__unknown__"

  const loadAvailablePermissions = useCallback(async () => {
    await ensureSelectedServer()
    const cached = availablePermissionCache.get(serverCacheKey)
    if (cached) return cached

    let flight = availablePermissionFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<Permission[]>("permissionlist")
        .then((permissions) => {
          availablePermissionCache.set(serverCacheKey, permissions)
          return permissions
        })
        .finally(() => availablePermissionFlights.delete(serverCacheKey))

      availablePermissionFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const loadChannels = useCallback(async () => {
    await ensureSelectedServer()
    const cached = channelCache.get(serverCacheKey)
    if (cached) return cached

    let flight = channelFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<ChannelRow[]>("channellist")
        .then((nextChannels) => {
          channelCache.set(serverCacheKey, nextChannels)
          return nextChannels
        })
        .finally(() => channelFlights.delete(serverCacheKey))

      channelFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const loadClients = useCallback(async () => {
    await ensureSelectedServer()
    const cached = clientCache.get(serverCacheKey)
    if (cached) return cached

    let flight = clientFlights.get(serverCacheKey)
    if (!flight) {
      flight = fullClientDBList()
        .then((nextClients) => {
          clientCache.set(serverCacheKey, nextClients)
          return nextClients
        })
        .finally(() => clientFlights.delete(serverCacheKey))

      clientFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const getPermissions = useCallback(
    async (channelId: string | number, clientDbId: string | number) => {
      const key =
        serverCacheKey +
        ":channelclient:" +
        String(channelId) +
        ":" +
        String(clientDbId)
      const cached = permissionCache.get(key)
      if (cached) return cached

      let flight = permissionFlights.get(key)
      if (!flight) {
        flight = ensureSelectedServer()
          .then(() =>
            TeamSpeak.execute<Permission[]>("channelclientpermlist", {
              cid: channelId,
              cldbid: clientDbId,
            }),
          )
          .then((permissions) => {
            permissionCache.set(key, permissions)
            return permissions
          })
          .finally(() => permissionFlights.delete(key))

        permissionFlights.set(key, flight)
      }

      return flight
    },
    [ensureSelectedServer, serverCacheKey],
  )

  const refreshPermissions = useCallback(
    async (channelId: string | number, clientDbId: string | number) => {
      const key =
        serverCacheKey +
        ":channelclient:" +
        String(channelId) +
        ":" +
        String(clientDbId)
      permissionCache.delete(key)
      permissionFlights.delete(key)
      const permissions = await TeamSpeak.execute<Permission[]>(
        "channelclientpermlist",
        { cid: channelId, cldbid: clientDbId },
      )
      permissionCache.set(key, permissions)
      return permissions
    },
    [serverCacheKey],
  )

  useEffect(() => {
    let active = true
    setInitialLoading(
      availablePermissions.length === 0 ||
        channels.length === 0 ||
        clients.length === 0,
    )

    const availablePermissionsPromise = loadAvailablePermissions()
      .then((permissions) => {
        if (!active) return
        setAvailablePermissions(permissions)
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    const channelsPromise = loadChannels()
      .then((data) => {
        if (!active) return []
        setChannels(data)
        return data
      })
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
        return []
      })

    const clientsPromise = loadClients()
      .then((data) => {
        if (!active) return []
        setClients(data)
        return data
      })
      .catch((error: unknown) => {
        if (active) showError(getErrorMessage(error))
        return []
      })

    Promise.all([channelsPromise, clientsPromise]).then(
      ([nextChannels, nextClients]) => {
        if (
          !active ||
          cid ||
          cldbid ||
          !nextChannels?.[0] ||
          !nextClients?.[0]
        ) {
          return
        }

        void getPermissions(nextChannels[0].cid, nextClients[0].cldbid).then(
            (permissions) => {
              if (active) setGrantedPermissions(permissions)
            },
          )
          navigate(
            "/permissions/channel/" +
              String(nextChannels[0].cid) +
              "/client/" +
              String(nextClients[0].cldbid),
            { replace: true },
          )
      },
    )

    Promise.allSettled([
      availablePermissionsPromise,
      channelsPromise,
      clientsPromise,
    ]).finally(() => active && setInitialLoading(false))

    return () => {
      active = false
    }
  }, [availablePermissions.length, channels.length, cid, cldbid, clients.length, getPermissions, loadAvailablePermissions, loadChannels, loadClients, navigate, showError])

  useEffect(() => {
    if (!cid || !cldbid) return
    let active = true
    const key =
      serverCacheKey + ":channelclient:" + String(cid) + ":" + String(cldbid)
    const cached = permissionCache.get(key)
    if (cached) {
      setGrantedPermissions(cached)
      setEntityLoading(false)
      return () => {
        active = false
      }
    }

    setEntityLoading(true)
    getPermissions(cid, cldbid)
      .then((permissions) => active && setGrantedPermissions(permissions))
      .catch((error: unknown) => active && showError(getErrorMessage(error)))
      .finally(() => active && setEntityLoading(false))

    return () => {
      active = false
    }
  }, [cid, cldbid, getPermissions, serverCacheKey, showError])

  const navigatePair = (nextCid: string, nextCldbId: string) => {
    navigate("/permissions/channel/" + nextCid + "/client/" + nextCldbId)
  }

  const savePermission = async (
    permission: Permission,
    values: PermissionEditValues,
  ) => {
    if (!cid || !cldbid) return
    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelclientaddperm", {
        cid,
        cldbid,
        permid: permission.permid,
        permvalue: Number(values.permvalue),
      })
      setGrantedPermissions(await refreshPermissions(cid, cldbid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const removePermission = async (permission: Permission) => {
    if (!cid || !cldbid) return
    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channelclientdelperm", {
        cid,
        cldbid,
        permid: permission.permid,
      })
      setGrantedPermissions(await refreshPermissions(cid, cldbid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PermissionPageFlow
        availablePermissions={availablePermissions}
        busy={
          entityLoading ||
          submitting ||
          (initialLoading && grantedPermissions.length === 0)
        }
        editableFields={["permvalue"]}
        grantedPermissions={grantedPermissions}
        loading={
          initialLoading &&
          availablePermissions.length === 0 &&
          grantedPermissions.length === 0
        }
        selectors={[
          {
            label: "Channel",
            options: [
              ...(cid &&
              !channels.some((channel) => String(channel.cid) === String(cid))
                ? [{ label: "Channel " + cid, value: String(cid) }]
                : []),
              ...channels.map((channel) => ({
                label: channel.channelName,
                value: String(channel.cid),
              })),
            ],
            value: cid ?? "",
            onChange: (value) =>
              navigatePair(value, cldbid ?? String(clients[0]?.cldbid ?? "")),
          },
          {
            label: "Client",
            options: [
              ...(cldbid &&
              !clients.some((client) => String(client.cldbid) === String(cldbid))
                ? [{ label: "Client " + cldbid, value: String(cldbid) }]
                : []),
              ...clients.map((client) => ({
                label: client.clientNickname,
                value: String(client.cldbid),
              })),
            ],
            value: cldbid ?? "",
            onChange: (value) =>
              navigatePair(cid ?? String(channels[0]?.cid ?? ""), value),
          },
        ]}
        submitting={submitting}
        title="Channel Client Permissions"
        onRemove={removePermission}
        onSave={savePermission}
      />
    </>
  )
}
