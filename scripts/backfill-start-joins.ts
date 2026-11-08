import { FieldPath } from 'firebase-admin/firestore'
import { closeDatabase, openDatabase } from '../src/db.ts'
import { groupRef, parseGroup, readGroup, readUsers, type GroupDoc } from '../src/store.ts'

// Groups started before ADR 0013 (docs/decisions) kept each member's real join date, so members who joined after a
// backdated start date cannot log the days before it. Lists those groups, or fixes one with --apply.

function lateMembers(group: GroupDoc): string[] {
  const startsOn = group.challenge?.phase === 'active' ? group.challenge.startsOn : null
  if (!startsOn) return []
  return Object.entries(group.members)
    .filter(([, member]) => member.leftOn === null && member.joinedOn > startsOn)
    .map(([userId]) => userId)
}

const applyIndex = process.argv.indexOf('--apply')
const target = applyIndex === -1 ? null : process.argv[applyIndex + 1]
if (applyIndex !== -1 && !target) throw new Error('usage: --apply <groupId>')
const db = openDatabase()
try {
  if (target) {
    const moved = await db.runTransaction(async (tx) => {
      const group = await readGroup(db, target, tx)
      if (!group?.challenge) throw new Error(`no started group ${target}`)
      const userIds = lateMembers(group)
      if (userIds.length === 0) return 0
      const fields = userIds.flatMap((id) => [new FieldPath('members', id, 'joinedOn'), group.challenge!.startsOn])
      tx.update(groupRef(db, target), fields[0] as FieldPath, fields[1], ...fields.slice(2))
      return userIds.length
    })
    console.log(`${target}: moved ${moved} member(s) to the start date`)
  } else {
    const snapshot = await db.collection('groups').get()
    let found = 0
    for (const doc of snapshot.docs) {
      const group = parseGroup(doc.data())
      const userIds = lateMembers(group)
      if (userIds.length === 0) continue
      found += 1
      const users = await readUsers(db, userIds)
      const who = userIds.map((id) => `${users.get(id)?.displayName ?? id} (joined ${group.members[id]!.joinedOn})`).join(', ')
      console.log(`${doc.id}  "${group.name}"  starts ${group.challenge!.startsOn}  ${who}`)
    }
    console.log(found === 0 ? 'No started group has a member who joined after its start date.' : `${found} group(s). Fix one with --apply <groupId>.`)
  }
} finally {
  await closeDatabase(db)
}
