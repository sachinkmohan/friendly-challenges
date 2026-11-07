export function sqlStatements(source: string): string[] {
  const statements: string[] = []
  let current = ''
  let index = 0
  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index)
      index = newline === -1 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2)
      index = end === -1 ? source.length : end + 2
      continue
    }
    const dollar = /^\$[A-Za-z0-9_]*\$/.exec(source.slice(index))
    if (dollar) {
      const tag = dollar[0]
      const close = source.indexOf(tag, index + tag.length)
      const end = close === -1 ? source.length : close + tag.length
      current += source.slice(index, end)
      index = end
      continue
    }
    if (source[index] === "'") {
      let cursor = index + 1
      while (cursor < source.length) {
        if (source[cursor] === "'" && source[cursor + 1] === "'") {
          cursor += 2
          continue
        }
        if (source[cursor] === "'") {
          cursor += 1
          break
        }
        cursor += 1
      }
      current += source.slice(index, cursor)
      index = cursor
      continue
    }
    if (source[index] === ';') {
      const statement = current.trim()
      if (statement !== '') statements.push(statement)
      current = ''
      index += 1
      continue
    }
    current += source[index]
    index += 1
  }
  const tail = current.trim()
  if (tail !== '') statements.push(tail)
  return statements
}
