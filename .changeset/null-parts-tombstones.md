---
"chat-adapter-linq": minor
---

Tolerate `parts: null` on tombstones and system events.

Linq's API returns `parts: null` for deleted messages and system events
(participant join/leave, name changes, etc.) even though the declared
type is non-nullable. Today this crashes `fetchMessages` mid-pagination
whenever a thread's history contains a tombstone, and `partsToText` /
`partsToAttachments` throw on the same shape.

Changes:

- `partsToText` / `partsToAttachments` short-circuit to `""` / `[]` when
  `parts` is not an array, and defensively skip falsy entries and text
  parts missing a string `value`.
- `fetchMessages` parses each row through `partsToText` so a tombstone
  in the page no longer kills the whole fetch and the row is preserved
  (with empty text) instead of being dropped — pagination stays
  consistent.
- `parseMessageEvent` inherits the same tolerance via the helpers, so
  an unexpected null on a webhook event won't crash either.

New API:

- `isLinqTombstone(message)` — predicate exported from the package root
  so consumers can detect tombstones via `message.raw` and choose how to
  render them (skip, show "[deleted]", etc.) without reaching into
  `parts === null` themselves.

Type changes (the reason this is a minor bump):

- `LinqMessage.parts` is widened from `LinqMessagePart[]` to
  `LinqMessagePart[] | null` to reflect API reality. Consumers that
  destructure or iterate `m.parts` without a guard will see a new TS
  error on upgrade — use `isLinqTombstone(m)` or an `Array.isArray`
  check.
