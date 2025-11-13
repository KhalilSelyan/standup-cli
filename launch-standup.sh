#!/bin/bash

# Find standup binary
if command -v standup &> /dev/null; then
    STANDUP_BIN="standup"
elif [ -f "$HOME/dev/scripts/standup/standup" ]; then
    STANDUP_BIN="$HOME/dev/scripts/standup/standup"
elif [ -f "./standup" ]; then
    STANDUP_BIN="./standup"
else
    notify-send "Standup" "Could not find standup binary"
    exit 1
fi

# Try to find an available terminal emulator
if command -v alacritty &> /dev/null; then
    alacritty -e "$STANDUP_BIN"
elif command -v kitty &> /dev/null; then
    kitty "$STANDUP_BIN"
elif command -v gnome-terminal &> /dev/null; then
    gnome-terminal -- "$STANDUP_BIN"
elif command -v konsole &> /dev/null; then
    konsole -e "$STANDUP_BIN"
elif command -v xterm &> /dev/null; then
    xterm -e "$STANDUP_BIN"
else
    notify-send "Standup" "No terminal emulator found! Please run: $STANDUP_BIN"
fi
