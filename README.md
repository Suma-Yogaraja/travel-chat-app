# TravelChat

A chat-based travel app where users search for flights, book tickets, and manage seats through conversation with Claude.

Built as a learning project to understand core AI engineering concepts: MCP servers, LLM tool calling, streaming, hooks, skills as `.md` files, and CLAUDE.md layering.

## What it does

- **Search flights** — ask in natural language, Claude calls the search tool automatically
- **Book tickets** — Claude handles the booking flow through conversation
- **Change seats** — update your seat on any existing booking
- **Guest mode** — chat without signing in, no data saved
- **Authenticated mode** — sign in with GitHub to save and resume past conversations

## Tech stack

| Layer | Tool |
|---|---|
| Framework | Next.js 15 App Router |
| AI | Vercel AI SDK v7 |
| Model | Claude claude-sonnet-4-6 |
| MCP | `@modelcontextprotocol/sdk` |
| Auth | NextAuth v5 (GitHub OAuth) |
| Database | Neon Postgres |
| ORM | Drizzle ORM |
| Styling | Tailwind CSS |
| Testing | Vitest |

## Key concepts demonstrated

- **MCP server** (`mcp-server/`) — custom stdio server exposing 5 travel tools that Claude calls automatically
- **Tool calling** — Claude decides when to call `search_flights`, `book_flight`, etc. based on the conversation
- **Streaming** — responses stream token by token via `streamText` + `toUIMessageStreamResponse`
- **Hooks** — `onStepFinish` logs every tool call to the terminal, `onFinish` saves the response to DB
- **Skills as `.md` files** — `skills/` folder loaded into the system prompt at request time
- **CLAUDE.md layering** — project-wide rules + MCP server subdirectory rules
- **JSONB message storage** — full `UIMessage` objects stored in Postgres so tool call history survives refresh
- **Adapter pattern** — swap mock flight data for a real API via `FLIGHT_PROVIDER` env var, zero code changes

## Project structure

```
travel-chat-app/
├── CLAUDE.md                        # Architecture rules for Claude
├── mcp-server/
│   ├── CLAUDE.md                    # MCP-specific rules
│   └── index.ts                     # 5 tools: search, seats, book, get, change
├── skills/
│   ├── flight-search.md
│   ├── booking.md
│   └── seat-management.md
├── lib/
│   ├── auth.ts                      # NextAuth config
│   ├── ai-hooks.ts                  # Logging hooks
│   ├── db/                          # Drizzle schema + queries
│   └── flight-provider/             # Mock provider + interface
├── app/
│   ├── api/chat/route.ts            # Main AI streaming route
│   ├── chat/[id]/page.tsx           # Authenticated conversation
│   └── chat/guest/page.tsx          # Guest mode
└── tests/
    ├── layer1-tool-logic/           # Tool logic tests (~14 tests, no LLM)
    └── layer2-mcp-contract/         # MCP contract tests (~5 tests, no LLM)
```

## Getting started

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in:
- `ANTHROPIC_API_KEY` — from [console.anthropic.com](https://console.anthropic.com)
- `DATABASE_URL` — Neon Postgres connection string from [neon.tech](https://neon.tech)
- `NEXTAUTH_SECRET` — run `openssl rand -base64 32`
- `GITHUB_ID` + `GITHUB_SECRET` — create an OAuth app at [github.com/settings/developers](https://github.com/settings/developers) with callback URL `http://localhost:3000/api/auth/callback/github`

### 3. Push the database schema

```bash
npx drizzle-kit push
```

### 4. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Run tests

```bash
npx vitest run
```

## How it works

**Guest mode** (`/chat/guest`) — messages live in React state only. Refresh = start over.

**Authenticated mode** (`/chat/[id]`) — each message is saved to Postgres as a full `UIMessage` JSONB object. On page load, messages are fetched from the DB and restored into the chat. This preserves tool call history so conversations truly resume.

**MCP tools** — the MCP server runs as a stdio subprocess per request. Claude automatically decides which tool to call based on the conversation. The tool call log sidebar shows every call in real time.

## Flight data

Uses mock data by default (`FLIGHT_PROVIDER=mock`). Available routes: JFK↔LAX, JFK↔ORD, JFK↔MIA, SFO↔JFK.

To swap in a real API, set `FLIGHT_PROVIDER=amadeus` and implement `lib/flight-provider/amadeus-provider.ts`.
