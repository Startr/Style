---
applyTo: "*"
---
# Startr Development Workflow

## Core Principles

Every development task follows the **Plan-Document-Execute-Verify** cycle:

0. Zeroth Principles:
  - **DRY** - Don't Repeat Yourself Code
  - **KISS** - Keep It Simple, Stupid
1. **Plan** - Add to TODO before doing work
2. **Document** - Update docs and README as needed
3. **Execute** - Implement changes following standards
4. **Verify** - Test, commit, and check off completed items

## Standard Operating Procedure

### Before Starting Any Work

**ALWAYS add to TODO.md first:**

```markdown
## [Category] TODOs
- [ ] **[Task Name]**: Brief description
  - [ ] Subtask 1
  - [ ] Subtask 2
  - [ ] Test/verify step
  - [ ] Documentation update
```

**NEVER start work without:**
- Adding the task to TODO.md
- Getting approval for significant changes
- Understanding the complete scope

### Planning Requirements

For each task, define:
- **Scope** - What exactly needs to be done
- **Dependencies** - What must be completed first
- **Testing** - How to verify it works
- **Documentation** - What docs need updates

## 🚀 Package Manager Preference

**🥇 USE BUN instead of npm in most cases:**

### ⚡ **Command Mapping**
```bash
# Instead of npm        →  Use Bun
bun install            →  npm install
bun run [script]       →  npm run [script]  
bunx [package]         →  npx [package]
bun add [package]      →  npm install [package]
bun remove [package]   →  npm uninstall [package]
```

### 📊 **Performance Benefits**
**Real Performance Data from our project:**
- **🏃‍♂️ Build Speed**: 0.503s vs 1.273s (60% faster)
- **⚡ Install Speed**: 0.067s vs ~2-3s (30-45x faster)
- **💾 Memory Usage**: Lower memory footprint
- **🔄 Hot Reload**: Faster development cycles

### 🎯 **Why Bun is Superior**

| Feature | Bun | npm | Winner |
|---------|-----|-----|--------|
| Speed | ⚡ Ultra-fast | 🐌 Slower | 🥇 Bun |
| Memory | 📉 Efficient | 📈 Higher | 🥇 Bun |
| Bundle Size | 🗜️ Optimized | 📦 Larger | 🥇 Bun |
| Modern Features | ✅ Native | ❌ Plugins | 🥇 Bun |

### 🔧 **Bun Guide**
1. **Install Bun**: `curl -fsSL https://bun.sh/install | bash`
2. **Verify**: `bun --version` 
3. **Replace npm commands**: Use mapping above

### ⚠️ **When to use npm**
- Legacy projects requiring npm-specific features
- Corporate environments with npm-only policies
- Rare Bun compatibility issues (< 1% of cases)

## See the [DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md) for more details.