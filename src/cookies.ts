import { timingSafeEqual } from 'node:crypto'

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const key = part.slice(0, eq).trim()
    if (key !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return null
}

export function writeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

export function clearCookie(name: string): string {
  return writeCookie(name, '', 0)
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
