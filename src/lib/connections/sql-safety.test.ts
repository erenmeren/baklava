import { describe, it, expect } from "vitest";
import {
  quoteIdent as pgQuoteIdent,
  validateIdentifier as pgValidateIdentifier,
  requireNoStatementTerminator as pgRejectTerm,
} from "./postgres";
import {
  SQLSERVER_DB_NAME_RE,
  validateSqlServerDatabaseName,
} from "./sqlserver";

/**
 * The core hostile-identifier corpus — strings that contain SQL-dangerous
 * characters (quotes, comments, semicolons, brackets) and MUST be rejected
 * by every validator across every dialect, after each dialect's own
 * normalization (e.g. trim).
 */
const UNIVERSAL_HOSTILE: { input: string; description: string }[] = [
  { input: "", description: "empty string" },
  { input: " ", description: "single space" },
  { input: "  \t\n", description: "whitespace only" },
  { input: "-users", description: "starts with hyphen" },
  { input: "$users", description: "starts with dollar" },
  { input: "users-table", description: "contains hyphen" },
  { input: "users table", description: "internal space" },
  { input: "users.table", description: "contains dot" },
  { input: "users;DROP TABLE x", description: "classic SQL injection" },
  { input: "users; DROP TABLE x; --", description: "comment-tail SQLi" },
  { input: 'users"; DROP TABLE x; --', description: "quote-escape SQLi" },
  { input: "users'", description: "trailing single quote" },
  { input: 'users"', description: "trailing double quote" },
  { input: "users`", description: "trailing backtick" },
  { input: "users\\", description: "trailing backslash" },
  { input: "users\\0", description: "embedded literal backslash-zero" },
  { input: "users\x00", description: "embedded NUL" },
  { input: "users--admin", description: "embedded SQL comment marker" },
  { input: "users/*x*/", description: "embedded C-style comment" },
  { input: "kullanıcılar", description: "non-ASCII letters" },
  { input: "用户", description: "CJK characters" },
  { input: "users‮evil", description: "RTL override unicode" },
  { input: "users​", description: "zero-width space" },
];

/**
 * Strings that pg/sqlite normalize away via .trim() and then accept as
 * the trimmed form. Hostile-looking on the wire but safe after normalization.
 * ClickHouse + SQL Server do NOT trim, so they must reject these.
 */
const TRIM_NORMALIZED: { input: string; trimmedTo: string }[] = [
  { input: "users\n", trimmedTo: "users" },
  { input: "users\r", trimmedTo: "users" },
  { input: "  users  ", trimmedTo: "users" },
];

const HAPPY_IDENTIFIERS = [
  "users",
  "u",
  "_private",
  "_",
  "_users_table_v2",
  "User",
  "USERS",
  "table_1",
  "snake_case_name",
  "A1B2",
];

