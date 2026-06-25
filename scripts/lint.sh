#!/bin/bash
# Local linter script to check DuoArena Intelligent Contract

echo "Running GenVM Linter..."
genvm-lint check contracts/duo_arena.py
