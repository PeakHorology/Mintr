# Security Policy

## Supported Versions

Mintr **1.0.x** is the current public line. Please report issues against the latest commit on the default branch.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

Mintr is local-first: projects and files stay on the user’s machine. Still report anything that could:

- Exfiltrate local project or filesystem data unexpectedly
- Execute untrusted code from imported CAD/mesh files
- Break sandboxing of the desktop (Electron) shell

Prefer opening a private security advisory on the GitHub repository when available, or contact PeakHorologyLLC through the project homepage. Do not file public issues that include exploit details until a fix is ready.

Please include:

1. Affected version / commit
2. Steps to reproduce
3. Impact assessment
4. Any suggested mitigation

We aim to acknowledge reports within a few business days.
