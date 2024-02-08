import { Button } from "../../ui/button"
import { Icons } from "../../icons"
import HomeButton from "@/components/homeButton"
import { trpc } from "@/utils/trpc"
import usePostgreSqlConnectionStore from "@/store/postgreSql/connectionStore"
import usePostgreSqlQueryStore from "@/store/postgreSql/queryStore"
import { toast } from "sonner"
import { format } from "sql-formatter"
import CommandBar from "./commandBar"
import { useEffect, useState } from "react"

type Props = {
  databaseManagementSystem: "postgresql" | "mysql"
}

const EditorNavbar: React.FC<Props> = ({ databaseManagementSystem }) => {
  const [openCommand, setOpenCommand] = useState(false)
  const { query, setQuery, setQueryResult } = usePostgreSqlQueryStore()
  const { connectionId } = usePostgreSqlConnectionStore()

  const { mutate } = trpc.postgresql.runQuery.useMutation({
    onSuccess: (result) => {
      setQueryResult(result)
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const runQuery = () => {
    if (!connectionId) {
      toast.error("Query is empty!")
      return
    }
    if (query === "") {
      toast.error("Sorgu boş!")
      return
    }

    mutate({ connectionId, query })
  }

  const formatQuery = () =>
    setQuery(
      format(query, {
        language: databaseManagementSystem,
        tabWidth: 2,
        keywordCase: "upper",
        linesBetweenQueries: 2,
      })
    )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpenCommand((open) => !open)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault()
        runQuery()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault()
        formatQuery()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [runQuery, formatQuery])

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
      <CommandBar openCommand={openCommand} setOpenCommand={setOpenCommand} />
    </nav>
  )
}

export default EditorNavbar
