import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { Icons } from "../../icons"

type Props = {
  openCommand: boolean
  setOpenCommand: (openCommand: boolean) => void
}

const CommandBar: React.FC<Props> = ({ openCommand, setOpenCommand }) => {
  return (
    <CommandDialog open={openCommand} onOpenChange={setOpenCommand}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandItem>
          <Icons.play className="mr-2 h-4 w-4" />
          <span>Run</span>
          <CommandShortcut>⌘R</CommandShortcut>
        </CommandItem>
        <CommandItem>
          <Icons.text className="mr-2 h-4 w-4" />
          <span>Format</span>
          <CommandShortcut>⌘F</CommandShortcut>
        </CommandItem>
      </CommandList>
    </CommandDialog>
  )
}

export default CommandBar
