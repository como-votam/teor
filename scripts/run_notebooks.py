"""Notebooks devem executar mesmo antes de haver resultados reais."""

import sys
from pathlib import Path

import nbformat
from jupyter_client import KernelManager
from nbclient import NotebookClient

for path in sorted(Path("analyses").glob("*.ipynb")):
    notebook = nbformat.read(path, as_version=4)
    manager = KernelManager(kernel_name="python3")
    manager.kernel_spec.argv = [
        sys.executable,
        "-m",
        "ipykernel_launcher",
        "-f",
        "{connection_file}",
    ]
    NotebookClient(
        notebook,
        timeout=120,
        kernel_manager=manager,
        resources={"metadata": {"path": str(Path.cwd())}},
    ).execute()
    print(f"Executado: {path.name}")
