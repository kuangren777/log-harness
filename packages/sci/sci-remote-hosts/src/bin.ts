#!/usr/bin/env node
/**
 * `sci-ssh-doctor <alias>`: make one non-interactive connection attempt to a
 * registered host and print why it failed, in the archived skill's own ranked
 * vocabulary. The probe runs `ssh -v -o BatchMode=yes <alias> true`, so it can
 * neither prompt nor hang past the entry's own `ConnectTimeout`, and it runs no
 * remote work of its own.
 *
 * The exit code is the probe's own verdict: `0` when the host answered, `1`
 * when it did not, `2` when this command was called wrong.
 * @module @deepseek-ai/dsh-sci-remote-hosts/bin
 */

import { spawnSync } from 'node:child_process'
import { classifySshFailure } from './doctor.ts'

const [alias] = process.argv.slice(2)
if (alias === undefined || alias === '') {
  process.stderr.write('usage: sci-ssh-doctor <alias>\n')
  process.exit(2)
}

const probe = spawnSync('ssh', ['-v', '-o', 'BatchMode=yes', alias, 'true'], { encoding: 'utf8' })
if (probe.error !== undefined) {
  process.stderr.write(`sci-ssh-doctor: could not run ssh: ${probe.error.message}\n`)
  process.exit(2)
}
if (probe.status === 0) {
  process.stdout.write(`${alias}: reachable\n`)
  process.exit(0)
}

const diagnosis = classifySshFailure(probe.stderr)
process.stdout.write(`${alias}: ${diagnosis.cause}\n`)
if (diagnosis.evidence !== undefined) process.stdout.write(`evidence: ${diagnosis.evidence}\n`)
process.stdout.write(`${diagnosis.remedy}\n`)
process.exit(1)
