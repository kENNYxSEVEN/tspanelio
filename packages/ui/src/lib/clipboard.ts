export async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall back for mobile browsers on insecure LAN origins.
    }
  }

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  const selection = document.getSelection()
  const selectedRanges =
    selection && selection.rangeCount > 0
      ? Array.from({ length: selection.rangeCount }, (_, index) =>
          selection.getRangeAt(index).cloneRange(),
        )
      : []

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  textarea.style.opacity = "0"

  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  let copied = false

  try {
    copied = document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)

    if (selection) {
      selection.removeAllRanges()
      selectedRanges.forEach((range) => selection.addRange(range))
    }

    activeElement?.focus()
  }

  if (!copied) {
    throw new Error("Could not copy to clipboard.")
  }
}
