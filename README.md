# 📋 Daily Standup CLI v2.0

A personal productivity tool for tracking daily standups with streak tracking, mood logging, and automated git commit aggregation. Built with Bun and TypeScript.

**New in v2.0:** AI-powered auto mode with optional Ollama integration for intelligent standup summaries!

## ✨ Features

- 🤖 **AI-Powered Auto Mode** - Intelligent standup generation using local LLMs (optional Ollama)
- 🎯 **Simple Fallback Mode** - Works out-of-the-box without any AI setup
- 📝 **Interactive Mode** - Manual guided prompts when you need full control
- 🔥 **Streak Tracking** - Monitor your consistency with current and longest streak counters
- 😊 **Smart Mood Detection** - Auto-infers mood from commit patterns (🚀/🔧/🎨/⚡)
- 🔗 **Git Integration** - Smart time ranges ("Since Friday" on Monday) with readable timestamps
- 📊 **Statistics & Analytics** - View standup history, mood distribution, and trends
- 🔍 **Search Functionality** - Search past standups by keyword or date range
- 📅 **Weekly Reviews** - Generate summaries of your week's standups
- 🔔 **Smart Reminders** - Optional systemd integration for scheduled notifications
- ⚙️ **Auto-Configuration** - Creates default config on first run
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

### Auto Mode (Default - v2.0)

Run without arguments for AI-powered auto standup generation:

```bash
standup            # Auto mode: non-interactive, AI-enhanced (if enabled)
```

**How it works:**
1. Auto-detects time range (yesterday, or Friday if Monday)
2. Scans git repos for commits
3. Generates intelligent summary (AI if enabled, otherwise smart text-based)
4. Saves to file and copies to clipboard
5. Perfect for automation (systemd timers)!

### Interactive Mode

When you want full control:

```bash
standup interactive    # or: standup -i
```

### Other Commands

```bash
standup stats      # View statistics
standup search     # Search past standups
standup review     # View weekly summary

# Flags
standup --help     # -h  Show help
standup --version  # -v  Show version (v2.0.0)
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

The tool auto-creates `~/.standup-cli/config.json` on first run with sensible defaults.

### Basic Configuration

```json
{
  "gitScanPath": "/path/to/your/repositories",
  "authorFilter": "Your Name",
  "enableAI": false
}
```

### Configuration Options

| Option | Default | Description |
|--------|---------|-------------|
| `gitScanPath` | `~/dev` | Root directory to scan for git repositories |
| `authorFilter` | Git config user.name | Filter commits by author name/email |
| `excludeRepos` | `[]` | Array of repository names to exclude from scanning |
| `skipMergeCommits` | `false` | Skip merge commits in git log |
| `enableAI` | `false` | **Enable AI-powered summaries (requires Ollama)** |
| `customQuestions` | Default questions | Customize standup questions (interactive mode) |
| `standupDir` | `~/.standup-cli/standups` | Directory for standup markdown files |
| `streakFile` | `~/.standup-cli/streak.json` | Path to streak tracking file |
| `remindersFile` | `~/.standup-cli/reminders.json` | Path to reminder state file |

**Note:** Config is auto-created on first run. Edit `~/.standup-cli/config.json` to customize.

See `config.example.json` for a full example configuration.

## 🤖 AI Mode (Optional)

### Enable AI-Powered Summaries

1. **Install Ollama:**
   ```bash
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. **Pull a model:**
   ```bash
   ollama pull qwen2.5:7b   # Recommended: fast & smart
   # or: ollama pull llama3.2:8b
   ```

3. **Enable in config:**
   ```json
   {
     "enableAI": true
   }
   ```

### AI vs Simple Mode

| Feature | Simple Mode (Default) | AI Mode (Optional) |
|---------|----------------------|-------------------|
| **Setup** | None - works out-of-box | Requires Ollama |
| **Speed** | Instant | ~2-5 seconds |
| **Quality** | Good - pattern-based | Excellent - contextual |
| **Mood** | Emoji based on commit types | Intelligent analysis |
| **Accomplishments** | Cleaned commit messages | Natural language summaries |
| **Context** | Basic patterns | Time-aware, multi-repo insights |
| **Cost** | Free | Free (local LLM) |

**Both modes work great!** Simple mode is perfect for most users. AI mode adds polish and context.

### Environment Variables

```bash
# Customize AI model (if AI enabled)
export OLLAMA_MODEL="llama3.2:8b"

# Use remote Ollama instance
export OLLAMA_API_URL="http://192.168.1.10:11434"

# Debug mode
export DEBUG=true
```

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

### Auto Mode (Default)
1. **Auto Time Detection** - Smart range (yesterday, or Friday if Monday)
2. **Git Scanning** - Scans repos, filters by author, shows timestamps
3. **AI Summary** - Generates mood, accomplishments, blockers, plan
4. **Save & Copy** - Markdown file + clipboard, updates streak

### Interactive Mode
1. **Streak Display** - Shows your current streak to motivate consistency
2. **Mood Selection** - Choose from preset emojis or enter custom mood
3. **Git Commit Scanning** (Optional)
   - Smart time ranges ("Since Friday", "Since Monday", etc.)
   - Grouped or flat display format
   - Readable timestamps (e.g., "Sunday 23 November 2025 14:30")
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

