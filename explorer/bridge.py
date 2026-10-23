"""Local preview server and conservative Microduck JSON-RPC adapter.

Wire contract inspected against pollen-robotics/microduck API 44 on 2026-10-23:
duck-ipc-proto/src/lib.rs, blob f64c7e1b3a4b090f5a167d88e98974f303c7d97c.
No firmware, policy configuration, controller binding, or account writes exist here.
"""

import argparse
import functools
import json
import math
import secrets
import socket
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


API_VERSION = 44
MAX_MESSAGE = 1024 * 1024
LEASE_SECONDS = 5.0
READ_METHODS = frozenset({"hello", "robot.skills", "robot.policies", "robot.health", "robot.subscribe"})
ACTION_METHODS = frozenset({"robot.look", "robot.head", "robot.move", "robot.sound", "robot.do", "robot.stop"})
SOUND_NAMES = {
    "curious-chirp": "inquire", "friendly-chirp": "greet", "greeting": "greet", "contented-coo": "coo",
    "inquire": "inquire", "chirp": "chirp", "coo": "coo", "greet": "greet", "peck": "peck",
}


class BridgeError(Exception):
    def __init__(self, message, status=409):
        super().__init__(message)
        self.status = status


def finite_number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise BridgeError(f"{name} must be a finite number.", 400)
    if not low <= value <= high:
        raise BridgeError(f"{name} must be between {low} and {high}.", 400)
    return float(value)


class RpcClient:
    """One NDJSON connection, with an independently consumed robot.state stream."""

    def __init__(self, path, timeout=1.5):
        self.path = str(Path(path).expanduser())
        self.timeout = timeout
        self.sock = None
        self.connected = False
        self.state = None
        self.state_at = 0.0
        self.pending = {}
        self.send_lock = threading.Lock()
        self.pending_lock = threading.Lock()
        self.sequence = 0

    def connect(self):
        self.close()
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        try:
            sock.connect(self.path)
        except OSError:
            sock.close()
            raise
        sock.settimeout(None)
        self.sock = sock
        self.connected = True
        self.state = None
        self.state_at = 0.0
        threading.Thread(target=self._read, args=(sock,), daemon=True).start()

    def _read(self, sock):
        try:
            with sock.makefile("rb") as stream:
                while True:
                    line = stream.readline(MAX_MESSAGE + 1)
                    if not line or len(line) > MAX_MESSAGE or not line.endswith(b"\n"):
                        raise OSError("Robot connection ended or returned an oversized frame.")
                    message = json.loads(line)
                    if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
                        raise OSError("Invalid JSON-RPC frame.")
                    if message.get("method") == "robot.state" and isinstance(message.get("params"), dict):
                        self.state = message["params"]
                        self.state_at = time.monotonic()
                    elif "id" in message:
                        with self.pending_lock:
                            waiter = self.pending.get(message["id"])
                        if waiter:
                            waiter[1].append(message)
                            waiter[0].set()
        except (OSError, ValueError, TypeError):
            pass
        finally:
            if self.sock is sock:
                self.connected = False
                with self.pending_lock:
                    for event, result in self.pending.values():
                        result.append({"error": {"message": "Robot connection lost."}})
                        event.set()

    def _send(self, message):
        if not self.connected or not self.sock:
            raise BridgeError("Robot is disconnected.", 503)
        try:
            with self.send_lock:
                self.sock.sendall(json.dumps(message, allow_nan=False).encode() + b"\n")
        except OSError as exc:
            self.connected = False
            raise BridgeError("Robot connection lost.", 503) from exc

    def call(self, method, params=None):
        if method not in READ_METHODS | ACTION_METHODS:
            raise BridgeError("This method is outside the companion's permissions.", 403)
        with self.pending_lock:
            self.sequence += 1
            request_id = self.sequence
            event, result = threading.Event(), []
            self.pending[request_id] = (event, result)
        try:
            self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}})
            if not event.wait(self.timeout):
                self.close()
                raise BridgeError("Robot did not answer in time; Explorer is paused.", 503)
            response = result[0]
            if "error" in response:
                raise BridgeError(str(response["error"].get("message", "Robot refused the request.")))
            if not isinstance(response.get("result"), dict):
                raise BridgeError("Robot returned an unsupported response shape.", 502)
            return response["result"]
        finally:
            with self.pending_lock:
                self.pending.pop(request_id, None)

    def notify(self, method, params):
        if method not in {"robot.head", "robot.move"}:
            raise BridgeError("Unsupported continuous command.", 403)
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def close(self):
        self.connected = False
        sock, self.sock = self.sock, None
        if sock:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()


