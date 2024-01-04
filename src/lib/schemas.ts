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
    .positive(),
  database: z.string().min(1, "Database is requreid"),
  user: z.string().optional(),
  password: z.string().optional(),
})

export type PostgreSQLConnection = z.infer<typeof PostgreSQLConnectionSchema>

export type OperationResult = {
  isSuccessful: boolean
  message: string
}
