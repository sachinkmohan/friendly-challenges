import { Timestamp, type DocumentReference } from 'firebase-admin/firestore'
import type { Database } from './db.ts'
import { checkInRef, groupRef, paymentData, paymentRef, userRef, type CheckInDoc, type GroupDoc, type PaymentDoc } from './store.ts'

// Expected open debt as of 2026-10-08, in minor units: 160
export const SAMPLE_OPEN_DEBT_MINOR = 160

const ADA = '11111111-1111-4111-8111-111111111111'
const BEA = '22222222-2222-4222-8222-222222222222'
const CAM = '33333333-3333-4333-8333-333333333333'
export const SAMPLE_GROUP_ID = '44444444-4444-4444-8444-444444444444'
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555'

const people = [
  { id: ADA, sub: 'sample-ada', name: 'Ada' },
  { id: BEA, sub: 'sample-bea', name: 'Bea' },
  { id: CAM, sub: 'sample-cam', name: 'Cam' },
]

const pantry: GroupDoc = {
  name: 'Pantry',
  createdBy: ADA,
  memberIds: [ADA, BEA, CAM],
  members: {
    [ADA]: { joinedOn: '2026-10-01', leftOn: null },
    [BEA]: { joinedOn: '2026-10-01', leftOn: null },
    [CAM]: { joinedOn: '2026-10-01', leftOn: null },
  },
  challenge: {
    name: 'No sugar',
    typeKind: 'no_sugar',
    customLabel: null,
    currency: 'USD',
    stakeMinor: 100,
    startsOn: '2026-10-01',
    endsOn: '2026-10-07',
    phase: 'active',
    cause: null,
    joinsFromStart: true,
  },
  rhythms: {
    [ADA]: { kind: 'every_day' },
    [BEA]: { kind: 'every_2_days' },
    [CAM]: { kind: 'every_3_days' },
  },
}

const checkIns: CheckInDoc[] = [
  { userId: ADA, day: '2026-10-01', color: 'green' },
  { userId: ADA, day: '2026-10-02', color: 'red' },
  { userId: ADA, day: '2026-10-03', color: 'green' },
  { userId: ADA, day: '2026-10-04', color: 'green' },
  { userId: ADA, day: '2026-10-05', color: 'green' },
  { userId: ADA, day: '2026-10-06', color: 'green' },
  { userId: ADA, day: '2026-10-07', color: 'green' },
  { userId: BEA, day: '2026-10-01', color: 'green' },
  { userId: BEA, day: '2026-10-03', color: 'red' },
  { userId: BEA, day: '2026-10-05', color: 'green' },
  { userId: BEA, day: '2026-10-07', color: 'green' },
  { userId: CAM, day: '2026-10-01', color: 'green' },
  { userId: CAM, day: '2026-10-04', color: 'green' },
  { userId: CAM, day: '2026-10-07', color: 'green' },
]

const payment: PaymentDoc = {
  payerId: ADA,
  payee: { kind: 'member', userId: CAM },
  amountMinor: 40,
  currency: 'USD',
  paidOn: '2026-10-06',
  paypalRef: 'SAMPLE',
  createdAt: Timestamp.fromDate(new Date('2026-10-06T12:00:00Z')),
}

// Writes only documents that are missing, so a second load leaves any later change in place.
export async function loadSample(db: Database): Promise<void> {
  const docs: [DocumentReference, object][] = [
    ...people.flatMap((person): [DocumentReference, object][] => [
      [userRef(db, person.id), { googleSub: person.sub, email: `${person.sub.slice(7)}@sample.invalid`, displayName: person.name, avatarUrl: null }],
      [db.collection('googleSubs').doc(person.sub), { userId: person.id }],
    ]),
    [groupRef(db, SAMPLE_GROUP_ID), pantry],
    ...checkIns.map((row): [DocumentReference, object] => [checkInRef(db, SAMPLE_GROUP_ID, row.userId, row.day), row]),
    [paymentRef(db, SAMPLE_GROUP_ID, PAYMENT_ID), paymentData(payment)],
  ]
  await db.runTransaction(async (tx) => {
    const found = await tx.getAll(...docs.map(([ref]) => ref))
    found.forEach((snapshot, index) => {
      if (!snapshot.exists) tx.create(docs[index]![0], docs[index]![1])
    })
  })
}
