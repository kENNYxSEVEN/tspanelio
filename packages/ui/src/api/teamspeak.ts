import { socket } from "@/api/socket"
import { startLoading, stopLoading } from "@/lib/loading-progress"

type TeamSpeakConnectParams = {
  host: string
  queryport: number
  protocol: "ssh" | "raw"
  username: string
  password: string
}

type AutofillResponse = {
  host?: string
  queryport?: number
  protocol?: "ssh" | "raw"
  username?: string
  password?: string
  message?: string
}

type QueryUser = {
  virtualserverId?: string | number
  [key: string]: unknown
}

type SnapshotDeployPayload = Blob | string

type SnapshotCreateResponse = Array<{
  data?: string
  [key: string]: unknown
}>

type TeamSpeakError = {
  id?: string | number
  message?: string
  connected?: boolean
}

type ExecuteOptions = Record<string, unknown> | Array<unknown>
type ProgressMode = "foreground" | "background" | "none"

type RequestOptions = {
  progress?: ProgressMode
}

type TeamSpeakEventName =
  | "textmessage"
  | "clientconnect"
  | "clientdisconnect"
  | "clientmoved"
  | "tokenused"
  | "serveredit"
  | "channeledit"
  | "channelcreate"
  | "channelmoved"
  | "channeldelete"

const teamSpeakEvents = new EventTarget()
let connectFlight: Promise<{ token: string }> | null = null
const autofillFlights = new Map<string, Promise<AutofillResponse>>()
let activeServerId: string | undefined
let activeServerQueryUser: QueryUser | undefined
let connectionBootstrapped = false
let connectionBootstrapFlight: Promise<unknown> | null = null
let queryIdentityFlight: Promise<QueryUser | undefined> | null = null
const useServerFlights = new Map<string, Promise<void>>()
const selectServerFlights = new Map<string, Promise<QueryUser | undefined>>()
const registerEventsFlights = new Map<string, Promise<unknown>>()
const registeredEventServerIds = new Set<string>()

const socketEventMap: Record<string, TeamSpeakEventName> = {
  "teamspeak-textmessage": "textmessage",
  "teamspeak-clientconnect": "clientconnect",
  "teamspeak-clientdisconnect": "clientdisconnect",
  "teamspeak-clientmoved": "clientmoved",
  "teamspeak-tokenused": "tokenused",
  "teamspeak-serveredit": "serveredit",
  "teamspeak-channeledit": "channeledit",
  "teamspeak-channelcreate": "channelcreate",
  "teamspeak-channelmoved": "channelmoved",
  "teamspeak-channeldelete": "channeldelete",
}

function withProgress<T>(
  task: () => Promise<T>,
  progress: ProgressMode = "foreground",
) {
  if (progress !== "foreground") {
    return task()
  }

  startLoading()

  return task().finally(() => {
    stopLoading()
  })
}

for (const [socketEvent, teamSpeakEvent] of Object.entries(socketEventMap)) {
  socket.on(socketEvent, (data: unknown) => {
    teamSpeakEvents.dispatchEvent(
      new CustomEvent(teamSpeakEvent, { detail: data }),
    )
  })
}

function ensureSocketConnected() {
  if (!socket.connected) {
    socket.connect()
  }
}

function resetTeamSpeakSessionState() {
  activeServerId = undefined
  activeServerQueryUser = undefined
  connectionBootstrapped = false
  connectionBootstrapFlight = null
  queryIdentityFlight = null
  useServerFlights.clear()
  selectServerFlights.clear()
  registerEventsFlights.clear()
  registeredEventServerIds.clear()
}

socket.on("disconnect", resetTeamSpeakSessionState)
socket.on("connect_error", resetTeamSpeakSessionState)
socket.on("teamspeak-disconnect", resetTeamSpeakSessionState)

function isErrorResponse(response: TeamSpeakError) {
  return (
    (response.id !== undefined && response.id !== 0 && response.id !== "0") ||
    (response.id === undefined && Boolean(response.message))
  )
}

function handleResponse<T>(
  response: T | TeamSpeakError,
  resolve: (value: T | []) => void,
  reject: (reason?: unknown) => void,
) {
  const maybeError = response as TeamSpeakError

  if (isErrorResponse(maybeError)) {
    if (String(maybeError.id) === "1281") {
      resolve([])
      return
    }

    reject(response)
    return
  }

  resolve(response as T)
}

