import * as z from "zod"

export const PostgreSQLFormSchema = z.object({
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

export type PostgreSQLForm = z.infer<typeof PostgreSQLFormSchema>

export type OperationResult = {
  isSuccessful: boolean
  message: string
}
