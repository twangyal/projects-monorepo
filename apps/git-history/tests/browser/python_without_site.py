#!/usr/bin/env python3
"""Test-only real worker interpreter wrapper without optional site packages."""
import os
import sys

real = os.environ["GIT_HISTORY_BROWSER_REAL_PYTHON"]
os.execv(real, [real, "-S", *sys.argv[1:]])
