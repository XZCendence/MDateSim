# MDateSim Client

Vite + React + TypeScript lobby for the dating sim.

## Flow

1. `/lobby` pick a date from the roster in `src/data/dates.ts`
2. `/start/:dateId` shows a QR code that opens Messages with the Photon line and a prefilled first text
3. `/dates` schedule IRL dates, which hand off to the Kinect in `../Irl/`

## Run

```sh
cp .env.example .env   # already done locally
bun install
bun dev
```

## Shared state

SpacetimeDB bindings are imported from `../Server/src/module_bindings` via the `@bindings` alias
(see `vite.config.ts`), so the client and server always agree on the schema. After changing the
module in `../Server/spacetimedb`, run `bun run spacetime:generate` in `../Server`.

`src/lib/session.ts` keeps the player's pick and scheduled dates in localStorage for now. Replace
it with reducer calls once the module has `player` and `irl_date` tables.
