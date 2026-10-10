"""PDFs oficiais malformados não podem bloquear a coleta inteira; este processo é descartável."""

import io
import sys

from pypdf import PdfReader

from teor.io import canonical

if __name__ == "__main__":
    document = PdfReader(io.BytesIO(sys.stdin.buffer.read()))
    text = "\n".join(page.extract_text() or "" for page in document.pages)
    sys.stdout.buffer.write(canonical({"text": text}))
