---
"chat-adapter-linq": patch
---

fix: tolerate `parts: null` on tombstones / system events

Linq's API returns `parts: null` for deleted messages and system events
(participant join/leave, etc.) even though the declared type is
non-nullable. `partsToText`, `partsToAttachments`, and `fetchMessages`
now treat a non-array `parts` as empty so history pagination doesn't
throw mid-fetch when a thread contains a tombstone. The `LinqMessage`
type is widened to `LinqMessagePart[] | null` to reflect API reality.

A new `isLinqTombstone(message)` helper is exported so consumers can
detect these rows (via `message.raw`) and decide how to render them —
skip, show "[deleted]", etc. — without poking at `parts === null`.
