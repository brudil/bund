# bund

**A REPL-based AI agent that executes TypeScript/JavaScript code**

## Architecture

- **Client**: Terminal UI built with Ink (React for CLI)
- **Server**: WebSocket server managing agent and code execution
- **Agent**: Claude-powered code generator with error recovery
- **REPL**: Bun-based code executor with persistent context
- **Materializer**: Converts runtime state to TypeScript context

## Key Features

- Agentic loop - agent continues executing until task is complete
- Persistent variables across turns
- Automatic error recovery (up to 3 retries)
- Materialized state - runtime values serialized back to TypeScript
- Unix socket communication between client and server
- Context management - agent can delete variables to free space

## Workflow

1. User sends message via terminal client
2. Server calls Claude with materialized context
3. Claude generates executable TypeScript code
4. Code executes in Bun REPL with persistent context
5. Results feed back to agent for next iteration
6. Loop continues until yieldControl() is called

## Tech Stack

- **Runtime**: Bun
- **AI**: Claude Sonnet 4.5
- **UI**: Ink (React for terminal)
- **Parsing**: ts-morph for TypeScript AST
- **IPC**: Unix domain sockets
