// true if the error comes from PostgreSQL with this SQLSTATE code (23505, 40P01, ...)
export function hasPgCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code
}
