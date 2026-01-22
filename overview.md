// Made by bund.

# Project Overview: **bund**

## Description
**bund** is a REPL-based agent system that combines a Bun-powered server with an Ink-based terminal UI client. It provides an interactive environment where an AI agent can execute code, manage state, and communicate with users through a Unix socket.

## Architecture

### Main Components
1. **Server** (`src/server/`)
   - `agent.ts` - AI agent logic using Anthropic's Claude API
   - `materializer.ts` - State serialization and variable tracking
   - `repl.ts` - Code execution environment
   - `index.ts` - Server entry point with Unix socket handling

2. **Client** (`src/client/`)
   - `index.tsx` - Terminal UI using Ink/React
   - `components/` - UI components
   - `hooks/` - React hooks for client functionality

3. **Shared** (`src/shared/`)
   - `protocol.ts` - Communication protocol definitions

### Key Files
- `src/index.ts` - Main launcher that starts both server and client
- `package.json` - Dependencies include @anthropic-ai/sdk, ink, react, ts-morph
- `README.md` - Basic setup instructions

## Features
- **REPL Agent**: AI agent that thinks and operates in executable code
- **State Materialization**: Automatic tracking of variables and functions
- **Unix Socket Communication**: Server-client messaging via local socket
- **Terminal UI**: Interactive Ink-based interface
- **Code Execution**: Runs JavaScript/TypeScript in Bun runtime

## Development
- Built with Bun runtime
- TypeScript throughout
- React-based terminal UI with Ink
- Claude API integration for AI capabilities

## Project Structure
```
bund/
├── src/
│   ├── server/     # Backend REPL and agent
│   ├── client/     # Terminal UI
│   ├── shared/     # Shared protocol
│   └── index.ts    # Main launcher
├── conversation/   # Chat logs (11 files)
├── design/        # Design documents
└── package.json
```
