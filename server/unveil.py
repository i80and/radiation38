"""Binding for the unveil(2) system call on OpenBSD."""
import ctypes
import errno
import os
from typing import AnyStr, cast, Optional


def unveil(path: Optional[AnyStr], permissions: Optional[AnyStr]) -> None:
    """Expose a path with specified permissions to this process, following
       the semantics of unveil(2)."""
    try:
        libc = ctypes.CDLL('libc.so', use_errno=True)
        _unveil = libc.unveil
        _unveil.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
        _unveil.restype = ctypes.c_int
    except (OSError, AttributeError) as err:
        raise OSError(errno.ENOSYS, 'unveil() not supported') from err

    if isinstance(path, str):
        path = cast(Optional[AnyStr], bytes(path, 'utf-8'))

    if isinstance(permissions, str):
        permissions = cast(Optional[AnyStr], bytes(permissions, 'utf-8'))

    if _unveil(path, permissions) < 0:
        n = ctypes.get_errno()
        raise OSError(n, os.strerror(n))
