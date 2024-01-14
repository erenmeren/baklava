import Link from "next/link"
import { Button } from "../../ui/button"
import { Icons } from "../../icons"
import HomeButton from "@/components/homeButton"

type Props = {
  runQuery: () => void
  formatQuery: () => void
}

const EditorNavbar: React.FC<Props> = ({ runQuery, formatQuery }) => {
  return (
    <nav className="flex h-16 w-full items-center justify-between border-b px-4">
      <HomeButton />
      <div>
        <Button size="icon" variant="secondary" onClick={runQuery}>
          <Icons.play />
        </Button>
        <Button size="icon" variant="secondary" onClick={formatQuery} className="ml-2">
          <Icons.text />
        </Button>
      </div>
    </nav>
  )
}

export default EditorNavbar
