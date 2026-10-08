"""Real, isolated Git repositories for integration tests."""
import os
from pathlib import Path
import subprocess
import tempfile


class Repository:
    def __init__(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)
        self.git('init', '-q', '--initial-branch=main')
        self.git('config', 'user.name', 'Fixture Author')
        self.git('config', 'user.email', 'fixture@example.invalid')

    def git(self, *args, input=None):
        env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
        return subprocess.check_output(['git', '-C', str(self.path), *args], env=env, stderr=subprocess.PIPE, input=input)

    def write(self, path, content):
        target = self.path / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content.encode() if isinstance(content, str) else content)

    def commit(self, message='Fixture commit'):
        self.git('add', '--all')
        self.git('commit', '-qm', message)
        return self.git('rev-parse', 'HEAD').decode().strip()

    def close(self):
        self.temp.cleanup()