export const TeamSpeak = {
  connect(params: TeamSpeakConnectParams, requestOptions: RequestOptions = {}) {
    ensureSocketConnected()

    if (!connectFlight) {
      connectFlight = new Promise<{ token: string }>((resolve, reject) => {
          socket.emit(
            "teamspeak-connect",
            params,
            (response: { token?: string }) => {
              if (response.token) {
                resolve({ token: response.token })
                return
              }

              reject(response)
            },
          )
        }).finally(() => {
          connectFlight = null
          resetTeamSpeakSessionState()
        })
    }

    return withProgress(() => connectFlight as Promise<{ token: string }>, requestOptions.progress)
  },

  autofillForm(token: string, requestOptions: RequestOptions = {}) {
    ensureSocketConnected()

    let flight = autofillFlights.get(token)

    if (!flight) {
      flight = new Promise<AutofillResponse>((resolve, reject) => {
          socket.emit("autofillform", token, (response: AutofillResponse) => {
            if (response.host) {
              resolve(response)
              return
            }

            reject(response)
          })
        }).finally(() => {
          autofillFlights.delete(token)
        })

      autofillFlights.set(token, flight)
    }

    return withProgress(() => flight, requestOptions.progress)
  },

  execute<T = unknown[]>(
    command: string,
    params: Record<string, unknown> = {},
    options: ExecuteOptions = [],
    requestOptions: RequestOptions = {},
  ) {
    ensureSocketConnected()

    return withProgress(
      () =>
        new Promise<T | []>((resolve, reject) => {
          socket.emit(
            "teamspeak-execute",
            {
              command,
              params,
              options,
            },
            (response: T | TeamSpeakError) =>
              handleResponse<T>(response, resolve, reject),
          )
        }),
      requestOptions.progress,
    )
  },

  createSnapshot(requestOptions: RequestOptions = {}) {
    ensureSocketConnected()

    return withProgress(
      () =>
        new Promise<SnapshotCreateResponse | []>((resolve, reject) => {
          socket.emit(
            "teamspeak-createsnapshot",
            (response: SnapshotCreateResponse | TeamSpeakError) =>
              handleResponse<SnapshotCreateResponse>(response, resolve, reject),
          )
        }),
      requestOptions.progress,
    )
  },

  deploySnapshot(snapshot: SnapshotDeployPayload, requestOptions: RequestOptions = {}) {
    ensureSocketConnected()

    return withProgress(
      () =>
        new Promise<unknown>((resolve, reject) => {
          socket.emit(
            "teamspeak-deploysnapshot",
            snapshot,
            (response: unknown | TeamSpeakError) =>
              handleResponse<unknown>(response, resolve, reject),
          )
        }),
      requestOptions.progress,
    )
  },

  registerEvents(
    requestOptions: RequestOptions = {},
    serverId: string | number | undefined = activeServerId,
  ) {
    ensureSocketConnected()
    const key = serverId === undefined ? "__instance__" : String(serverId)

    if (registeredEventServerIds.has(key)) {
      return Promise.resolve(undefined)
    }

    const existingFlight = registerEventsFlights.get(key)

    if (existingFlight) {
      return withProgress(() => existingFlight, requestOptions.progress)
    }

    const flight = new Promise<unknown>((resolve, reject) => {
          socket.emit(
            "teamspeak-registerevents",
            (response: TeamSpeakError | unknown) =>
              handleResponse(response, resolve, reject),
          )
        })
      .then((response) => {
        registeredEventServerIds.add(key)
        return response
      })
      .finally(() => {
        registerEventsFlights.delete(key)
      })

    registerEventsFlights.set(key, flight)

    return withProgress(() => flight, requestOptions.progress)
  },

  bootstrapConnection(requestOptions: RequestOptions = {}) {
    ensureSocketConnected()

    if (connectionBootstrapped) {
      return Promise.resolve(undefined)
    }

    if (!connectionBootstrapFlight) {
      connectionBootstrapFlight = Promise.allSettled([
        TeamSpeak.execute<QueryUser[]>("whoami", {}, [], { progress: "none" })
          .then((userInfo) => {
            if (userInfo[0]) {
              activeServerQueryUser = userInfo[0]
            }

            return userInfo
          }),
        TeamSpeak.execute("version", {}, [], { progress: "none" }),
      ])
        .then((response) => {
          connectionBootstrapped = true
          return response
        })
        .finally(() => {
          connectionBootstrapFlight = null
        })
    }

    const flight = connectionBootstrapFlight

    return withProgress(() => flight, requestOptions.progress)
  },

  async useServer(sid: string | number, requestOptions: RequestOptions = {}) {
    const key = String(sid)

    if (activeServerId === key) {
      return Promise.resolve()
    }

    const existingFlight = useServerFlights.get(key)

    if (existingFlight) {
      return withProgress(() => existingFlight, requestOptions.progress)
    }

    const flight = TeamSpeak.execute("use", { sid }, [], { progress: "none" })
      .then(() => {
        if (activeServerId !== key) {
          activeServerQueryUser = undefined
          queryIdentityFlight = null
          registerEventsFlights.clear()
          registeredEventServerIds.clear()
        }

        activeServerId = key
        void TeamSpeak.registerEvents({ progress: "none" }, key).catch(
          () => undefined,
        )
      })
      .finally(() => {
        useServerFlights.delete(key)
      })

    useServerFlights.set(key, flight)

    return withProgress(() => flight, requestOptions.progress)
  },

  ensureQueryIdentity(requestOptions: RequestOptions = {}) {
    if (activeServerQueryUser) {
      return Promise.resolve(activeServerQueryUser)
    }

    if (queryIdentityFlight) {
      const flight = queryIdentityFlight

      return withProgress(() => flight, requestOptions.progress)
    }

    queryIdentityFlight = TeamSpeak.execute<QueryUser[]>(
      "whoami",
      {},
      [],
      { progress: "none" },
    )
      .then((userInfo) => {
        activeServerQueryUser = userInfo[0]
        return activeServerQueryUser
      })
      .finally(() => {
        queryIdentityFlight = null
      })

    const flight = queryIdentityFlight

    return withProgress(() => flight, requestOptions.progress)
  },

  async selectServer(sid: string | number, requestOptions: RequestOptions = {}) {
    const key = String(sid)

    if (activeServerId === key && activeServerQueryUser) {
      return activeServerQueryUser
    }

    const existingFlight = selectServerFlights.get(key)

    if (existingFlight) {
      return withProgress(() => existingFlight, requestOptions.progress)
    }

    const flight = (async () => {
      await TeamSpeak.useServer(sid, { progress: "none" })
      return TeamSpeak.ensureQueryIdentity({ progress: "none" })
    })().finally(() => {
      selectServerFlights.delete(key)
    })

    selectServerFlights.set(key, flight)

    return withProgress(() => flight, requestOptions.progress)
  },

  on(name: TeamSpeakEventName, listener: EventListener) {
    teamSpeakEvents.addEventListener(name, listener)
  },

  off(name: TeamSpeakEventName, listener: EventListener) {
    teamSpeakEvents.removeEventListener(name, listener)
  },
}
