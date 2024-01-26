import usePostgreSqlStore from "@/store/postgreSql"
import { Textarea } from "../../ui/textarea"

const QueryEditor = () => {
  const { query, setQuery } = usePostgreSqlStore()

  return (
    // <div className="query-editor">
    <Textarea
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="select * from users"
      className="min-h-full w-full resize-none rounded-none font-semibold"
    />
    //    <div className="highlight-container">
    //     <CodeHighlighter language="sql">{query}</CodeHighlighter>
    //   </div>
    // </div>
  )
}

export default QueryEditor
