# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal daily standup CLI tool built with Bun and TypeScript. It provides an interactive terminal interface for tracking daily standups with features like:
- Streak tracking (current and longest)
- Mood logging with emoji options
- Git commit aggregation from repositories
- Weekly summaries and statistics
- Search functionality
- Automated scheduling via systemd

## Development Commands

### Running the CLI
```bash
bun run index.ts              # Interactive menu
bun run standup              # Run daily standup directly
bun run stats                # View statistics
bun run review               # Weekly review
bun run search               # Search standups
```

### Building
```bash
bun build ./index.ts --compile --outfile standup
```

## Architecture

### Core Files
- **index.ts**: Main CLI application with interactive prompts using @clack/prompts. Handles the entire standup flow including mood selection, accomplishments, blockers, and today's plan.
- **config.ts**: Configuration loader that reads from `config.json` or uses sensible defaults. Auto-detects git username for author filtering.
- **gitUtils.ts**: Git repository scanning and commit aggregation. Scans configured git path for repositories, retrieves commits since a specified date filtered by author, and formats them for display.
- **reminders.ts**: Standalone reminder system that checks if standup is done and sends notifications based on schedule, streak risk, and commit activity.
- **types.ts**: Shared TypeScript interfaces for commits, standup data, streaks, and reminder state.

### Data Storage
- **standups/**: Directory containing markdown files for each standup (named `YYYY-MM-DD.md`)
- **streak.json**: Tracks current streak, longest streak, and last standup date
- **reminders.json**: Tracks reminder state to avoid duplicate notifications
- **config.json**: Optional configuration file for customizing paths and settings

### Git Aggregation Architecture
The git scanning system:
1. Finds all `.git` directories up to 3 levels deep from the configured scan path
2. Runs `git log --all --since --author=<username>` on each repository in parallel (filters by configured author)
3. Checks for unpushed commits by comparing local branches with `origin/*`
4. Aggregates results grouped by repository with pushed/unpushed counts
5. Converts commits to accomplishment format (removing conventional commit prefixes like `feat:`, `fix:`)

### Standup Flow
1. Display current streak
2. Select mood (with custom option)
3. Optionally scan git repos for commits with configurable time range
4. Display commits in grouped or flat format
5. Pre-fill accomplishments from commits (user can accept, add more, or restart)
6. Ask for blockers (multi-line input with confirmation)
7. Ask for today's plan (multi-line input with confirmation)
8. Save to markdown file with timestamp
9. Update streak data
10. Copy to clipboard (supports wl-copy, xclip, xsel)

### Key Patterns
- **Confirmation System**: Each question allows user to confirm, edit, or restart from beginning
- **Multi-line Input**: Custom `askMultiLineQuestion()` helper that allows adding multiple items with confirmation between each
- **Smart Date Detection**: `getSmartDateMessage()` calculates time since last standup and adjusts question wording (yesterday, Friday, N days ago)
- **Streak Management**: Breaks if more than 1 day gap, continues if consecutive days, updates longest streak

## Important Notes

### Configuration System
The tool uses a flexible configuration system:
- All paths are configurable via `config.json`
- If no config exists, uses sensible defaults based on `$HOME` environment variable
- Git author filter auto-detects from `git config user.name`
- Paths use `process.env.HOME` to work correctly in both development and compiled modes

Default locations (customizable in config.json):
- Git scan path: `$HOME/dev/teneo`
- Standup directory: `$HOME/dev/scripts/standup/standups`
- Streak file: `$HOME/dev/scripts/standup/streak.json`
- Reminders file: `$HOME/dev/scripts/standup/reminders.json`

### Systemd Integration
The CLI is designed to run via systemd timer at scheduled times. The reminder system uses:
- UTC 8 AM as scheduled standup time
- 5 PM local time for end-of-day reminders
- notify-send for desktop notifications

### Dependencies
- **@clack/prompts**: Interactive CLI prompts with color support
- **date-fns**: Date manipulation and formatting
- **picocolors**: Terminal color output
- **Bun runtime**: Used for file I/O, process spawning, and script execution
