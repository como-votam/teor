"""Varredura local usa uma allowlist de diretórios públicos, sem ler dados de trabalho."""

import re
from pathlib import Path

patterns = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{35}"),
    re.compile(r"sk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}"),
]
roots = [
    Path(p)
    for p in (
        "teor",
        "site/src",
        "site/public",
        "config",
        "docs",
        "tests",
        "scripts",
        ".github",
        "results",
    )
]
failures = []
for root in roots:
    for file in root.rglob("*"):
        if not file.is_file() or "__pycache__" in file.parts or "data" in file.parts:
            continue
        try:
            text = file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if any(pattern.search(text) for pattern in patterns):
            failures.append(str(file))
if failures:
    raise SystemExit("Possível segredo nos arquivos: " + ", ".join(failures))
print("Nenhum segredo reconhecido nos diretórios públicos")