class ExplorerBridge:
    def __init__(self, socket_path=None, simulator=False, lease_seconds=LEASE_SECONDS):
        self.rpc = RpcClient(socket_path) if socket_path else None
        self.simulator = bool(simulator and socket_path)
        self.csrf_token = secrets.token_urlsafe(32)
        self.lock = threading.RLock()
        self.armed = False
        self.lease_seconds = lease_seconds
        self.expires_at = 0.0
        self.busy_until = 0.0
        self.skill_until = 0.0
        self.pulse = None
        self.skills = []
        self.permitted_skills = set()
        self.policies = None
        self.health = None
        self.protocol = None
        self.last_refresh = 0.0
        self.last_attempt = -10.0
        self.detail = "Browser character preview. No robot is connected."
        self.closed = threading.Event()
        self.worker = threading.Thread(target=self._watch, daemon=True)
        self.worker.start()

    def _refresh(self):
        if not self.rpc:
            return
        now = time.monotonic()
        try:
            if not self.rpc.connected:
                if now - self.last_attempt < 1.0:
                    return
                self.last_attempt = now
                self.armed = False
                self.pulse = None
                self.rpc.connect()
                self.protocol = self.rpc.call("hello", {"api_version": API_VERSION})
                result = self.rpc.call("robot.subscribe", {"hz": 5})
                if result.get("accepted") is not True:
                    raise BridgeError("Robot state subscription was refused.")
                self.last_refresh = 0.0
            if now - self.last_refresh > 2.0:
                raw = self.rpc.call("robot.skills")
                if not isinstance(raw.get("skills"), list) or not isinstance(raw.get("built_in", []), list):
                    raise BridgeError("Robot returned an unsupported skills list.")
                self.skills = [dict(item, built_in=False) for item in raw["skills"]
                               if isinstance(item, dict) and isinstance(item.get("name"), str)]
                names = {item["name"] for item in self.skills}
                self.skills += [{"name": name, "built_in": True} for name in raw.get("built_in", [])
                                if isinstance(name, str) and name not in names]
                self.permitted_skills.intersection_update(item["name"] for item in self.skills)
                self.policies = self.rpc.call("robot.policies")
                self.health = self.rpc.call("robot.health")
                self.last_refresh = now
            self.detail = ("User-declared simulator. Explorer is active." if self.armed else
                           "User-declared simulator. Ready for an exclusive session." if self.simulator else
                           "Read-only connection. Robot control is unavailable in this preview.")
        except (OSError, BridgeError, ValueError) as exc:
            self.armed = False
            self.pulse = None
            self.rpc.close()
            self.detail = f"Connection unavailable: {exc}"

    def status(self):
        with self.lock:
            self._refresh()
            now = time.monotonic()
            return {
                "backend": "microduck" if self.rpc else "preview",
                "target": "simulator" if self.simulator else "read-only" if self.rpc else "preview",
                "target_label": "User-declared simulator" if self.simulator else "Read-only endpoint" if self.rpc else "Character preview",
                "connected": bool(self.rpc and self.rpc.connected), "armed": self.armed,
                "control_allowed": bool(self.simulator), "detail": self.detail,
                "csrfToken": self.csrf_token, "token": self.csrf_token,
                "skills": self.skills, "permitted_skills": sorted(self.permitted_skills),
                "policies": self.policies, "health": self.health, "protocol": self.protocol,
                "state": self.rpc.state if self.rpc and self.rpc.connected else None,
                "state_age_s": round(now - self.rpc.state_at, 3) if self.rpc and self.rpc.state_at else None,
                "expires_in_s": round(max(0, self.expires_at - now), 2) if self.armed else 0,
                "busy": now < self.busy_until, "simulation_verified": False,
            }

    def _check_state(self):
        if not self.rpc or not self.rpc.connected:
            raise BridgeError("Connect the official local simulator first.")
        if not self.health or self.health.get("healthy") is not True:
            raise BridgeError("The simulator does not currently report healthy control.")
        if not self.rpc.state or time.monotonic() - self.rpc.state_at > 2:
            raise BridgeError("Waiting for a fresh state frame from the simulator.")
        safety = self.rpc.state.get("safety", {})
        if safety.get("fallen") is not False or safety.get("limp") is not False or safety.get("picked_up", False):
            raise BridgeError("Explorer is paused while the duck is fallen, limp, or picked up.")

    def arm(self, enabled, exclusive=False):
        with self.lock:
            if type(enabled) is not bool:
                raise BridgeError("enabled must be true or false.", 400)
            if not enabled:
                return self.pause()
            if not self.simulator:
                raise BridgeError("Control is limited to a simulator explicitly declared at launch.", 403)
            if exclusive is not True:
                raise BridgeError("Confirm the simulator is yours and other controllers are paused.", 400)
            self._refresh()
            if self.protocol is None or self.protocol.get("api_version") != API_VERSION:
                raise BridgeError(f"Control requires inspected Microduck API {API_VERSION}. This endpoint remains read-only.")
            self._check_state()
            self.armed = True
            self.expires_at = time.monotonic() + self.lease_seconds
            self.detail = "User-declared simulator. Explorer is active."
            return {"accepted": True, "armed": True, "lease_seconds": self.lease_seconds}

    def heartbeat(self):
        with self.lock:
            if not self.armed or time.monotonic() >= self.expires_at:
                self.pause("The active session expired.")
                raise BridgeError("Explorer is paused. Start a new session.")
            self._check_state()
            self.expires_at = time.monotonic() + self.lease_seconds
            return {"accepted": True, "armed": True}

    def permissions(self, names):
        with self.lock:
            if not isinstance(names, list) or any(not isinstance(x, str) for x in names):
                raise BridgeError("skills must be a list of installed skill names.", 400)
            installed = {item["name"] for item in self.skills}
            if not set(names) <= installed:
                raise BridgeError("Permissions can only name skills discovered on this endpoint.", 400)
            self.permitted_skills = set(names)
            return {"accepted": True, "skills": sorted(self.permitted_skills)}

    def pause(self, reason="Explorer is paused. The duck's installed skills remain available."):
        with self.lock:
            was_armed = self.armed
            self.armed = False
            self.pulse = None
            self.expires_at = 0
            # robot.stop only zeros velocity. A one-shot skill may still be running,
            # even if the owner pauses and immediately arms another session.
            self.busy_until = self.skill_until
            self.detail = reason
            stop = None
            if was_armed and self.rpc and self.rpc.connected:
                try:
                    stop = self.rpc.call("robot.stop")
                except BridgeError as exc:
                    stop = {"accepted": False, "reason": str(exc)}
            return {"accepted": True, "armed": False, "stop": stop}

    def action(self, action):
        with self.lock:
            if not isinstance(action, dict):
                raise BridgeError("An action must be a JSON object.", 400)
            kind = action.get("kind")
            if kind == "stop":
                # An attention event stops walking before looking. It is distinct from
                # pausing the persona, and must not silently cancel an active skill.
                if self.pulse:
                    self.pulse = None
                    self.busy_until = 0
                if not self.armed:
                    return {"accepted": True, "armed": False}
                result = self.rpc.call("robot.stop")
                if result.get("accepted") is not True:
                    raise BridgeError(str(result.get("reason", "The simulator declined stop.")))
                return {"accepted": True, "armed": True, "result": result}
            if kind not in {"look", "move", "sound", "skill"}:
                raise BridgeError("Unsupported character action.", 400)
            if not self.armed or time.monotonic() >= self.expires_at:
                self.pause("Explorer's session has paused.")
                raise BridgeError("Start an exclusive simulator session before sending actions.")
            try:
                self._check_state()
            except BridgeError:
                self.pause("Explorer paused because the simulator's state changed.")
                raise
            now = time.monotonic()
            if now < self.busy_until:
                raise BridgeError("Explorer is still completing the previous action.")
            if kind == "look":
                duration = finite_number(action.get("duration", 0.8), "duration", 0.1, 2)
                if "x" in action:
                    params = {"x": finite_number(action["x"], "x", .2, 1),
                              "y": finite_number(action.get("y", 0), "y", -.3, .3),
                              "z": finite_number(action.get("z", 0), "z", -.15, .3), "neck_pitch": 0}
                else:
                    yaw = finite_number(action.get("yaw", 0), "yaw", -.65, .65)
                    pitch = finite_number(action.get("pitch", 0), "pitch", -.3, .3)
                    params = {"x": .45, "y": .45 * math.tan(yaw), "z": .45 * math.tan(pitch), "neck_pitch": 0}
                result = self.rpc.call("robot.look", params)
                head = result.get("head")
                if not isinstance(head, dict) or any(k not in head for k in ("neck_pitch", "head_pitch", "head_yaw", "head_roll")):
                    self.pause("Explorer paused after an unsupported gaze response.")
                    raise BridgeError("Unsupported gaze response.", 502)
                # robot.look returns the daemon's own IK solution. Reuse it briefly, then release.
                for key in ("neck_pitch", "head_pitch", "head_yaw", "head_roll"):
                    finite_number(head[key], key, -math.pi, math.pi)
                self.pulse = ("robot.head", {key: head[key] for key in ("neck_pitch", "head_pitch", "head_yaw", "head_roll")}, now + duration)
                self.busy_until = now + duration
                return {"accepted": True, "result": result}
            if kind == "move":
                duration = finite_number(action.get("duration", .6), "duration", .1, 1.5)
                params = {"vx": finite_number(action.get("speed", action.get("vx", 0)), "speed", -.08, .08),
                          "vy": 0, "vyaw": finite_number(action.get("turn", action.get("vyaw", 0)), "turn", -.4, .4)}
                self.rpc.notify("robot.move", params)
                self.pulse = ("robot.move", params, now + duration)
                self.busy_until = now + duration + .1
                return {"accepted": True, "detail": "Bounded movement sent; execution remains subject to robotd."}
            if kind == "sound":
                tag = SOUND_NAMES.get(action.get("tag", action.get("name")))
                if tag is None:
                    raise BridgeError("This sound has no verified Microduck voice-bank mapping.", 400)
                result = self.rpc.call("robot.sound", {"tag": tag})
                self.busy_until = now + .25
            else:
                name = action.get("skillId", action.get("name"))
                if not isinstance(name, str) or name not in self.permitted_skills:
                    raise BridgeError("Enable this installed skill for Explorer before using it.", 403)
                skill = next((s for s in self.skills if s["name"] == name), None)
                if not skill:
                    raise BridgeError("That skill is no longer installed.")
                duration = finite_number(skill.get("duration"), "installed skill duration", .1, 30)
                unwind = finite_number(skill.get("unwind_s", 0), "installed skill unwind", 0, 5)
                result = self.rpc.call("robot.do", {"skill": name})
                if result.get("accepted") is True:
                    self.busy_until = now + duration + unwind + .3
                    self.skill_until = self.busy_until
            if result.get("accepted") is not True:
                raise BridgeError(str(result.get("reason", "The simulator declined this action.")))
            return {"accepted": True, "result": result}

    def _watch(self):
        while not self.closed.wait(.05):
            with self.lock:
                if not self.armed:
                    continue
                now = time.monotonic()
                if now >= self.expires_at:
                    self.pause("Explorer paused because its browser heartbeat stopped.")
                    continue
                try:
                    self._check_state()
                    if self.pulse:
                        method, params, until = self.pulse
                        if now < until:
                            self.rpc.notify(method, params)
                        else:
                            self.pulse = None
                            if method == "robot.move":
                                self.rpc.call("robot.stop")
                except BridgeError as exc:
                    self.pause(f"Explorer paused: {exc}")

    def close(self):
        self.closed.set()
        self.pause("Explorer has closed.")
        if self.rpc:
            self.rpc.close()
        if threading.current_thread() is not self.worker:
            self.worker.join(timeout=2)


