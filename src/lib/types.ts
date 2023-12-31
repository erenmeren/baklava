import * as z from "zod"

export const PostgreSQLConnectionSchema = z.object({
  id: z.number().optional(),
  host: z
    .string({
      required_error: "Host is requreid",
    })
    .min(1, "Host is requreid"),
  port: z
    .number({
      required_error: "Port is requreid",
      invalid_type_error: "Port must be a number",
    })
    .positive("Port must be a positive number"),
  database: z.string({ required_error: "Database is requreid" }).min(1, "Database is requreid"),
  user: z.string().optional(),
  password: z.string().optional(),
})

export type PostgreSQLConnection = z.infer<typeof PostgreSQLConnectionSchema>

//
export type OperationResult<T = unknown> = {
  isSuccessful: boolean
  message?: string
  data?: T
}

//
export type DatabaseSchema = {
  name: string
  tables?: Table[]
}

export type Table = {
  schema: string
  name: string
  type: string
  columns: Column[]
}

export type Column = {
  schema: string
  table: string
  name: string
  position: number
  defaultValue: string
  isNullable: string
  udtName: string
  characterMaximumLength: number
  numericPrecision: number
  datetimePrecision: number
}

export type QueryResult = { fields: string[]; rows: Row[] }

type Row = [number, string, string, null | any]

//
type ApplicationItem = {
  name: string
  link: string
  icon: JSX.Element
}

type ApplicationCategory = {
  name: string
  items: ApplicationItem[]
}

export type Applications = ApplicationCategory[]
