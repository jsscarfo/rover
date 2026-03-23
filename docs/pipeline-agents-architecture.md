# Pipeline Agents Architecture

## Philosophy

> "Avoid dark spots in the map — no 'here be dragons' during development"

Large projects are decomposed into manageable pieces through a **directed pipeline** where each phase feeds into the next. The Director (Opus) breaks down work, sets interlocking constraints, and delegates to specialized agents.

## Pipeline Phases

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE FLOW                                        │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│   PLANNING  │   DESIGN    │  IMPLEMENT  │   TEST      │    DEPLOY           │
│  (Director) │  (Director  │   (Sonnet   │  (Haiku +   │   (Sonnet +         │
│             │   → Sonnet) │   + Tools)  │   Tools)    │    Tools)           │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│ Define      │ Architecture│ Write code  │ Unit tests  │ Build artifacts     │
│ modules     │ decisions   │ Refactor    │ Integration │ Configure CI/CD     │
│ Set         │ API design  │ Documentation│ Security   │ Deploy to staging   │
│ boundaries  │ Data models │ Error handling│ Linting    │ Deploy to prod      │
│ Identify    │ Dependencies│ Logging     │ Type check  │ Rollback plans      │
│ interlocks  │             │             │             │                     │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘
                              ↓
                    ┌─────────────────┐
                    │   FEEDBACK LOOP │
                    │  (Haiku learns, │
                    │   updates mem)  │
                    └─────────────────┘
```

## Agent Roles

### 1. Director (Claude Opus)
**Scope**: Project-wide, cross-module concerns
**Responsibilities**:
- Initial project decomposition into modules
- Define module boundaries and interfaces
- Identify inter-module dependencies
- Set architectural constraints
- Review design outputs before implementation
- Resolve cross-module conflicts

**Never does**: Implementation details, line-by-line code

### 2. Architect (Claude Sonnet)  
**Scope**: Single module, design phase
**Responsibilities**:
- Create detailed module design
- Define internal component structure
- Specify APIs (internal and external)
- Choose design patterns
- Document data flows
- Flag constraints to Director

**Handoff to**: Implementer

### 3. Implementer (Claude Sonnet + Tools)
**Scope**: Single module, implementation phase
**Responsibilities**:
- Write production code
- Add inline documentation
- Implement error handling
- Add observability (logs, metrics)
- Self-review before testing

**Tools**: Code editing, file operations, git

### 4. Tester (Claude Haiku + Tools)
**Scope**: Single module, verification phase
**Responsibilities**:
- Write unit tests
- Integration testing
- Security scanning
- Linting and type checking
- Performance benchmarks
- Coverage analysis

**Constraint**: Cannot modify source code (read-only)
**Output**: Test results, coverage report, issues list

### 5. Deployer (Claude Sonnet + Tools)
**Scope**: Module deployment
**Responsibilities**:
- Build artifacts
- Configure environments
- Deploy to staging
- Run smoke tests
- Deploy to production
- Create rollback plans

### 6. Context Engineer (Claude Haiku)
**Scope**: Cross-cutting, maintenance
**Responsibilities**:
- Compress completed task contexts
- Maintain project memory
- Extract reusable patterns
- Update global documentation
- Summarize for Director rehydration

**Runs after**: Each completed task

## WBS Structure with Pipeline

```json
{
  "version": "2.0.0",
  "project": "fpx-laureline",
  "pipeline": {
    "phases": ["planning", "design", "implement", "test", "deploy"],
    "currentPhase": "implement"
  },
  "modules": [
    {
      "id": "mod-auth",
      "name": "Authentication Module",
      "status": "implementing",
      "phase": "implement",
      "agent": "sonnet-001",
      "dependencies": [],
      "interface": {
        "exports": ["authenticate", "authorize", "refreshToken"],
        "types": ["User", "Session", "Token"]
      },
      "pipeline": {
        "planning": {
          "status": "completed",
          "output": "memories/modules/mod-auth/plan.md",
          "tokens": 45000
        },
        "design": {
          "status": "completed", 
          "output": "memories/modules/mod-auth/design.md",
          "tokens": 120000,
          "reviewedBy": "director"
        },
        "implement": {
          "status": "in-progress",
          "assignedTo": "worker-2",
          "taskRef": "rover/task/550e8400...",
          "progress": 45
        },
        "test": {
          "status": "pending"
        },
        "deploy": {
          "status": "pending"
        }
      }
    }
  ],
  "kanban": {
    "backlog": ["mod-payments", "mod-notifications"],
    "planning": [],
    "designing": ["mod-dashboard"],
    "implementing": ["mod-auth"],
    "testing": [],
    "deploying": [],
    "completed": ["mod-config"]
  }
}
```

## Visualization: Dual Views

### 1. WBS Tree View (Hierarchical)
```
FPX-Laureline
├── Authentication [implementing] 🔄 W2
│   ├── Planning ✅
│   ├── Design ✅ (Reviewed)
│   ├── Implement 🔄 45%
│   ├── Test ⏳
│   └── Deploy ⏳
├── Dashboard [designing] 🔄 W3
│   ├── Planning ✅
│   ├── Design 🔄 60%
│   └── ...
└── API Gateway [planning] ⏳ W4
```

### 2. Kanban Board View (Pipeline)
```
┌────────────┬────────────┬────────────┬────────────┬────────────┐
│  BACKLOG   │  PLANNING  │   DESIGN   │ IMPLEMENT  │   TEST     │
├────────────┼────────────┼────────────┼────────────┼────────────┤
│ mod-pay    │            │ mod-dash 🔄│ mod-auth 🔄│            │
│ mod-notif  │            │            │            │            │
└────────────┴────────────┴────────────┴────────────┴────────────┘
```

## Pipeline Constraints

### 1. Gate Requirements

A module cannot advance to the next phase until:

- **Planning → Design**: Director approval
- **Design → Implement**: All interfaces documented
- **Implement → Test**: Code compiles, no lint errors
- **Test → Deploy**: 80%+ coverage, all tests pass
- **Deploy → Complete**: Smoke tests pass in staging

### 2. Feedback Loops

```
If test fails → Return to implement (same agent if possible)
If design flaw found → Return to design (escalate to Director)
If integration fails → Return to design (check interfaces)
```

### 3. Parallelization Rules

- **Same phase, different modules**: ✅ Parallel
- **Different phases, same module**: ❌ Sequential
- **Dependencies**: Module A blocks Module B if B depends on A

## Memory Architecture

### Module Memory
```
memories/
├── modules/
│   ├── mod-auth/
│   │   ├── plan.md           # Director's planning output
│   │   ├── design.md         # Architect's design doc
│   │   ├── implementation.md # Key decisions during coding
│   │   ├── test-results.md   # Tester output
│   │   └── lessons.md        # Post-completion summary
│   └── ...
```

### Planning Output (plan.md)
```markdown
# Module: Authentication

