/**
 * The `sci ssh-doctor` classifier: one `ssh -v` transcript in, one ranked cause
 * and its remedy out.
 *
 * The archived skill already knew the ranking — public key not in the server's
 * `authorized_keys`, then a machine the sandbox's network cannot reach, then a
 * wrong username — and told the model to read `ssh -v` output to tell them
 * apart, which left the reading to a model that had never seen that server
 * (`ClawsGO-System/01-Skills/_raw-skills/clawsgo-remote-hosts/SKILL.md`, "When a
 * connection fails"). Here the reading is a pure function over the transcript,
 * so the same output always produces the same answer.
 *
 * The rules are ordered by how conclusive their evidence is, not by how likely
 * the cause is: a connection that never reached the server cannot have failed
 * authentication, and a key ssh refused to load was never offered, so both are
 * decided before the `Permission denied (publickey)` line that every one of
 * these failures also prints.
 * @module @deepseek-ai/dsh-sci-remote-hosts/src/doctor
 */

import type { SshDiagnosis, SshFailureCause } from './types.ts'

/**
 * What to do about each cause, in one sentence, written for the person who
 * registered the host rather than for the model that hit the failure.
 */
export const SSH_FAILURE_REMEDIES: Readonly<Record<SshFailureCause, string>> = {
  'host-unreachable': 'The sandbox has no network path to this machine: it must be reachable from the internet, so publish it, forward a port to it, put an frp tunnel or a jump host in front of it, and register the address that answers.',
  'key-unusable': 'The private key file this entry names is missing or is not mode 0600, which ssh refuses before it contacts anything: re-register the host so the key is written again, and check that the sandbox image creates it with owner-only permissions.',
  'wrong-username': 'The server refused the account name, so the entry\'s User is wrong or not permitted to log in: register the host again with the account that owns the home directory you expect.',
  'key-not-authorized': 'The server has never been told about this key: append the entry\'s public key to ~/.ssh/authorized_keys of that user on the remote machine, and confirm the file is owner-writable only.',
  unclassified: 'The transcript names none of the known causes, so read the ssh -v output directly before changing anything; the entry itself can always be replaced by registering the host again.',
}

/** One ranked rule: the cause it decides and the transcript lines that decide it. */
interface DiagnosisRule {
  /** The cause this rule concludes. */
  readonly cause: SshFailureCause
  /** Lines whose presence is conclusive for {@link cause}. */
  readonly patterns: readonly RegExp[]
}

/**
 * The rules in decision order. Each pattern is OpenSSH client output; none of
 * them appears on a connection that succeeded.
 */
const RULES: readonly DiagnosisRule[] = [
  {
    cause: 'host-unreachable',
    patterns: [
      /Connection timed out/,
      /Operation timed out/,
      /Connection refused/,
      /Could not resolve hostname/,
      /Name or service not known/,
      /Network is unreachable/,
      /No route to host/,
    ],
  },
  {
    cause: 'key-unusable',
    patterns: [
      /Permissions \d+ for .* are too open/,
      /bad permissions/i,
      /^Load key .*: (?:No such file or directory|Permission denied|invalid format|error in libcrypto)/,
      /no such identity: .*: No such file or directory/i,
    ],
  },
  {
    cause: 'wrong-username',
    patterns: [
      /Invalid user /,
      /Illegal user /,
      /not allowed because/,
    ],
  },
  {
    cause: 'key-not-authorized',
    patterns: [
      /Permission denied \(publickey/,
      /Too many authentication failures/,
    ],
  },
]

/**
 * Classify one failed connection attempt.
 * @param verboseOutput - everything `ssh -v <alias>` wrote, stderr included.
 * @returns the highest-ranked cause the transcript supports, the line that decided it, and the remedy.
 */
export function classifySshFailure(verboseOutput: string): SshDiagnosis {
  const lines = verboseOutput.split('\n').map(line => line.trim())
  for (const rule of RULES) {
    const evidence = lines.find(line => rule.patterns.some(pattern => pattern.test(line)))
    if (evidence !== undefined) return { cause: rule.cause, evidence, remedy: SSH_FAILURE_REMEDIES[rule.cause] }
  }
  return { cause: 'unclassified', remedy: SSH_FAILURE_REMEDIES.unclassified }
}