class ExplorerHandler(SimpleHTTPRequestHandler):
    server_version = "CuriousExplorer/0.1"

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        super().end_headers()

    def _host_valid(self):
        port = self.server.server_address[1]
        return self.headers.get("Host") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def _json(self, value, status=200):
        data = json.dumps(value, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if not self._host_valid():
            return self._json({"error": "Unrecognized local host."}, 403)
        if urlsplit(self.path).path == "/api/status":
            return self._json(self.server.bridge.status())
        if urlsplit(self.path).path.startswith("/api/"):
            return self._json({"error": "Unknown endpoint."}, 404)
        return super().do_GET()

    def do_HEAD(self):
        if not self._host_valid():
            return self._json({"error": "Unrecognized local host."}, 403)
        return super().do_HEAD()

    def do_POST(self):
        try:
            if not self._host_valid():
                raise BridgeError("Unrecognized local host.", 403)
            origin = self.headers.get("Origin")
            if origin is not None and origin != "http://" + self.headers["Host"]:
                raise BridgeError("Open Explorer directly in its local browser tab.", 403)
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise BridgeError("Cross-site requests are not allowed.", 403)
            token = self.headers.get("X-Explorer-Token", "")
            if not secrets.compare_digest(token, self.server.bridge.csrf_token):
                raise BridgeError("Refresh Explorer to renew its local session token.", 403)
            if self.headers.get_content_type() != "application/json":
                raise BridgeError("Use a JSON request body.", 415)
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise BridgeError("Request body is missing or too large.", 400)
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise BridgeError("Request body must be an object.", 400)
            bridge = self.server.bridge
            route = urlsplit(self.path).path
            if route == "/api/arm":
                result = bridge.arm(body.get("enabled"), body.get("exclusive", False))
            elif route == "/api/pause":
                result = bridge.pause()
            elif route == "/api/heartbeat":
                result = bridge.heartbeat()
            elif route == "/api/permissions":
                result = bridge.permissions(body.get("skills"))
            elif route == "/api/action":
                result = bridge.action(body)
            else:
                raise BridgeError("Unknown endpoint.", 404)
            self._json(result)
        except BridgeError as exc:
            self._json({"accepted": False, "error": str(exc)}, exc.status)
        except (ValueError, TypeError, UnicodeError):
            self._json({"accepted": False, "error": "Invalid JSON request."}, 400)

    def log_message(self, format, *args):
        # Logs contain routes and status only; no account credentials or session token.
        return


def make_server(bridge, web_dir, port=8765):
    handler = functools.partial(ExplorerHandler, directory=str(web_dir))
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.daemon_threads = True
    server.bridge = bridge
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description="Meet Curious Explorer in a local character preview.")
    parser.add_argument("--port", type=int, default=8765, help="Local browser port (default: 8765)")
    parser.add_argument("--socket", help="Existing robotd Unix socket; read-only unless --simulator is declared")
    parser.add_argument("--simulator", action="store_true", help="Explicitly declare that this socket belongs to a simulator, never a physical robot")
    parser.add_argument("--web-dir", type=Path, default=Path(__file__).resolve().parent.parent / "web", help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    if args.simulator and not args.socket:
        parser.error("--simulator requires --socket pointing to the official local simulator")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not (args.web_dir / "index.html").is_file():
        parser.error("The web directory is missing. Run from a complete Curious Explorer source download.")
    bridge = ExplorerBridge(args.socket, args.simulator)
    try:
        server = make_server(bridge, args.web_dir, args.port)
    except OSError as exc:
        bridge.close()
        parser.error(f"Cannot start the local preview: {exc}")
    print(f"Curious Explorer is ready at http://127.0.0.1:{args.port}")
    if args.simulator:
        print("Target: user-declared simulator. Control stays paused until you explicitly start a session.")
    elif args.socket:
        print("Target: read-only endpoint. Physical robot control is not available in this version.")
    else:
        print("Character preview only. No account, simulator, or robot is needed.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        bridge.close()
        server.server_close()


if __name__ == "__main__":
    main()
