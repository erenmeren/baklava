import usePostgreSqlStore from "@/store/postgreSqlStore"
import { Textarea } from "../../ui/textarea"

const QueryEditor = () => {
  const query = usePostgreSqlStore((state) => state.query)
  const setQuery = usePostgreSqlStore((state) => state.setQuery)

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
