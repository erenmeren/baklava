import { Textarea } from "../../ui/textarea"

type Props = {
  query: string
  setQuery: (query: string) => void
}

const QueryEditor: React.FC<Props> = ({ query, setQuery }) => {
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
