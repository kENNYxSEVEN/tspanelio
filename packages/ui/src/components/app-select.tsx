import { ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type AppSelectOption = {
  label: string
  value: string
}

export type AppSelectGroup = {
  label: string
  options: AppSelectOption[]
}

export function AppSelect({
  className,
  contentClassName,
  disabled,
  groups,
  onChange,
  options = [],
  placeholder = "Select",
  value,
}: {
  className?: string
  contentClassName?: string
  disabled?: boolean
  groups?: AppSelectGroup[]
  onChange: (value: string) => void
  options?: AppSelectOption[]
  placeholder?: string
  value: string
}) {
  const allOptions = groups
    ? groups.flatMap((group) => group.options)
    : options
  const selectedOption = allOptions.find((option) => option.value === value)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className={cn(
            "h-9 min-h-9 w-full justify-between px-3 text-left font-normal",
            className,
          )}
          disabled={disabled}
          type="button"
          variant="outline"
        >
          <span className="truncate">
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn(
          "max-h-80 min-w-[var(--radix-dropdown-menu-trigger-width)]",
          contentClassName,
        )}
      >
        <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
          {groups
            ? groups.map((group, groupIndex) => (
                <div key={group.label}>
                  {groupIndex > 0 ? <DropdownMenuSeparator /> : null}
                  <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                  {group.options.map((option) => (
                    <DropdownMenuRadioItem
                      className="cursor-pointer py-1.5 pr-8 pl-2"
                      key={option.value}
                      value={option.value}
                    >
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </div>
              ))
            : options.map((option) => (
                <DropdownMenuRadioItem
                  className="cursor-pointer py-1.5 pr-8 pl-2"
                  key={option.value}
                  value={option.value}
                >
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
