# dsh-mail-file

English | [中文](README.zh.md)

File-backed [mail](../mail/README.md) provider: every delivered message becomes one JSON line appended to a configured mailbox file. Unit suites, keyless snapshots, and browser journeys mount it to read back what the harness sent — recovering a one-time code from a sign-in mail is the case it exists for.

## Config

| Field | Default | Meaning |
|---|---|---|
| `path` | required | Mailbox file. A relative path resolves against the process working directory, and missing parent directories are created. |

## The mailbox line format

One compact JSON object per line, terminated by `\n`. This format is a contract: consumers parse it, so the fields below change only with them.

| Field | Meaning |
|---|---|
| `ts` | ISO-8601 UTC instant at which the provider accepted the message. |
| `to` | Recipient address, verbatim from `MailMessage.to`. |
| `subject` | Subject line, verbatim. |
| `text` | Plain-text body, verbatim. |
| `html` | HTML body; the key is present only when the message carried one. |

```jsonl
{"ts":"2026-08-23T09:41:07.412Z","to":"recipient@example.com","subject":"Your sign-in code","text":"Your code is 314159."}
{"ts":"2026-08-23T09:42:11.008Z","to":"recipient@example.com","subject":"Welcome","text":"Hello.","html":"<p>Hello.</p>"}
```

No other key is ever emitted, and existing lines are never rewritten, so a reader may parse the file line by line and index messages by arrival order.

## File handling

The mailbox is opened once in append mode and stays open for the provider's lifetime; sends are serialized through one queue, so line order is the order in which the provider accepted the messages even when a consumer sends concurrently.

The file is `0600`. A delivered message can carry a sign-in link or a one-time code, so the mode is applied both when this provider creates the file and when it opens a mailbox an earlier run left group- or world-readable. This is a security invariant, not a deployment choice, and no config field relaxes it.

Disposal waits for the accepted writes to settle before closing the handle. A send issued before teardown still reaches the file; a send issued after it is refused by name rather than reopening a mailbox nothing will close.

## Model Experience

None, as the mailbox is a host-side file: nothing this provider writes is read back into a model request, and no shipped composition mounts it.

#### KV Cache effect

None; the package contributes no request content, so no prefix can be invalidated.

## Known Limitations and Deferred Work

- **One writer per mailbox** — ordering and the open handle are process-local. Two harness processes appending to one path may interleave partial lines; give each process its own mailbox.
- **Unbounded growth** — nothing rotates or truncates the file. A long-lived composition points `path` at a location its own cleanup owns.
