"""Build browser assets with remote pinned modules and the matching Go runtime."""
import os
from pathlib import Path
import shutil
import subprocess


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    go = shutil.which('go')
    if not go:
        raise SystemExit('Go 1.27.1 or newer is required to build compiler assets.')
    env = os.environ | {'GOWORK': 'off', 'GOOS': 'js', 'GOARCH': 'wasm'}
    output = root / 'apps/editor/public/compiler'
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run([go, 'build', '-mod=readonly', '-o', str(output / 'ballerina-compiler.wasm'), './cmd/wasm'], cwd=root / 'packages/compiler', env=env, check=True)
    goroot = subprocess.check_output([go, 'env', 'GOROOT'], cwd=root / 'packages/compiler', env=env, text=True).strip()
    shutil.copyfile(Path(goroot) / 'lib/wasm/wasm_exec.js', output / 'wasm_exec.js')


if __name__ == '__main__':
    main()
