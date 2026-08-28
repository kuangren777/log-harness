// The `ssh -v` classifier: one transcript in, one ranked cause and its remedy
// out. Nothing here runs ssh — the fixtures are real OpenSSH client output, and
// the classification is a pure function over them.
import { describe, expect, it } from 'vitest'
import { SSH_FAILURE_REMEDIES, classifySshFailure } from '@deepseek-ai/dsh-sci-remote-hosts'
import type { SshFailureCause } from '@deepseek-ai/dsh-sci-remote-hosts'

const HANDSHAKE = [
  'OpenSSH_9.6p1, OpenSSL 3.0.13 30 Jan 2024',
  'debug1: Reading configuration data /home/user/.ssh/config',
  'debug1: /home/user/.ssh/config line 3: Applying options for gpu-lab',
  'debug1: Connecting to gpu.example.com [203.0.113.7] port 22.',
].join('\n')

const cases: { label: string; cause: SshFailureCause; transcript: string; evidence: string }[] = [
  {
    label: 'a host that never answered',
    cause: 'host-unreachable',
    transcript: `${HANDSHAKE}\ndebug1: connect to address 203.0.113.7 port 22: Connection timed out\nssh: connect to host gpu.example.com port 22: Connection timed out`,
    evidence: 'debug1: connect to address 203.0.113.7 port 22: Connection timed out',
  },
  {
    label: 'a name that does not resolve',
    cause: 'host-unreachable',
    transcript: 'ssh: Could not resolve hostname gpu.example.com: Name or service not known',
    evidence: 'ssh: Could not resolve hostname gpu.example.com: Name or service not known',
  },
  {
    label: 'a refused port',
    cause: 'host-unreachable',
    transcript: `${HANDSHAKE}\nssh: connect to host gpu.example.com port 22: Connection refused`,
    evidence: 'ssh: connect to host gpu.example.com port 22: Connection refused',
  },
  {
    label: 'a LAN box with no route from the sandbox',
    cause: 'host-unreachable',
    transcript: `${HANDSHAKE}\nssh: connect to host 192.168.1.10 port 22: No route to host`,
    evidence: 'ssh: connect to host 192.168.1.10 port 22: No route to host',
  },
  {
    label: 'a key the sandbox image left world-readable',
    cause: 'key-unusable',
    transcript: [
      HANDSHAKE,
      '@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@',
      "Permissions 0644 for '/home/user/.ssh/sci-gpu-lab' are too open.",
      'Load key "/home/user/.ssh/sci-gpu-lab": bad permissions',
      'user@gpu.example.com: Permission denied (publickey).',
    ].join('\n'),
    evidence: "Permissions 0644 for '/home/user/.ssh/sci-gpu-lab' are too open.",
  },
  {
    label: 'a key file that is not there',
    cause: 'key-unusable',
    transcript: `${HANDSHAKE}\ndebug1: Trying private key: /home/user/.ssh/sci-gpu-lab\nLoad key "/home/user/.ssh/sci-gpu-lab": No such file or directory\nubuntu@gpu.example.com: Permission denied (publickey).`,
    evidence: 'Load key "/home/user/.ssh/sci-gpu-lab": No such file or directory',
  },
  {
    label: 'an account the server does not have',
    cause: 'wrong-username',
    transcript: `${HANDSHAKE}\ndebug1: Remote: Invalid user ubunut from 198.51.100.4 port 51234\ndebug1: Authentications that can continue: publickey\nubunut@gpu.example.com: Permission denied (publickey).`,
    evidence: 'debug1: Remote: Invalid user ubunut from 198.51.100.4 port 51234',
  },
  {
    label: 'an account the server refuses by policy',
    cause: 'wrong-username',
    transcript: `${HANDSHAKE}\ndebug1: Remote: User root from 198.51.100.4 not allowed because not listed in AllowUsers`,
    evidence: 'debug1: Remote: User root from 198.51.100.4 not allowed because not listed in AllowUsers',
  },
  {
    label: 'a key the server has never been told about',
    cause: 'key-not-authorized',
    transcript: [
      HANDSHAKE,
      'debug1: Offering public key: /home/user/.ssh/sci-gpu-lab RSA SHA256:abc',
      'debug1: Authentications that can continue: publickey',
      'ubuntu@gpu.example.com: Permission denied (publickey).',
    ].join('\n'),
    evidence: 'ubuntu@gpu.example.com: Permission denied (publickey).',
  },
  {
    label: 'a server that ran out of authentication attempts',
    cause: 'key-not-authorized',
    transcript: `${HANDSHAKE}\nReceived disconnect from 203.0.113.7 port 22:2: Too many authentication failures`,
    evidence: 'Received disconnect from 203.0.113.7 port 22:2: Too many authentication failures',
  },
]

describe('classifySshFailure', () => {
  it.each(cases)('classifies $label as $cause', ({ cause, transcript, evidence }) => {
    expect(classifySshFailure(transcript)).toEqual({
      cause,
      evidence,
      remedy: SSH_FAILURE_REMEDIES[cause],
    })
  })

  it('ranks an unreachable host above the permission denial printed after it', () => {
    const transcript = `${HANDSHAKE}\nssh: connect to host gpu.example.com port 22: Connection timed out\nubuntu@gpu.example.com: Permission denied (publickey).`

    expect(classifySshFailure(transcript).cause).toBe('host-unreachable')
  })

  it('ranks a wrong username above the permission denial it produces', () => {
    const transcript = `${HANDSHAKE}\ndebug1: Remote: Invalid user ubunut\nubunut@gpu.example.com: Permission denied (publickey).`

    expect(classifySshFailure(transcript).cause).toBe('wrong-username')
  })

  it('reports a successful transcript as unclassified with no evidence', () => {
    expect(classifySshFailure(`${HANDSHAKE}\ndebug1: Authentication succeeded (publickey).`)).toEqual({
      cause: 'unclassified',
      remedy: SSH_FAILURE_REMEDIES.unclassified,
    })
  })

  it('reports empty output as unclassified', () => {
    expect(classifySshFailure('').cause).toBe('unclassified')
  })

  it('gives every cause a remedy sentence', () => {
    expect(Object.values(SSH_FAILURE_REMEDIES).every(remedy => remedy.endsWith('.'))).toBe(true)
  })
})
