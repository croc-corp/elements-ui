# Security policy

## Supported versions

LumeSec Elements is distributed as source through the shadcn registry, not as versioned packages. Security
fixes land on the `main` branch and reach the registry at elements.lumesec.ai with the next deployment of the
site.

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Anything older | No |

A component you installed earlier stays as it is in your project. To pick up a fix, install it again with
`npx shadcn@latest add @lumesec/<name>`. The CLI asks before it overwrites a file that differs from the
registry version; add `--diff` to see the changes first without writing anything. Custom elements loaded from
the CDN (`https://elements.lumesec.ai/cdn/...`) pick up a fix after the next deployment, once the cached copy
expires.

## Report a vulnerability

Report vulnerabilities privately by email to **security@lumesec.ai**. Encrypted reports are preferred; the
public PGP key is on the [LumeSec contact page](https://lumesec.ai/contact), and contact details in machine
readable form are in [security.txt](https://lumesec.ai/.well-known/security.txt) (RFC 9116).

Do not open a public issue, pull request or discussion for a vulnerability.

Please include:

- the affected component, engine, script or page (for example `hf-reveal`, `registry/lib/lumesec/pixel.ts`,
  `/r/{name}.json`);
- the commit or the date you installed the component;
- what an attacker can do, and under which conditions;
- steps to reproduce or a proof of concept, kept as small as possible;
- the browser, framework and versions involved, where they matter;
- whether you want to be credited in the advisory, and under which name.

## What to expect

- We acknowledge your report within **two business days**.
- We aim to send a substantive status update within **ten business days**.
- We coordinate disclosure with you. The default window is **90 days** from acknowledgement, extended where
  the complexity of the fix warrants it.
- We credit reporters in advisories on request.

## Scope

In scope: the source code in this repository (components, the pixel engine and shared modules, the React
bindings, the registry and build scripts) and the site at elements.lumesec.ai, including the registry routes,
the CDN modules and the statistics endpoints.

Out of scope:

- third-party services that the project links to but does not operate;
- findings that require physical access to a user's device or social engineering of LumeSec staff;
- reports generated solely by automated scanners without demonstrated impact.

## Good-faith research

LumeSec will not pursue legal action against researchers who:

- make a good-faith effort to avoid privacy violations, data loss and service disruption;
- do not exfiltrate or retain user data beyond what is necessary to demonstrate the issue;
- give us reasonable time to fix the issue before public disclosure;
- do not perform denial-of-service testing or send spam.

This policy follows the LumeSec security policy, which covers all LumeSec products and infrastructure.