## Responsibility
Handle user authentication, authorization, and session management.

## Boundaries
- IN: HTTP requests, JWT tokens
- OUT: User context, permission sets
- NOT: User profile data (mod-users), Email sending (mod-notifications)

## Interfaces
```typescript
// Public API
authenticate(credentials: Credentials): Promise<Session>
authorize(session: Session, resource: string): Promise<boolean>
refreshToken(token: string): Promise<Token>

// Events Published
- user.authenticated
- session.expired
- token.refreshed
```

## Dependencies
- mod-database (for session storage)
- mod-config (for JWT secrets)

## Constraints
- Must support OAuth2 and SAML
- Token expiry: 15 min access, 7 day refresh
- Rate limit: 10 attempts/minute

## Interlocks
- mod-users calls authorize() for permission checks
- mod-api-gateway validates tokens on each request
```

### Design Output (design.md)
```markdown
# Design: Authentication Module

## Component Diagram
[AuthController] → [AuthService] → [SessionStore]
                    ↓
               [TokenManager] → [JWT]
                    ↓
               [StrategyRegistry] → [OAuthStrategy, SAMLStrategy]

## Data Models
```typescript
interface Session {
  id: string;
  userId: string;
  permissions: string[];
  createdAt: Date;
  expiresAt: Date;
}
```

## File Structure
```
src/auth/
├── controllers/
│   └── auth.controller.ts
├── services/
│   ├── auth.service.ts
│   └── token.service.ts
├── strategies/
│   ├── oauth.strategy.ts
│   └── saml.strategy.ts
└── guards/
    └── auth.guard.ts
```

## Error Handling
- 401: Invalid credentials
- 403: Insufficient permissions
- 429: Rate limited

## Open Questions
- [ ] Should we implement remember-me? (Ask Product)
```

## Implementation Plan

### Phase 1: WBS + Pipeline Foundation

1. **Update WBS Schema** to include pipeline phases
2. **Create pipeline state machine** in worker
3. **Update dashboard** for dual views (tree + kanban)
4. **Module memory structure** in `.rover/memories/modules/`

### Phase 2: Agent Specialization

1. **Charter definitions** for each agent type
2. **Prompt engineering** for phase-specific outputs
3. **Handoff protocols** between phases
4. **Gate validation** logic

### Phase 3: Director Orchestration

1. **Automatic decomposition** on new project
2. **Dependency graph** analysis
3. **Worker assignment** based on phase requirements
4. **Progress tracking** across pipeline

### Phase 4: Feedback & Learning

1. **Test failure → implement** loop
2. **Design review** automation
3. **Pattern extraction** to memories
4. **Context compression** for long projects

## Configuration

```yaml
# .rover/config.yaml
pipeline:
  enabled: true
  phases:
    - name: planning
      agent: director
      required: true
    - name: design
      agent: architect
      required: true
      review: director
    - name: implement
      agent: implementer
      required: true
    - name: test
      agent: tester
      required: true
      autoPromote: false  # Require manual approval
    - name: deploy
      agent: deployer
      required: false  # Optional for some modules

agents:
  director:
    model: claude-opus-4-6
    maxTokens: 200000
  architect:
    model: claude-sonnet-4-6
    maxTokens: 100000
  implementer:
    model: claude-sonnet-4-6
    maxTokens: 80000
  tester:
    model: claude-haiku-4-5
    maxTokens: 40000

gates:
  test:
    coverage: 80
    lint: error
    types: strict
```

## Success Metrics

1. **No "dark spots"**: Every module has clear boundaries
2. **No surprises**: Interfaces defined before implementation
3. **Parallel efficiency**: Multiple modules in different phases
4. **Quality gates**: Automated testing before deploy
5. **Knowledge retention**: Memories captured at each phase

## Implementation Order

Given choices:
- ✅ Single Director per project
- ✅ Summarize old memories  
- ✅ Personal access tokens (simpler)
- ✅ WBS-first approach

**Next Steps**:
1. Implement WBS v2 schema with pipeline support
2. Create basic Kanban view in dashboard
3. Add pipeline phase tracking to workers
4. Define agent charters for each role

Should we proceed with this refined architecture?