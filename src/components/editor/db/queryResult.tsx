import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table"
import { QueryResult } from "@/lib/types"

type Props = {
  queryResult: QueryResult | undefined
}

const ResultOfQuery: React.FC<Props> = ({ queryResult }) => {
  const renderCell = (cell: any) => {
    if (cell instanceof Date) {
      return cell.toLocaleString() // Veya başka bir format kullanabilirsiniz
    }
    if (cell === null) {
      return <em>Null</em> // Null değerler için özel bir görünüm
    }
    return cell.toString() // Diğer tüm değerleri string olarak render edin
  }
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
                <TableCell key={idx}>{renderCell(column)}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  )
}

export default ResultOfQuery
