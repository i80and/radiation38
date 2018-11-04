#!/usr/bin/env python3
import cgi
import errno
import glob
import http.server
import json
import logging
import mimetypes
import os
import os.path
import socket
import urllib.parse
import pypledge
import unveil
from typing import Dict, List, Tuple, Union

logger = logging.getLogger(__name__)

# Various config settings for the python server
SETTINGS = {
    'port':        8000,
    'logging':     False,

    'api-save':    '/lib/weltmeister/api/save.php',
    'api-browse':  '/lib/weltmeister/api/browse.php',
    'api-glob':    '/lib/weltmeister/api/glob.php',
}

IMAGE_TYPES = ['.png', '.jpg', '.gif', '.jpeg']
SOUND_TYPES = ['.ogg']

mimetypes.add_type('audio/ogg', 'ogg')

# Override port if we are on a Heroku server
if 'PORT' in os.environ:
    SETTINGS['port'] = int(os.environ['PORT'])

# Get the current directory
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../'))
if not os.path.isfile(os.path.join(BASE_DIR, 'index.html')):
    raise AssertionError('Couldn\'t find index.html under root')

# Blank favicon - prevents silly 404s from occuring if no favicon is supplied
FAVICON_GIF = b'GIF89a\x01\x00\x01\x00\xf0\x00\x00\xff\xff\xff\x00\x00\x00!\xff\x0bXMP DataXMP\x02?x\x00!\xf9\x04\x05\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00@\x02\x02D\x01\x00;'


class Filesystem:
    __slots__ = ('root', 'writable_prefix', 'safe_extensions')

    def __init__(self, root: str) -> None:
        self.root = os.path.realpath(root)
        self.writable_prefix = os.path.realpath(os.path.join(self.root, 'lib/game/levels'))
        self.safe_extensions = ['.js', '.html', '.css', '.ico'] + IMAGE_TYPES[:] + SOUND_TYPES[:]

    def read(self, path: str) -> bytes:
        path = os.path.join(self.root, path)
        logger.debug('Reading %s', path)
        if not self._check(path, False):
            raise PermissionError()

        with open(path, 'rb') as f:
            return f.read()

    def write(self, path: str, data: str) -> None:
        path = os.path.join(self.root, path)
        logger.debug('Reading %s', path)
        if not self._check(path, True):
            raise PermissionError()

        with open(path, 'w') as f:
            f.write(data)

    def glob(self, patterns: List[str]) -> List[str]:
        logger.debug('Globbing %s', str(patterns))
        files: List[str] = []
        for pat in patterns:
            pat = pat.replace('..', '')
            pat = os.path.join(self.root, pat)
            files.extend(f.replace(self.root, '').lstrip('/') for f in glob.glob(pat) if os.path.splitext(f)[1] in self.safe_extensions)

        if any(not self._check(f, False) for f in files):
            raise PermissionError()

        if os.name == 'nt':
            files = [f.replace('\\', '/') for f in files]

        return files

    def browse(self, path: str) -> Tuple[List[str], List[str], Union[str, bool]]:
        real_path = os.path.join(self.root, path)

        logger.debug('Browsing %s', path)
        if not self._check(path, False, check_ext=False):
            raise PermissionError()

        # Get the dir and files
        dirs = [os.path.join(path, d).replace(self.root, '').lstrip('/') for d in os.listdir(real_path)
                if os.path.isdir(os.path.join(real_path, d)) and not d.startswith('.')]
        files = [f.replace(self.root, '').lstrip('/') for f in glob.glob(os.path.join(real_path, '*.*'))
                 if os.path.splitext(f)[1] in self.safe_extensions and not f.startswith('.')]
        parent: Union[str, bool] = False if path == './' else os.path.dirname(os.path.dirname(path))

        return files, dirs, parent

    def _check(self, path: str, write: bool, check_ext: bool=True) -> bool:
        if check_ext:
            _, ext = os.path.splitext(path)
            if ext not in self.safe_extensions:
                return False

        mandatory_prefix = self.writable_prefix if write else self.root
        return os.path.realpath(path).startswith(mandatory_prefix)


fs = Filesystem(BASE_DIR)


class HTTPServer(http.server.HTTPServer):
    def finish(self, *args, **kw):
        try:
            if not self.wfile.closed:
                self.wfile.flush()
                self.wfile.close()
        except socket.error:
            pass
        self.rfile.close()


def guess_type(path: str) -> str:
    ty, _ = mimetypes.guess_type(path)

    if not ty:
        ty = 'application/octet-stream'

    # Winblows hack
    if os.name == "nt" and ty.startswith("image"):
        ty = ty.replace("x-", "")

    return ty


