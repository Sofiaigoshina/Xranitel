from __future__ import annotations

import os
from pathlib import Path
from typing import Callable

from jinja2 import BaseLoader, TemplateNotFound


class FlexibleEncodingFileSystemLoader(BaseLoader):
    """
    Reads .html as UTF-8 (with BOM) or Windows-1251 so templates saved in different
    encodings on Windows do not raise UnicodeDecodeError.
    """

    def __init__(self, searchpath: str) -> None:
        self.searchpath = os.path.abspath(os.fspath(searchpath))

    def get_source(self, environment, template: str) -> tuple[str, str | None, Callable[[], bool]]:
        pieces = template.replace(os.path.sep, "/").split("/")
        filename = os.path.join(self.searchpath, *pieces)
        path = Path(filename)
        if not path.is_file():
            raise TemplateNotFound(template)
        raw = path.read_bytes()
        text: str | None = None
        for encoding in ("utf-8-sig", "utf-8", "cp1251"):
            try:
                text = raw.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if text is None:
            text = raw.decode("utf-8", errors="replace")
        mtime = path.stat().st_mtime

        def uptodate() -> bool:
            try:
                return path.stat().st_mtime == mtime
            except OSError:
                return False

        return text, str(path.resolve()), uptodate