// ─────────────────────────────────────────────────────────────────────────────
// Postgres
// ─────────────────────────────────────────────────────────────────────────────
describe("postgres SQL safety", () => {
  describe("quoteIdent", () => {
    it("wraps a plain identifier in double quotes", () => {
      expect(pgQuoteIdent("users")).toBe('"users"');
    });

    it("doubles embedded double quotes", () => {
      expect(pgQuoteIdent('weird"name')).toBe('"weird""name"');
    });

    it("doubles ALL embedded double quotes, not just the first", () => {
      expect(pgQuoteIdent('a"b"c')).toBe('"a""b""c"');
    });

    it("preserves a doubled-up sequence safely (round trip survives)", () => {
      const out = pgQuoteIdent('""');
      expect(out).toBe('""""""');
    });

    it("does NOT mutate single quotes (those are value-level)", () => {
      expect(pgQuoteIdent("a'b")).toBe(`"a'b"`);
    });

    it("does NOT mutate backslashes (postgres ident quoting is literal)", () => {
      expect(pgQuoteIdent("a\\b")).toBe('"a\\b"');
    });

    it("handles unicode untouched (postgres supports unicode idents in quotes)", () => {
      expect(pgQuoteIdent("用户")).toBe('"用户"');
    });

    it("never returns an unquoted result for any input", () => {
      for (const id of [...HAPPY_IDENTIFIERS, "weird name", '"'.repeat(5)]) {
        const out = pgQuoteIdent(id);
        expect(out.startsWith('"')).toBe(true);
        expect(out.endsWith('"')).toBe(true);
      }
    });
  });

  describe("validateIdentifier", () => {
    it.each(HAPPY_IDENTIFIERS)("accepts %j", (id) => {
      expect(pgValidateIdentifier(id, "Test")).toBe(id);
    });

    it("rejects identifiers starting with a digit", () => {
      expect(() => pgValidateIdentifier("1users", "Test")).toThrow();
    });

    it("trims surrounding whitespace before validating, then returns the trimmed form", () => {
      for (const { input, trimmedTo } of TRIM_NORMALIZED) {
        expect(pgValidateIdentifier(input, "Test")).toBe(trimmedTo);
      }
    });

    it("does NOT impose a length limit (SQL itself doesn't here)", () => {
      const long = "u".repeat(1_000);
      expect(pgValidateIdentifier(long, "Test")).toBe(long);
    });

    it("uses the provided kind in the error message", () => {
      expect(() => pgValidateIdentifier("", "Sequence")).toThrow(/Sequence/);
      expect(() => pgValidateIdentifier("1bad", "Index")).toThrow(/Index/);
    });

    it.each(UNIVERSAL_HOSTILE)("rejects $description", ({ input }) => {
      expect(() => pgValidateIdentifier(input, "Test")).toThrow();
    });
  });

  describe("requireNoStatementTerminator", () => {
    it("returns the value unchanged when no semicolon is present", () => {
      expect(pgRejectTerm("integer NOT NULL", "Column type")).toBe(
        "integer NOT NULL",
      );
    });

    it("allows expressions, spaces, and parens", () => {
      expect(pgRejectTerm("numeric(10, 2) DEFAULT 0", "Default")).toBe(
        "numeric(10, 2) DEFAULT 0",
      );
    });

    it("rejects a bare semicolon", () => {
      expect(() => pgRejectTerm(";", "x")).toThrow(/cannot contain ';'/);
    });

    it("rejects a semicolon anywhere in the string", () => {
      expect(() =>
        pgRejectTerm("text; DROP TABLE users", "Column type"),
      ).toThrow(/cannot contain/);
      expect(() => pgRejectTerm("a;b", "x")).toThrow();
      expect(() => pgRejectTerm("trailing;", "x")).toThrow();
      expect(() => pgRejectTerm(";leading", "x")).toThrow();
    });

    it("rejects a semicolon even inside what looks like quotes (we don't parse)", () => {
      // Intentional: this is a bluntly pessimistic guard. It does NOT
      // try to understand that ';' inside a quoted string literal is
      // safe in the underlying SQL — it rejects it anyway. That's the
      // correct safety posture for a fragment that will be spliced as-is.
      expect(() => pgRejectTerm("'safe;value'", "x")).toThrow();
    });

    it("uses the provided fieldName in the error", () => {
      expect(() => pgRejectTerm("a;b", "WHERE clause")).toThrow(/WHERE clause/);
    });

    it("permits unicode and non-ascii (they're not statement separators)", () => {
      expect(pgRejectTerm('text COLLATE "tr-TR"', "x")).toMatch(/COLLATE/);
      expect(pgRejectTerm("varchar(50) DEFAULT '日本語'", "x")).toMatch(
        /日本語/,
      );
    });

    it("permits newlines (multi-line DEFAULT expressions are fine)", () => {
      expect(pgRejectTerm("CASE WHEN x THEN 1\nELSE 2 END", "Default")).toMatch(
        /CASE/,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SQL Server
// ─────────────────────────────────────────────────────────────────────────────
describe("sqlserver SQL safety", () => {
  describe("SQLSERVER_DB_NAME_RE", () => {
    it("is more permissive at the start (digit-leading allowed inside [] quoting)", () => {
      expect(SQLSERVER_DB_NAME_RE.test("123db")).toBe(true);
      expect(SQLSERVER_DB_NAME_RE.test("_db")).toBe(true);
      expect(SQLSERVER_DB_NAME_RE.test("db_1")).toBe(true);
    });

    it("rejects every character that could escape the [] quoting", () => {
      const dangerous = [
        "[",
        "]",
        "'",
        '"',
        "`",
        " ",
        "-",
        ";",
        ".",
        "/",
        "\\",
        "\n",
        "\r",
      ];
      for (const ch of dangerous) {
        expect(SQLSERVER_DB_NAME_RE.test(`db${ch}x`)).toBe(false);
      }
    });
  });

  describe("validateSqlServerDatabaseName", () => {
    it("returns the name unchanged on success", () => {
      expect(validateSqlServerDatabaseName("master")).toBe("master");
      expect(validateSqlServerDatabaseName("Customers_2024")).toBe(
        "Customers_2024",
      );
      // SQL Server contract: digit-leading is allowed.
      expect(validateSqlServerDatabaseName("123db")).toBe("123db");
    });

    it.each(UNIVERSAL_HOSTILE)("rejects $description", ({ input }) => {
      expect(() => validateSqlServerDatabaseName(input)).toThrow();
    });

    it.each(TRIM_NORMALIZED)(
      "rejects $input (no normalization — surrounding/embedded whitespace is hostile)",
      ({ input }) => {
        expect(() => validateSqlServerDatabaseName(input)).toThrow();
      },
    );

    it("uses a stable error message (clients can match it)", () => {
      expect(() => validateSqlServerDatabaseName("a;b")).toThrow(
        /Invalid database name/,
      );
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-dialect matrix — every classic injection payload must be rejected
// by every validator. (Payloads with only alphanumerics are excluded
// because SQL Server's looser alphabet legitimately accepts them inside
// [] quoting; they cannot escape that context.)
// ─────────────────────────────────────────────────────────────────────────────
describe("cross-dialect SQLi resistance matrix", () => {
  const VALIDATORS = [
    {
      name: "postgres.validateIdentifier",
      fn: (s: string) => pgValidateIdentifier(s, "Test"),
    },
    {
      name: "sqlserver.validateSqlServerDatabaseName",
      fn: (s: string) => validateSqlServerDatabaseName(s),
    },
  ];

  const PAYLOADS = [
    "' OR 1=1 --",
    '" OR 1=1 --',
    "; DROP TABLE users; --",
    "users` SET pwd='hacked' WHERE 1=1; --",
    "UNION SELECT password FROM admins",
    "../../etc/passwd",
    "\\x00",
    "name]; DROP TABLE x; --",
    "x' UNION SELECT NULL--",
  ];

  for (const { name, fn } of VALIDATORS) {
    describe(name, () => {
      it.each(PAYLOADS)("rejects payload: %j", (payload) => {
        expect(() => fn(payload)).toThrow();
      });
    });
  }
});
