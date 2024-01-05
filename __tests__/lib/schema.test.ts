import { PostgreSQLConnectionSchema } from "@/lib/schemas"
import { resolveSoa } from "dns"

describe("PostgreSQLConnectionSchema", () => {
  it("should validate valid connection data", () => {
    const validConnectionData = {
      id: 1,
      host: "localhost",
      port: 5432,
      database: "mydatabase",
      user: "username",
      password: "password",
    }

    const result = PostgreSQLConnectionSchema.safeParse(validConnectionData)

    expect(result.success).toBe(true)
  })

  it("should reject invalid connection data", () => {
    const invalidConnectionData = {
      host: "",
      port: -123, // invalid port number
      database: "",
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidConnectionData)

    expect(result.success).toBe(false)
  })

  it("should reject connection data with missing host", () => {
    const invalidData = {
      port: 5432,
      database: "mydatabase",
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.errors[0]?.message).toBe("Host is requreid")
  })

  it("should reject connection data with missing port", () => {
    const invalidData = {
      host: "localhost",
      database: "mydatabase",
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidData)

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.errors[0]?.message).toBe("Port is requreid")
  })

  it("should reject connection data with negative port number", () => {
    const invalidData = {
      host: "localhost",
      port: -123, // invalid port number
      database: "mydatabase",
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidData)
    expect(result.success).toBe(false)
    if (!result.success)
      expect(result.error?.errors[0]?.message).toBe("Port must be a positive number")
  })

  it("should reject connection data with string port", () => {
    const invalidData = {
      host: "localhost",
      port: "eren3000", // invalid port number
      database: "mydatabase",
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidData)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error?.errors[0]?.message).toBe("Port must be a number")
  })

  it("should reject connection data with missing database", () => {
    const invalidData = {
      host: "localhost",
      port: 5432,
    }

    const result = PostgreSQLConnectionSchema.safeParse(invalidData)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error?.errors[0]?.message).toBe("Database is requreid")
  })
})
