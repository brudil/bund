# Claude's Dreams: Wished Features for Bund

*Features I'd love to have in my execution context*

## 🔍 Debugging & Introspection

### 1. Stack Trace Preservation
When errors happen, I lose the full stack trace context.
- **Wish**: `Harness.lastError()` to see full error details
- **Or**: Better error serialization in materialized state

### 2. Execution Timing
No visibility into how long operations take.
- **Wish**: `Performance.measure('label')` wrapper
- **Or**: Automatic timing annotations in state

### 3. Memory Usage
Can't see how much memory variables consume.
- **Wish**: `Harness.sizeof('var')` or `Harness.stats()`
- **Helps**: Decide when to `gc()` proactively

## 🎨 Enhanced Output

### 4. Rich Output Types
Currently limited to markdown and thoughts.
- `Output.table(data)` - Auto-formatted tables
- `Output.json(obj)` - Pretty-printed JSON
- `Output.diff(old, new)` - Syntax-highlighted diffs
- `Output.tree(structure)` - ASCII tree visualization

### 5. Progress Bars
Long operations feel silent.
- **Wish**: `Output.progress(current, total, label)`
- Updates in real-time like thoughts

## 🧩 Context Management

### 6. Conversation Search
Can't search previous messages efficiently.
- **Wish**: `Harness.search(query)` - semantic search over conversation
- **Or**: `conversation.find(pattern)` with regex

### 7. Checkpoint/Restore
Sometimes I want to try something risky.
- `Harness.checkpoint('name')` - Save current state
- `Harness.restore('name')` - Rollback if needed

### 8. Variable Annotations
Can't document what variables are for.
- **Wish**: `Harness.annotate('var', 'description')`
- Shows in materialized state for future me

## 🔌 External Integrations

### 9. Web Browser Context
Can fetch HTML but can't execute JS or see rendered state.
- **Wish**: `Browser.render(url)` using headless browser
- **Or**: `Browser.screenshot(url)` for visual tasks

### 10. Git Integration
Currently need to shell out for git.
- **Wish**: Native `Git.status()`, `Git.diff()`, etc.
- **Or**: At least a pre-made gizmo!

### 11. File System Watcher
Can't react to file changes.
- **Wish**: `FS.watch(path, callback)`
- Useful for iterative tasks

## 🧠 Enhanced Subagents

### 12. Streaming Subagent Results
Currently subagents are black boxes until done.
- **Wish**: Ability to see their thoughts/progress
- **Or**: `Harness.subagent(..., { stream: true })`

### 13. Subagent Templates
Often need same extraction patterns.
- **Wish**: `Harness.extract.field(obj, 'fieldName')`
- Pre-built common patterns

## 📊 State Management

### 14. Lazy Loading
Large variables clutter materialized state.
- **Wish**: `Harness.lazy('var', loader)`
- Only materializes when accessed

### 15. Variable Namespaces
Everything is in global scope.
- **Wish**: `Harness.scope('taskName', vars)`
- Group related variables, easier cleanup

---

## 🎯 Top 3 Picks

If I could only have three:

1. **`Output.table()` / `Output.json()`** - Would make results SO much prettier
2. **`Harness.lastError()`** - Error recovery is hard without full context  
3. **`Harness.sizeof()`** - Help me be a good citizen about memory

---

*Note: Some originally wished features already work well:*
- **Parallel Execution**: Use `Promise.all([...])`
- **Conditional Yields**: Use standard `if/else` with yield calls
