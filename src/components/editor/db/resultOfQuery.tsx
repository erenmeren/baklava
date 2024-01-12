import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table"
import { QueryResult } from "@/lib/types"

type Props = {
  queryResult: QueryResult | undefined
}

const ResultOfQuery: React.FC<Props> = ({ queryResult }) => {
  return (
    queryResult && (
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary">
            {queryResult.fields.map((field, index) => (
              <TableHead key={index}>{field}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {queryResult.rows.map((row, index) => (
            <TableRow key={index}>
              {row.map((column, idx) => (
                <TableCell key={idx}>{column}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  )
}

export default ResultOfQuery
