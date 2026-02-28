# Security Policy

## Supported Versions

| Package | Supported |
|---|---|
| `@p402/sdk` (latest) | Yes |
| `@p402/cli` (latest) | Yes |
| Older versions | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@p402.io** with:
1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Any suggested fixes (optional)

We will acknowledge receipt within 48 hours and provide a resolution timeline within 5 business days.

## What Qualifies

- Authentication/authorization bypasses in the SDK or CLI
- Key or secret exposure through SDK/CLI code paths
- Dependency vulnerabilities with demonstrated exploit paths
- EIP-3009/EIP-712 signature verification flaws

## What Does Not Qualify

- Issues requiring physical access to a device
- Social engineering attacks
- Rate limiting or denial-of-service on the public API (report via support)

## Disclosure Policy

We follow a 90-day coordinated disclosure window. After a fix is released, we will publish a security advisory acknowledging the reporter (unless you prefer to remain anonymous).

## Safe Harbor

We consider security research conducted under this policy to be authorized. We will not pursue legal action against researchers who:
- Follow this policy
- Avoid accessing or modifying user data
- Do not degrade service availability
- Report findings promptly
