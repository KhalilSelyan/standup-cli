# Contributing to Standup CLI

Thank you for your interest in contributing to Standup CLI! This document provides guidelines for contributing to the project.

## Development Setup

1. Fork and clone the repository
2. Install dependencies: `bun install`
3. Run in development mode: `bun run standup`
4. Build the binary: `bun run build`

## Code Style

- TypeScript with strict type checking
- Use meaningful variable and function names
- Add comments for complex logic
- Follow existing code patterns

## Project Structure

- `index.ts` - Main CLI application
- `config.ts` - Configuration management
- `gitUtils.ts` - Git repository scanning and commit aggregation
- `reminders.ts` - Notification system
- `types.ts` - TypeScript type definitions

## Testing

Before submitting a PR:
1. Test the CLI in development mode: `bun run standup`
2. Build and test the binary: `bun run build && ./standup`
3. Verify all commands work: `standup`, `stats`, `search`, `review`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear commit messages
3. Test your changes thoroughly
4. Update documentation if needed
5. Submit a PR with a clear description of changes

## Feature Requests

Open an issue with:
- Clear description of the feature
- Use case and motivation
- Example implementation (if applicable)

## Bug Reports

Include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (OS, Bun version)
- Error messages or screenshots

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers
- Focus on collaboration
- Keep discussions on-topic

Thank you for contributing!