class HTTPHandler(http.server.BaseHTTPRequestHandler):
    post_params: Dict[str, List[str]]
    query_params: Dict[str, List[str]]

    def send_json(self, obj: object, code: int=200, headers=None) -> None:
        'Send response as JSON'
        if not headers:
            headers = {}
        headers['Content-Type'] = 'application/json'
        self.send_response(bytes(json.dumps(obj), 'utf-8'), code, headers)

    def send_response(self, mesg: bytes, code: int=200, headers=None) -> None:
        'Wraps sending a response down'
        if not headers:
            headers = {}
        if 'Content-Type' not in headers:
            headers['Content-Type'] = 'text/html'
        http.server.BaseHTTPRequestHandler.send_response(self, code)
        self.send_header('Content-Length', len(mesg))
        if headers:
            for k, v in headers.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(mesg)

    def log_request(self, *args, **kwargs) -> None:
        'If logging is disabled '
        if SETTINGS['logging']:
            http.server.BaseHTTPRequestHandler.log_request(self, *args, **kwargs)

    def init_request(self) -> None:
        parts = self.path.split('?', 1)
        self.post_params = {}
        if len(parts) == 1:
            self.file_path = parts[0]
            self.query_params = {}
        else:
            self.file_path = parts[0]
            self.query_params = urllib.parse.parse_qs(parts[1])

    def do_GET(self) -> None:
        self.init_request()
        self.route_request('GET')

    def do_HEAD(self) -> None:
        self.init_request()
        self.send_response(b'')

    def do_POST(self) -> None:
        self.init_request()

        # From http://stackoverflow.com/questions/4233218/python-basehttprequesthandler-post-variables
        ctype, pdict = cgi.parse_header(self.headers.get_content_type())
        if ctype == 'multipart/form-data':
            self.post_params = cgi.parse_multipart(self.rfile, pdict)
        elif ctype == 'application/x-www-form-urlencoded':
            length = int(self.headers.get('content-length', '0'))
            self.post_params = urllib.parse.parse_qs(
                str(self.rfile.read(length), 'utf-8'),
                keep_blank_values=True)

        self.route_request('POST')

    def route_request(self, method: str='GET') -> None:
        try:
            if self.file_path == SETTINGS['api-save']:
                self.save()
            elif self.file_path == SETTINGS['api-browse']:
                self.browse()
            elif self.file_path == SETTINGS['api-glob']:
                self.glob()
            elif method == 'GET':
                self.serve_file()
            else:
                self.barf()
        except PermissionError:
            self.send_response(b'', 403)

    def save(self) -> None:
        resp: Dict[str, object] = {'error': 0}
        if 'path' in self.post_params and 'data' in self.post_params:
            path = self.post_params['path'][0].replace('..', '')
            data = self.post_params['data'][0]

            if path.endswith('.js'):
                try:
                    fs.write(path, data)
                except Exception:
                    resp['error'] = 2
                    resp['msg'] = 'Couldn\'t write to file %d'.format(path)

            else:
                resp['error'] = 3
                resp['msg'] = 'File must have a .js suffix'

        else:
            resp['error'] = 1
            resp['msg'] = 'No Data or Path specified'

        self.send_json(resp)

    def browse(self) -> None:
        # Get the directory to scan
        path = ''
        if 'dir' in self.query_params:
            path = self.query_params['dir'][0].replace('..', '')
            if path[-1] != '/':
                path += '/'

        files, dirs, parent = fs.browse(path)

        # Filter on file types
        if 'type' in self.query_params:
            types = self.query_params['type']
            if 'images' in types:
                files = [f for f in files if os.path.splitext(f)[1] in IMAGE_TYPES]
            elif 'scripts' in types:
                files = [f for f in files if os.path.splitext(f)[1] == '.js']

        if os.name == 'nt':
            files = [f.replace('\\', '/') for f in files]
            dirs = [d.replace('\\', '/') for d in dirs]

        self.send_json({
            'files': files,
            'dirs': dirs,
            'parent': parent
        })

    def glob(self) -> None:
        globs = self.query_params['glob[]']
        files = fs.glob(globs)
        self.send_json(files)

    def serve_file(self) -> None:
        path = self.file_path
        if path == '/':
            path = 'index.html'
        elif path == '/editor':
            path = 'weltmeister.html'

        # Remove the leading forward slash
        if path[0] == '/':
            path = path[1:]

        # Security, remove the ..
        path = path.replace('..', '')

        try:
            data = fs.read(path)
            mimetype = guess_type(path)
            self.send_response(data, 200, headers={'Content-Type': mimetype})
        except Exception:
            if '/favicon.ico' in path:
                self.send_response(FAVICON_GIF, 200, headers={'Content-Type': 'image/gif'})
            else:
                self.send_response(b'', 404)

    def barf(self) -> None:
        self.send_response(b'barf', 405)


def main() -> None:
    logging.basicConfig(level=logging.INFO)

    addr = ('', SETTINGS['port'])
    server = HTTPServer(addr, HTTPHandler)

    # Sandboxing
    try:
        unveil.unveil(fs.root, 'r')
        unveil.unveil(fs.writable_prefix, 'rwc')
        pypledge.pledge(['stdio', 'rpath', 'wpath', 'cpath', 'inet'])
    except OSError as err:
        if err.errno != errno.ENOSYS:
            raise err

    print('Running Weltmeister under {}'.format(fs.root))
    print('Game:   http://localhost:{}'.format(addr[1]))
    print('Editor: http://localhost:{}/editor'.format(addr[1]))
    server.serve_forever()


if __name__ == '__main__':
    main()
