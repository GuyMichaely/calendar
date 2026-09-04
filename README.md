# Calendar deployment control

This branch contains deployment control only. Application code lives in separate deploy-unit development streams.

## Deploy units

- `root`: the original application, currently sourced from `reference/pre-preview-deployment-main`.
- `vanilla`: the vanilla refactor, currently developed on `agent/vanilla-refactor`.
- `solid`: the Solid implementation, currently developed on `agent/solid-refactor`.

## Protocol

Development commits do not deploy and do not run verification automatically.

To make a commit eligible for deployment, run **Verify Candidate** with its deploy unit and exact 40-character commit SHA. A successful verification runs that unit's complete check/build procedure and stores the deployable output as a 90-day Actions artifact.

To publish a verified commit, run **Promote Deployment** with the same deploy unit and SHA. Promotions are serialized. Promotion accepts only an exact SHA with a successful canonical verification artifact, updates only that unit in `deployment.json`, commits the manifest, and dispatches deployment for that exact manifest commit.

`deployment.json` is authoritative. Each manifest entry records the deployed SHA plus verification/artifact provenance. Every manifest change gets its own serialized Pages deployment attempt. Deployment reads the exact manifest commit that triggered it.

Deployment normally reuses the artifact produced by verification. If that artifact is explicitly expired, or its recorded expiry time has passed and GitHub has already removed its metadata, deployment rebuilds that exact historically verified SHA without retesting. An artifact missing before its recorded expiry is treated as an invariant failure and stops deployment.

The public mapping is:

- `root` -> `/calendar/`
- `vanilla` -> `/calendar/vanilla/`
- `solid` -> `/calendar/solid/`

The control branch itself is not an application source.
