import usePostgreSqlQueryStore from "@/store/postgreSql/queryStore"
import { Textarea } from "../../ui/textarea"

const QueryEditor = () => {
  const query = usePostgreSqlQueryStore((state) => state.query)
  const setQuery = usePostgreSqlQueryStore((state) => state.setQuery)

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
