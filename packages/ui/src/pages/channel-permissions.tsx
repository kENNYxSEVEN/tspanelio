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

const availablePermissionCache = new Map<string, Permission[]>()
const availablePermissionFlights = new Map<string, Promise<Permission[]>>()
const channelCache = new Map<string, ChannelRow[]>()
const channelFlights = new Map<string, Promise<ChannelRow[]>>()
const channelPermissionCache = new Map<string, Permission[]>()
const channelPermissionFlights = new Map<string, Promise<Permission[]>>()

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

export function ChannelPermissions() {
  const navigate = useNavigate()
  const { cid } = useParams()
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
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [channelLoading, setChannelLoading] = useState(false)
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

  const loadChannels = useCallback(async () => {
    await ensureSelectedServer()

    const cachedData = channelCache.get(serverCacheKey)
    if (cachedData) return cachedData

    let flight = channelFlights.get(serverCacheKey)
    if (!flight) {
      flight = TeamSpeak.execute<ChannelRow[]>("channellist")
        .then((nextChannels) => {
          channelCache.set(serverCacheKey, nextChannels)
          return nextChannels
        })
        .finally(() => {
          channelFlights.delete(serverCacheKey)
        })

      channelFlights.set(serverCacheKey, flight)
    }

    return flight
  }, [ensureSelectedServer, serverCacheKey])

  const getChannelPermissions = useCallback(
    async (channelId: string | number) => {
      const key = serverCacheKey + ":" + String(channelId)
      const cachedPermissions = channelPermissionCache.get(key)
      if (cachedPermissions) return cachedPermissions

      let flight = channelPermissionFlights.get(key)
      if (!flight) {
        flight = ensureSelectedServer()
          .then(() =>
            TeamSpeak.execute<Permission[]>("channelpermlist", {
              cid: channelId,
            }),
          )
          .then((permissions) => {
            channelPermissionCache.set(key, permissions)
            return permissions
          })
          .finally(() => {
            channelPermissionFlights.delete(key)
          })

        channelPermissionFlights.set(key, flight)
      }

      return flight
    },
    [ensureSelectedServer, serverCacheKey],
  )

  const refreshChannelPermissions = useCallback(
    async (channelId: string | number) => {
      const key = serverCacheKey + ":" + String(channelId)
      channelPermissionCache.delete(key)
      channelPermissionFlights.delete(key)

      const permissions = await TeamSpeak.execute<Permission[]>(
        "channelpermlist",
        { cid: channelId },
      )

      channelPermissionCache.set(key, permissions)
      return permissions
    },
    [serverCacheKey],
  )

  useEffect(() => {
    let active = true

    setInitialLoading(availablePermissions.length === 0 || channels.length === 0)

    const availablePermissionsPromise = loadAvailablePermissions()
      .then((permissions) => {
        if (active) setAvailablePermissions(permissions)
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    const channelsPromise = loadChannels()
      .then((data) => {
        if (!active) return

        setChannels(data)

        if (!cid && data[0]) {
          void getChannelPermissions(data[0].cid).then((permissions) => {
            if (active) setGrantedPermissions(permissions)
          })
          navigate("/permissions/channel/" + String(data[0].cid), {
            replace: true,
          })
        }
      })
      .catch((error: unknown) => active && showError(getErrorMessage(error)))

    Promise.allSettled([availablePermissionsPromise, channelsPromise]).finally(
      () => active && setInitialLoading(false),
    )

    return () => {
      active = false
    }
  }, [
    availablePermissions.length,
    channels.length,
    cid,
    getChannelPermissions,
    loadAvailablePermissions,
    loadChannels,
    navigate,
    showError,
  ])

  useEffect(() => {
    if (!cid) return

    let active = true
    const key = serverCacheKey + ":" + String(cid)
    const cachedPermissions = channelPermissionCache.get(key)

    if (cachedPermissions) {
      setGrantedPermissions(cachedPermissions)
      setChannelLoading(false)
      return () => {
        active = false
      }
    }

    setChannelLoading(true)
    getChannelPermissions(cid)
      .then((permissions) => active && setGrantedPermissions(permissions))
      .catch((error: unknown) => active && showError(getErrorMessage(error)))
      .finally(() => active && setChannelLoading(false))

    return () => {
      active = false
    }
  }, [cid, getChannelPermissions, serverCacheKey, showError])

  const savePermission = async (
    permission: Permission,
    values: PermissionEditValues,
  ) => {
    if (!cid) return

    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channeladdperm", {
        cid,
        permid: permission.permid,
        permvalue: Number(values.permvalue),
      })
      setGrantedPermissions(await refreshChannelPermissions(cid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const removePermission = async (permission: Permission) => {
    if (!cid) return

    setSubmitting(true)
    try {
      await ensureSelectedServer()
      await TeamSpeak.execute("channeldelperm", {
        cid,
        permid: permission.permid,
      })
      setGrantedPermissions(await refreshChannelPermissions(cid))
    } catch (error) {
      showError(getErrorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const channelOptions = [
    ...(cid &&
    !channels.some((channel) => String(channel.cid) === String(cid))
      ? [{ label: "Channel " + cid, value: String(cid) }]
      : []),
    ...channels.map((channel) => ({
      label: channel.channelName,
      value: String(channel.cid),
    })),
  ]

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <PermissionPageFlow
        availablePermissions={availablePermissions}
        busy={
          channelLoading ||
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
            options: channelOptions,
            value: cid ?? "",
            onChange: (value) => navigate("/permissions/channel/" + value),
          },
        ]}
        submitting={submitting}
        title="Channel Permissions"
        onRemove={removePermission}
        onSave={savePermission}
      />
    </>
  )
}
