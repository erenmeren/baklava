import usePostgreSqlStore from "@/store/postgreSql"
import { Textarea } from "../../ui/textarea"

const QueryEditor = () => {
  const { query, setQuery } = usePostgreSqlStore()

  return (
    <Textarea
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="select * from users"
      className="min-h-full w-full resize-none rounded-none font-semibold"
    />
  )
}

export default QueryEditor
