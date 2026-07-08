type LoadingSnapshot = {
  active: boolean
  progress: number
}

const COMPLETE_HIDE_MS = 90

let pendingRequests = 0
let snapshot: LoadingSnapshot = {
  active: false,
  progress: 0,
}
let hideTimer: number | undefined
let settleTimer: number | undefined
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) {
    listener()
  }
}

function setSnapshot(nextSnapshot: LoadingSnapshot) {
  snapshot = nextSnapshot
  emit()
}

function clearTimer(timer: number | undefined) {
  if (timer !== undefined) {
    window.clearTimeout(timer)
  }
}

export function startLoading() {
  pendingRequests += 1
  clearTimer(hideTimer)
  clearTimer(settleTimer)

  if (pendingRequests === 1) {
    setSnapshot({ active: true, progress: 24 })

    settleTimer = window.setTimeout(() => {
      if (pendingRequests > 0) {
        setSnapshot({ active: true, progress: 86 })
      }
    }, 70)
    return
  }

  setSnapshot({
    active: true,
    progress: Math.max(snapshot.progress, Math.min(94, snapshot.progress + 4)),
  })
}

export function stopLoading() {
  pendingRequests = Math.max(0, pendingRequests - 1)

  if (pendingRequests > 0) {
    setSnapshot({
      active: true,
      progress: Math.max(snapshot.progress, Math.min(96, snapshot.progress + 3)),
    })
    return
  }

  clearTimer(hideTimer)
  clearTimer(settleTimer)

  hideTimer = window.setTimeout(() => {
    setSnapshot({ active: true, progress: Math.max(snapshot.progress, 100) })

    hideTimer = window.setTimeout(() => {
      if (pendingRequests === 0) {
        setSnapshot({ active: false, progress: 0 })
      }
    }, COMPLETE_HIDE_MS)
  }, 0)
}

export function subscribeLoading(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

export function getLoadingSnapshot() {
  return snapshot
}
