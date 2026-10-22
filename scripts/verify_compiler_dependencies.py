"""Verify the pinned remote-only WASM build without a populated module cache."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix='balbot-remote-') as temporary:
        directory = Path(temporary)
        source = directory / 'compiler'
        source.mkdir()
        for name in ('go.mod', 'go.sum', 'compiler.go'):
            shutil.copyfile(root / 'packages/compiler' / name, source / name)
        shutil.copytree(root / 'packages/compiler/cmd', source / 'cmd')
        env = os.environ | {
            'GOWORK': 'off', 'GOMODCACHE': str(directory / 'modules'),
            'GOOS': 'js', 'GOARCH': 'wasm',
        }
        subprocess.run(['go', 'build', '-mod=readonly', '-o', str(directory / 'compiler.wasm'), './cmd/wasm'], cwd=source, env=env, check=True)
        print('Isolated remote-dependency WASM build passed.')


if __name__ == '__main__':
    main()
