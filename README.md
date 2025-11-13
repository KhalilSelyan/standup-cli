# 📋 Daily Standup CLI

A personal productivity tool for tracking daily standups with streak tracking, mood logging, and automated git commit aggregation. Built with Bun and TypeScript.

## ✨ Features

- 📝 **Interactive Standup Creation** - Guided prompts for accomplishments, blockers, and today's plan
- 🔥 **Streak Tracking** - Monitor your consistency with current and longest streak counters
- 😊 **Mood Logging** - Track your daily mood with emoji options
- 🔗 **Git Integration** - Automatically scan repositories and aggregate commits as accomplishments
- 📊 **Statistics & Analytics** - View standup history, mood distribution, and trends
- 🔍 **Search Functionality** - Search past standups by keyword or date range
- 📅 **Weekly Reviews** - Generate summaries of your week's standups
- 🔔 **Smart Reminders** - Optional systemd integration for scheduled notifications
- ⚙️ **Configurable** - Customize paths and author filtering via config file
- 📋 **Clipboard Integration** - Auto-copy to clipboard (supports wl-copy, xclip, xsel)

## 📦 Installation

### Prerequisites

- [Bun](https://bun.sh) runtime installed
- Git (for commit aggregation feature)

### Install from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/standup-cli.git
cd standup-cli

# Install dependencies
bun install

# Build the binary
bun run build

# Install globally (optional)
bun run install:global
```

After global installation, you can run `standup` from anywhere.

## 🚀 Usage

### Interactive Mode

Run without arguments to access the interactive menu:

```bash
standup
```

### Direct Commands

```bash
# Commands (no prefix)
standup            # Interactive menu (default)
standup standup    # Create new standup entry
standup stats      # View statistics
standup search     # Search past standups
standup review     # View weekly summary

# Flags (-- prefix with short options)
standup --help     # -h  Show help
standup --version  # -v  Show version
standup --migrate  # -m  Migrate data from old location
```

### Development Mode

```bash
bun run standup    # Run directly from source
bun run stats      # View stats
bun run search     # Search
bun run review     # Weekly review
```

## ⚙️ Configuration

Create a `config.json` file in the project directory to customize behavior:

```json
{
  "gitScanPath": "/path/to/your/repositories",
  "authorFilter": "Your Name",
  "standupDir": "/path/to/standup/storage",
  "streakFile": "/path/to/streak.json",
  "remindersFile": "/path/to/reminders.json"
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `gitScanPath` | `~/dev` | Root directory to scan for git repositories |
| `authorFilter` | Git config user.name | Filter commits by author name/email |
| `excludeRepos` | `[]` | Array of repository names to exclude from scanning |
| `skipMergeCommits` | `false` | Skip merge commits in git log |
| `customQuestions` | Default questions | Customize standup questions (see below) |
| `standupDir` | `~/.standup-cli/standups` | Directory for standup markdown files |
| `streakFile` | `~/.standup-cli/streak.json` | Path to streak tracking file |
| `remindersFile` | `~/.standup-cli/reminders.json` | Path to reminder state file |

**Note:** If no `config.json` exists, the tool will automatically use your git username for author filtering and sensible defaults for all paths.

See `config.example.json` for a full example configuration.

### Custom Questions

Customize your standup questions to match your team's workflow:

```json
{
  "customQuestions": {
    "accomplishments": {
      "message": "What progress did you make?",
      "enabled": true
    },
    "blockers": {
      "message": "Any blockers?",
      "enabled": true
    },
    "todaysPlan": {
      "message": "What's next?",
      "enabled": true
    },
    "additionalFields": [
      {
        "id": "sprint_goal",
        "message": "Sprint goal progress?",
        "type": "text"
      },
      {
        "id": "learnings",
        "message": "What did you learn?",
        "type": "multiline"
      }
    ]
  }
}
```

**Features:**
- Customize question text for each section
- Enable/disable sections (set `enabled: false`)
- Add custom fields with `text` or `multiline` types
- Custom fields appear in markdown output
- Maintains the core standup workflow

## 📋 Standup Flow

1. **Streak Display** - Shows your current streak to motivate consistency
2. **Mood Selection** - Choose from preset emojis or enter custom mood
3. **Git Commit Scanning** (Optional)
   - Configurable time range (since yesterday, Friday, N days ago)
   - Grouped or flat display format
   - Filters by your git author name
   - Shows unpushed commits
4. **Accomplishments** - Pre-filled from commits or manually entered
5. **Blockers** - Multi-line input with confirmation
6. **Today's Plan** - Multi-line input with confirmation
7. **Save & Copy** - Saves as markdown and copies to clipboard

## 📊 Statistics

View comprehensive statistics including:
- Total standup count
- Current and longest streaks
- Days with blockers
- Mood distribution
- Weekly trends

## 🔍 Search

Search through your standup history:
- By keyword in accomplishments, blockers, or plans
- By date or date range
- View matching entries with context

## 📅 Weekly Review

Generate a summary of the current week showing:
- All standups for the week
- Grouped by date
- Full details of accomplishments, blockers, and plans

## 🗄️ Data Storage

- **Standups**: Stored as markdown files named `YYYY-MM-DD.md`
- **Streak Data**: JSON file tracking current/longest streaks
- **Reminder State**: JSON file for notification management

All files are stored in configurable directories (defaults to project directory).

## 🔔 Systemd Integration (Optional)

The tool includes a reminder system that can be integrated with systemd timers for scheduled notifications.

Create a systemd service and timer to run reminders at scheduled times. The reminder system will:
- Check if standup is done for the day
- Send desktop notifications based on streak risk
- Detect recent git activity to prompt standups

Example systemd timer setup:

```ini
# ~/.config/systemd/user/standup.timer
[Unit]
Description=Daily Standup Reminder

[Timer]
OnCalendar=*-*-* 17:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

Enable with:
```bash
systemctl --user enable --now standup.timer
```

## 🤝 Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

Built with:
- [Bun](https://bun.sh) - Fast JavaScript runtime
- [@clack/prompts](https://github.com/natemoo-re/clack) - Interactive CLI prompts
- [date-fns](https://date-fns.org) - Date manipulation
- [picocolors](https://github.com/alexeyraspopov/picocolors) - Terminal colors

## 📝 Example Output

```
┌   📋 Daily Standup CLI

│
◇  Current Streak: 🔥 5 days (Longest: 12 days)

◆  What's your mood today?
│  ● 😊 Great
│  ○ 🙂 Good
│  ○ 😐 Okay
│  ○ 😔 Not great
│  ○ Custom
└

◆  Scan git repos for commits?
│  Yes
└

◇  Found 15 commits from 3 repositories

◆  Accomplishments (pre-filled from commits):
│  • [project-a] Added authentication system
│  • [project-b] Fixed critical bug in payment flow
│  • [project-c] Updated documentation
│
│  ● Accept and continue
│  ○ Add more
│  ○ Clear and restart
└
```

---

Made with ❤️ for better daily standups
