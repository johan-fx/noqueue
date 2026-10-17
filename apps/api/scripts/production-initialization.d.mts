export function initialAdminStatements(input: {
  username: string; name: string; passwordHash: string; tables: string[]; id?: string; now?: string
}): { create: string; insert: string; drop: string; verify: string }
