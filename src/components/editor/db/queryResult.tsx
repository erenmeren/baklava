import usePostgreSqlStore from "@/store/postgreSql"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table"

const ResultOfQuery = () => {
  const { queryResult } = usePostgreSqlStore()
  const renderCell = (cell: any) => {
    if (cell instanceof Date) {
      return cell.toLocaleString()
    }
    if (cell === null) {
      return <em>Null</em>
    }
    return cell.toString()
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
